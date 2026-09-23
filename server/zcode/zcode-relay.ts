import { createDecipheriv, createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { isDirectLoopbackRequest } from "../gateway/server-security.js";

const CREDENTIAL_KEY = "web-remote-control:external-relay:pass_hash";

export function decryptZcodeCredential(value: string, secret: string) {
  if (!value.startsWith("enc:v1:")) throw new Error("Unsupported ZCode credential format");
  const parts = value.slice(7).split(".");
  if (parts.length !== 3) throw new Error("Invalid ZCode credential");
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, "base64url"));
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function zcodeRelayProof(passHash: string, nonce: string, deviceSid: string) {
  return createHmac("sha256", passHash).update(`${nonce}|terminal|${deviceSid}`).digest("base64url");
}

export function loadZcodeRelayAuth(zcodeHome = join(homedir(), ".zcode", "v2")) {
  const settings = JSON.parse(readFileSync(join(zcodeHome, "setting.json"), "utf8"));
  const credentials = JSON.parse(readFileSync(join(zcodeHome, "credentials.json"), "utf8"));
  const deviceSid = settings?.webRemoteControlExternalRelayDevice?.deviceSid;
  const encryptedHash = credentials?.[CREDENTIAL_KEY];
  if (typeof deviceSid !== "string" || !deviceSid || deviceSid.length > 256 || typeof encryptedHash !== "string") throw new Error("ZCode Remote Control is not configured");
  const secret = process.env.ZCODE_CREDENTIAL_SECRET || `zcode-credential-fallback:${platform()}:${homedir()}:${userInfo().username}`;
  const passHash = decryptZcodeCredential(encryptedHash, secret);
  if (!passHash || passHash.length > 512 || !/^[A-Za-z0-9+/=_-]+$/.test(passHash)) throw new Error("Invalid ZCode Remote Control credential");
  return { deviceSid, passHash };
}

type Role = "device" | "terminal";
type Peer = { socket: WebSocket; trustedDevice: boolean; role?: Role; deviceSid?: string; authenticated: boolean; nonce?: string };

export class LocalZcodeRelayBroker {
  private device?: Peer;
  private terminals = new Set<Peer>();

  constructor(private readonly auth = loadZcodeRelayAuth) {}

  createTerminalProof(nonce: unknown, deviceSid: unknown) {
    if (typeof nonce !== "string" || typeof deviceSid !== "string"
      || ![...this.terminals].some(peer => !peer.authenticated && peer.nonce === nonce && peer.deviceSid === deviceSid)) {
      throw new Error("Invalid relay challenge");
    }
    const auth = this.auth();
    if (deviceSid !== auth.deviceSid) throw new Error("Invalid relay device");
    return zcodeRelayProof(auth.passHash, nonce, deviceSid);
  }

  attachDevice(socket: WebSocket) { this.attach(socket, true); }
  attachTerminal(socket: WebSocket) { this.attach(socket, false); }

  private attach(socket: WebSocket, trustedDevice: boolean) {
    const peer: Peer = { socket, trustedDevice, authenticated: false };
    if (!trustedDevice) this.terminals.add(peer);
    socket.on("message", (raw, isBinary) => {
      if (isBinary || raw.byteLength > 8 * 1024 * 1024) { socket.close(1003, "Invalid relay message"); return; }
      let message: any;
      try { message = JSON.parse(String(raw)); }
      catch { socket.close(1007, "Invalid relay message"); return; }
      this.handle(peer, message, String(raw));
    });
    socket.on("close", () => this.remove(peer));
    socket.on("error", () => this.remove(peer));
  }

  private handle(peer: Peer, message: any, raw: string) {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    if (message?.type === "device_register_init") {
      if (!peer.trustedDevice || peer.authenticated || peer.nonce) { this.error(peer, "AUTH_FAILED"); return; }
      const deviceSid = `d_local_${randomUUID().replaceAll("-", "")}`;
      peer.role = "device";
      peer.deviceSid = deviceSid;
      this.send(peer, { type: "device_register_ack", device_sid: deviceSid });
      return;
    }
    if (message?.type === "auth_init") {
      if (peer.authenticated) { this.error(peer, "AUTH_FAILED"); return; }
      const role: Role = peer.trustedDevice ? "device" : "terminal";
      if (message.role !== role || typeof message.device_sid !== "string" || !message.device_sid) { this.error(peer, "WRONG_PARAM"); return; }
      if (!peer.trustedDevice) {
        try { if (message.device_sid !== this.auth().deviceSid) { this.error(peer, "AUTH_FAILED"); return; } }
        catch { this.error(peer, "AUTH_FAILED"); return; }
      }
      peer.role = role;
      peer.deviceSid = message.device_sid;
      peer.nonce = randomUUID();
      this.send(peer, { type: "auth_challenge", nonce: peer.nonce });
      return;
    }
    if (message?.type === "auth_response") {
      if (!peer.role || message.device_sid !== peer.deviceSid || !peer.nonce) { this.error(peer, "AUTH_FAILED"); return; }
      if (!peer.trustedDevice) {
        try {
          const expected = Buffer.from(this.createTerminalProof(peer.nonce, peer.deviceSid));
          const proof = typeof message.proof === "string" ? Buffer.from(message.proof) : Buffer.alloc(0);
          if (proof.length !== expected.length || !timingSafeEqual(proof, expected)) { this.error(peer, "AUTH_FAILED"); return; }
        } catch { this.error(peer, "AUTH_FAILED"); return; }
      }
      peer.authenticated = true;
      peer.nonce = undefined;
      this.install(peer);
      this.send(peer, { type: "auth_ack", pair_status: this.status(peer) });
      this.notifyOther(peer);
      return;
    }
    if (message?.type === "pair_status_query") {
      if (peer.authenticated) this.send(peer, { type: "pair_status_ack", pair_status: this.status(peer) });
      return;
    }
    if (message?.type === "data" && peer.authenticated && this.status(peer) === "matched") {
      if (peer.role === "device") {
        for (const terminal of this.terminals) if (terminal.authenticated && terminal.deviceSid === peer.deviceSid) terminal.socket.send(raw);
      } else if (this.device?.authenticated) this.device.socket.send(raw);
    }
  }

  private install(peer: Peer) {
    if (peer.role === "terminal") { this.terminals.add(peer); return; }
    const previous = this.device;
    this.device = peer;
    if (previous && previous !== peer && previous.socket.readyState < WebSocket.CLOSING) previous.socket.close(1000, "Reconnected");
  }

  private remove(peer: Peer) {
    if (peer.role === "device" && this.device === peer) this.device = undefined;
    this.terminals.delete(peer);
    this.notifyAll();
  }

  private status(peer: Peer) {
    if (!peer.authenticated) return "waiting";
    if (peer.role === "device") return "matched";
    const other = this.device;
    return other?.authenticated && other.deviceSid === peer.deviceSid ? "matched" : "waiting";
  }

  private notifyOther(peer: Peer) {
    if (peer.role === "device") {
      for (const terminal of this.terminals) if (terminal.authenticated) this.send(terminal, { type: "pair_status_ack", pair_status: this.status(terminal) });
    } else if (this.device?.authenticated) this.send(this.device, { type: "pair_status_ack", pair_status: this.status(this.device) });
  }

  private notifyAll() {
    if (this.device?.authenticated) this.send(this.device, { type: "pair_status_ack", pair_status: this.status(this.device) });
    for (const terminal of this.terminals) if (terminal.authenticated) this.send(terminal, { type: "pair_status_ack", pair_status: this.status(terminal) });
  }

  private send(peer: Peer, message: object) {
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify(message));
  }

  private error(peer: Peer, code: string) {
    peer.authenticated = false;
    peer.nonce = undefined;
    this.remove(peer);
    this.send(peer, { type: "error", code, message: code });
    peer.socket.close(1008, code);
  }
}

const localRelay = new LocalZcodeRelayBroker();

export function attachZcodeRelay(browser: WebSocket) { localRelay.attachTerminal(browser); }
export function createZcodeTerminalProof(nonce: unknown, deviceSid: unknown) { return localRelay.createTerminalProof(nonce, deviceSid); }

export function startZcodeLocalDeviceRelay(port = Number(process.env.ZCODE_LOCAL_RELAY_PORT || 8898)) {
  const server = new WebSocketServer({ host: "127.0.0.1", port,
    verifyClient: ({ req }) => isDirectLoopbackRequest(req) && !req.headers.origin });
  server.on("connection", socket => localRelay.attachDevice(socket));
  server.on("listening", () => console.log(`ZCode local relay listening on ws://127.0.0.1:${port}`));
  return server;
}
