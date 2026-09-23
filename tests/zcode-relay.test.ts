import { expect, test } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { decryptZcodeCredential, LocalZcodeRelayBroker, zcodeRelayProof } from "../server/zcode/zcode-relay.js";

test("decrypts credentials and creates the ZCode terminal proof", () => {
  const secret = "test-secret", expected = "test-pass-hash";
  const iv = randomBytes(12), key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
  const stored = `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  expect(decryptZcodeCredential(stored, secret)).toBe(expected);
  expect(zcodeRelayProof(expected, "nonce", "device")).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("pairs the local ZCode device and terminal and forwards data", () => {
  class Socket extends EventEmitter {
    readyState = WebSocket.OPEN;
    sent: any[] = [];
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
    message(value: object) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
  }
  const sid = "d_local_test", passHash = "test-pass-hash", broker = new LocalZcodeRelayBroker(() => ({ deviceSid: sid, passHash }));
  const device = new Socket(), terminal = new Socket(), secondTerminal = new Socket();
  broker.attachDevice(device as unknown as WebSocket);
  device.message({ type: "auth_init", role: "device", device_sid: sid });
  device.message({ type: "auth_response", device_sid: sid, proof: "local" });
  expect(device.sent.at(-1)).toEqual({ type: "auth_ack", pair_status: "matched" });
  broker.attachTerminal(terminal as unknown as WebSocket);
  terminal.message({ type: "auth_init", role: "terminal", device_sid: sid });
  terminal.message({ type: "auth_response", device_sid: sid, proof: broker.createTerminalProof(terminal.sent.at(-1).nonce, sid) });
  expect(device.sent.at(-1)).toEqual({ type: "pair_status_ack", pair_status: "matched" });
  expect(terminal.sent.at(-1)).toEqual({ type: "auth_ack", pair_status: "matched" });
  broker.attachTerminal(secondTerminal as unknown as WebSocket);
  secondTerminal.message({ type: "auth_init", role: "terminal", device_sid: sid });
  secondTerminal.message({ type: "auth_response", device_sid: sid, proof: broker.createTerminalProof(secondTerminal.sent.at(-1).nonce, sid) });
  expect(terminal.readyState).toBe(WebSocket.OPEN);
  terminal.message({ type: "data", payload: { zcode_type: "ping" } });
  expect(device.sent.at(-1)).toEqual({ type: "data", payload: { zcode_type: "ping" } });
  device.message({ type: "data", payload: { zcode_type: "pong" } });
  expect(terminal.sent.at(-1)).toEqual({ type: "data", payload: { zcode_type: "pong" } });
  expect(secondTerminal.sent.at(-1)).toEqual({ type: "data", payload: { zcode_type: "pong" } });
  terminal.close();
  device.message({ type: "pair_status_query", device_sid: sid });
  expect(device.sent.at(-1)).toEqual({ type: "pair_status_ack", pair_status: "matched" });
  const reconnected = new Socket();
  broker.attachTerminal(reconnected as unknown as WebSocket);
  reconnected.message({ type: "auth_init", role: "terminal", device_sid: sid });
  reconnected.message({ type: "auth_response", device_sid: sid, proof: broker.createTerminalProof(reconnected.sent.at(-1).nonce, sid) });
  expect(reconnected.sent.at(-1)).toEqual({ type: "auth_ack", pair_status: "matched" });
});

test("rejects terminal data before auth and invalid proofs", () => {
  class Socket extends EventEmitter {
    readyState = WebSocket.OPEN;
    sent: any[] = [];
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
    message(value: object) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
  }
  const sid = "d_security_test", broker = new LocalZcodeRelayBroker(() => ({ deviceSid: sid, passHash: "test-pass-hash" }));
  const device = new Socket(), terminal = new Socket();
  broker.attachDevice(device as unknown as WebSocket);
  device.message({ type: "auth_init", role: "device", device_sid: sid });
  device.message({ type: "auth_response", device_sid: sid, proof: "local" });
  broker.attachTerminal(terminal as unknown as WebSocket);
  terminal.message({ type: "auth_init", role: "terminal", device_sid: sid });
  const before = device.sent.length;
  terminal.message({ type: "data", payload: "must-not-forward" });
  expect(device.sent).toHaveLength(before);
  terminal.message({ type: "auth_response", device_sid: sid, proof: "wrong" });
  expect(terminal.sent.some(message => message.type === "auth_ack")).toBe(false);
  expect(terminal.readyState).toBe(WebSocket.CLOSED);
  terminal.message({ type: "data", payload: "still-must-not-forward" });
  expect(device.sent.some(message => message.type === "data")).toBe(false);
  expect(() => broker.createTerminalProof("unknown", sid)).toThrow();
});
