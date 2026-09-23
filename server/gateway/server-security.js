import { lstatSync, realpathSync, statSync } from "node:fs";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";
import { BlockList, isIP } from "node:net";

const BROWSER_RPC_METHODS = new Set([
  "model/list",
  "skills/list",
  "permissionProfile/list",
  "account/logout",
  "thread/list",
  "thread/read",
  "thread/name/set",
  "thread/archive",
  "thread/fork",
  "host/thread/pin",
  "thread/resume",
  "thread/turns/list",
  "host/thread/live",
  "host/thread/queue",
  "host/thread/settings",
  "host/thread/user-input/answer",
  "thread/start",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
]);

const PUBLIC_ASSETS = new Set([
  "/index.html",
  "/style.css",
  "/favicon.svg",
  "/auth-bootstrap.js",
  "/system-theme.js",
  "/i18n.js",
  "/codex-brand.js",
  "/app.bundle.js",
  "/manifest.json",
  "/assets/codex-lan-icon.png",
  "/assets/codex-app-icon-128.png",
  "/assets/codex-app-icon.png",
  "/assets/codex-motion/local-context.json",
  "/assets/codex-motion/searching.json",
  "/assets/codex-motion/list-files.json",
  "/assets/codex-motion/edit-files.json",
  "/assets/codex-motion/run-command.json",
]);

const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PASSWORD_SESSION_COOKIE = "codex_webui_session";
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORED_PASSWORD_VERSION = 1;

function sessionSignature(payload, password) {
  return createHmac("sha256", password).update(payload).digest("base64url");
}

export function parseCookieHeader(header) {
  const values = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    try { values[name] = decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { values[name] = part.slice(separator + 1).trim(); }
  }
  return values;
}

export function createPasswordSession(password, { now = Date.now(), ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  const expiresAt = now + ttlMs;
  const payload = `${expiresAt}.${randomBytes(24).toString("base64url")}`;
  return { token: `${payload}.${sessionSignature(payload, password)}`, expiresAt };
}

export function verifyPasswordSession(token, password, { now = Date.now() } = {}) {
  if (!token || !password) return false;
  const pieces = String(token).split(".");
  if (pieces.length !== 3) return false;
  const [expiresText, nonce, signature] = pieces;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || !nonce || !signature) return false;
  return safeEqual(signature, sessionSignature(`${expiresText}.${nonce}`, password));
}

export function passwordSessionCookie(token, { secure = false, maxAgeSeconds = Math.floor(DEFAULT_SESSION_TTL_MS / 1000) } = {}) {
  return `${PASSWORD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function createStoredPassword(password, { salt = randomBytes(16).toString("base64url") } = {}) {
  if (typeof password !== "string" || !password || typeof salt !== "string" || !salt) throw new Error("Password and salt are required");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return { version: STORED_PASSWORD_VERSION, algorithm: "scrypt", salt, hash };
}

export function isStoredPassword(value) {
  return value?.version === STORED_PASSWORD_VERSION
    && value?.algorithm === "scrypt"
    && typeof value?.salt === "string"
    && value.salt.length >= 16
    && typeof value?.hash === "string"
    && value.hash.length >= 32;
}

export function verifyStoredPassword(password, credential) {
  if (typeof password !== "string" || !isStoredPassword(credential)) return false;
  try { return safeEqual(scryptSync(password, credential.salt, 32).toString("base64url"), credential.hash); }
  catch { return false; }
}

export function storedPasswordSessionSecret(credential) {
  if (!isStoredPassword(credential)) return null;
  return createHash("sha256").update(`codex-webui-session:${credential.salt}:${credential.hash}`).digest("base64url");
}

function hostnameOf(hostHeader) {
  if (!hostHeader) return null;
  try { return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "").toLowerCase(); }
  catch { return null; }
}

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");
const privateAddresses = new BlockList();
privateAddresses.addSubnet("10.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("172.16.0.0", 12, "ipv4");
privateAddresses.addSubnet("192.168.0.0", 16, "ipv4");
privateAddresses.addSubnet("fc00::", 7, "ipv6");
privateAddresses.addSubnet("fe80::", 10, "ipv6");

function addressIn(list, address) {
  const version = isIP(address || "");
  return Boolean(version && list.check(address, version === 4 ? "ipv4" : "ipv6"));
}

function isLoopbackAddress(address) { return addressIn(loopbackAddresses, address); }
function hasForwardingHeaders(req) {
  return ["forwarded", "x-forwarded-for", "x-real-ip", "x-forwarded-host", "x-forwarded-proto"]
    .some(name => req.headers[name] !== undefined);
}

export function isDirectLoopbackRequest(req) {
  return isLoopbackAddress(req.socket.remoteAddress) && !hasForwardingHeaders(req);
}

function isLoopbackHost(hostHeader) {
  const host = hostnameOf(hostHeader);
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isPrivateHost(hostHeader) {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  return isLoopbackHost(hostHeader) || addressIn(privateAddresses, host);
}

function isSameOrigin(origin, hostHeader) {
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(hostHeader || "").toLowerCase(); }
  catch { return false; }
}

export function isSameOriginBrowserRequest(req) {
  return req.headers["sec-fetch-site"] !== "cross-site" && isSameOrigin(req.headers.origin, req.headers.host);
}

function isTrustedProxyRequest(req, accessToken) {
  return Boolean(accessToken && isLoopbackAddress(req.socket.remoteAddress)
    && safeEqual(String(req.headers.authorization || ""), `Bearer ${accessToken}`));
}

export function isSecureBrowserRequest(req, accessToken) {
  return Boolean(req.socket.encrypted || (isTrustedProxyRequest(req, accessToken) && req.headers["x-forwarded-proto"] === "https"));
}

export function loginPeerAddress(req, accessToken) {
  const forwarded = req.headers["x-real-ip"];
  return isTrustedProxyRequest(req, accessToken) && isIP(forwarded || "") ? forwarded : req.socket.remoteAddress;
}

export function createLoginLimiter() {
  let until = 0, total = 0;
  const peers = new Map();
  return (peer, now = Date.now()) => {
    if (now >= until) { until = now + 60_000; total = 0; peers.clear(); }
    const count = peers.get(peer) || 0;
    if (count >= 8 || total >= 40) return Math.max(1, Math.ceil((until - now) / 1000));
    peers.set(peer, count + 1);
    total++;
    return 0;
  };
}

function suppliedToken(authorization) {
  if (!authorization) return null;
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0 || decoded.slice(0, separator) !== "codex") return null;
    return decoded.slice(separator + 1);
  } catch { return null; }
}

export function isAllowedBrowserRpcMethod(method) {
  return typeof method === "string" && BROWSER_RPC_METHODS.has(method);
}

export function isRequestAuthorized({ remoteAddress, hostHeader, authorization, accessToken, cookie = null, origin = null, fetchSite = null, forwardedFor = null, forwarded = null, realIp = null, allowLoopback = true, now = Date.now() }) {
  if (fetchSite === "cross-site" || !isSameOrigin(origin, hostHeader)) return false;
  const proxied = Boolean(forwardedFor || forwarded || realIp);
  if (allowLoopback && !proxied && isLoopbackAddress(remoteAddress) && isLoopbackHost(hostHeader)) return true;
  if (accessToken) {
    const candidate = suppliedToken(authorization);
    if (candidate != null && safeEqual(candidate, accessToken)) return true;
    return verifyPasswordSession(parseCookieHeader(cookie)[PASSWORD_SESSION_COOKIE], accessToken, { now });
  }
  return false;
}

export function resolveSafeRegularFile(root, relativePath) {
  try {
    const canonicalRoot = realpathSync(root);
    const candidate = resolve(root, relativePath);
    if (!inside(candidate, resolve(root))) return null;
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return null;
    const canonicalFile = realpathSync(candidate);
    if (!inside(canonicalFile, canonicalRoot) || !statSync(canonicalFile).isFile()) return null;
    return canonicalFile;
  } catch { return null; }
}

export function resolvePublicAsset(pathname, publicDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return null; }
  if (decoded === "/") decoded = "/index.html";
  if (!PUBLIC_ASSETS.has(decoded)) return null;
  return resolveSafeRegularFile(publicDir, `.${decoded}`);
}

export function unauthorizedResponse(res) {
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Basic realm="Codex WebUI", charset="UTF-8"',
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify({ error: "Authentication required" }));
}

export function isAuthorizedHttpRequest(req, accessToken, allowLoopback = true) {
  if (process.env.CODEX_WEBUI_NO_AUTH === "1") {
    if (accessToken && isRequestAuthorized({
      remoteAddress: req.socket.remoteAddress,
      hostHeader: req.headers.host,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      accessToken,
      origin: req.headers.origin,
      fetchSite: req.headers["sec-fetch-site"],
      forwardedFor: req.headers["x-forwarded-for"],
      forwarded: req.headers.forwarded,
      realIp: req.headers["x-real-ip"],
      allowLoopback: false,
    })) return true;
    if (hasForwardingHeaders(req)
      || !(isLoopbackAddress(req.socket.remoteAddress) || addressIn(privateAddresses, req.socket.remoteAddress))) return false;
    const bindHost = process.env.HOST || "127.0.0.1";
    const expected = `${bindHost}:${process.env.PORT || 8899}`;
    const allowedHost = bindHost === "0.0.0.0" || bindHost === "::" ? isPrivateHost(req.headers.host) : req.headers.host === expected;
    return allowedHost && isSameOriginBrowserRequest(req);
  }
  return isRequestAuthorized({
    remoteAddress: req.socket.remoteAddress,
    hostHeader: req.headers.host,
    authorization: req.headers.authorization,
    cookie: req.headers.cookie,
    accessToken,
    origin: req.headers.origin,
    fetchSite: req.headers["sec-fetch-site"],
    forwardedFor: req.headers["x-forwarded-for"],
    forwarded: req.headers.forwarded,
    realIp: req.headers["x-real-ip"],
    allowLoopback,
  });
}
