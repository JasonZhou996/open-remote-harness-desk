import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPasswordSession, createStoredPassword, isAllowedBrowserRpcMethod, isAuthorizedHttpRequest, isRequestAuthorized, parseCookieHeader, resolvePublicAsset, storedPasswordSessionSecret, verifyPasswordSession, verifyStoredPassword, isDirectLoopbackRequest, isSecureBrowserRequest, loginPeerAddress, createLoginLimiter } from "../server/gateway/server-security.js";

describe("WebUI server security boundary", () => {
  test("persistent gateway cookies work in LAN mode without accepting forged or expired cookies", () => {
    const previous = process.env.CODEX_WEBUI_NO_AUTH;
    process.env.CODEX_WEBUI_NO_AUTH = '1';
    const req:any = {socket:{remoteAddress:'127.0.0.1'},headers:{host:'codex.example:3391','x-forwarded-for':'203.0.113.20'}};
    try {
      expect(isAuthorizedHttpRequest(req,'gateway-secret')).toBe(false);
      const {token}=createPasswordSession('gateway-secret');
      req.headers.cookie='codex_webui_session='+token;
      expect(isAuthorizedHttpRequest(req,'gateway-secret')).toBe(true);
      req.headers.cookie+='x';
      expect(isAuthorizedHttpRequest(req,'gateway-secret')).toBe(false);
      req.headers.cookie='codex_webui_session='+createPasswordSession('gateway-secret',{ttlMs:-1}).token;
      expect(isAuthorizedHttpRequest(req,'gateway-secret')).toBe(false);
      req.headers.cookie='codex_webui_session='+token;req.headers.origin='https://untrusted.example';
      expect(isAuthorizedHttpRequest(req,'gateway-secret')).toBe(false);
    } finally { if(previous===undefined)delete process.env.CODEX_WEBUI_NO_AUTH;else process.env.CODEX_WEBUI_NO_AUTH=previous; }
  });
  test("raw proxy accepts only direct loopback, and trusts TLS headers only from the authenticated gateway", () => {
    const req: any = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
    expect(isDirectLoopbackRequest(req)).toBe(true);
    req.socket.remoteAddress = "192.168.1.20";
    expect(isDirectLoopbackRequest(req)).toBe(false);
    req.socket.remoteAddress = "203.0.113.20";
    req.headers["x-forwarded-proto"] = "https";
    req.headers["x-real-ip"] = "192.168.1.20";
    expect(isSecureBrowserRequest(req, "proxy-secret")).toBe(false);
    expect(loginPeerAddress(req, "proxy-secret")).toBe("203.0.113.20");
    req.socket.remoteAddress = "127.0.0.1";
    expect(isDirectLoopbackRequest(req)).toBe(false);
    expect(isSecureBrowserRequest(req, "proxy-secret")).toBe(false);
    req.headers.authorization = "Bearer proxy-secret";
    expect(isSecureBrowserRequest(req, "proxy-secret")).toBe(true);
    expect(loginPeerAddress(req, "proxy-secret")).toBe("192.168.1.20");
  });

  test("limits password work per source and globally, then recovers after a minute", () => {
    const attempt = createLoginLimiter();
    for (let i = 0; i < 8; i++) expect(attempt("one", 1000)).toBe(0);
    expect(attempt("one", 1000)).toBe(60);
    for (let i = 0; i < 32; i++) expect(attempt(`other-${i}`, 1000)).toBe(0);
    expect(attempt("new-source", 1000)).toBe(60);
    expect(attempt("one", 61_000)).toBe(0);
  });
  test("allows only the RPC methods used by the browser client", () => {
    for (const method of ["skills/list", "model/list", "permissionProfile/list", "account/logout", "thread/list", "thread/read", "thread/resume", "thread/turns/list", "host/thread/live", "thread/start", "thread/name/set", "thread/archive", "thread/fork", "host/thread/pin", "turn/start", "turn/steer", "turn/interrupt"]) {
      expect(isAllowedBrowserRpcMethod(method)).toBe(true);
    }
    for (const method of ["fs/readFile", "fs/writeFile", "fs/remove", "fs/copy", "config/read", "account/read", "threadSection/delete", "thread/section/move"]) {
      expect(isAllowedBrowserRpcMethod(method)).toBe(false);
    }
  });

  test("serves only declared public assets and never follows symbolic links", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-public-"));
    try {
      writeFileSync(join(root, "style.css"), "body{}\n");
      writeFileSync(join(root, "favicon.svg"), "<svg/>\n");
      writeFileSync(join(root, "i18n.js"), "export {};\n");
      writeFileSync(join(root, "system-theme.js"), "// theme\n");
      writeFileSync(join(root, "unknown.txt"), "not public\n");
      expect(resolvePublicAsset("/style.css", root)).toBe(realpathSync(join(root, "style.css")));
      expect(resolvePublicAsset("/favicon.svg", root)).toBe(realpathSync(join(root, "favicon.svg")));
      expect(resolvePublicAsset("/i18n.js", root)).toBe(realpathSync(join(root, "i18n.js")));
      expect(resolvePublicAsset("/system-theme.js", root)).toBe(realpathSync(join(root, "system-theme.js")));
      expect(resolvePublicAsset("/unknown.txt", root)).toBeNull();
      expect(resolvePublicAsset("/%ZZ", root)).toBeNull();

      rmSync(join(root, "style.css"));
      symlinkSync(join(root, "unknown.txt"), join(root, "style.css"));
      expect(resolvePublicAsset("/style.css", root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires a shared token for non-loopback clients", () => {
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: null, accessToken: null })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: null, accessToken: "correct horse" })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: "Basic Y29kZXg6Y29ycmVjdCBob3JzZQ==", accessToken: "correct horse" })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "codex.example.com", authorization: null, accessToken: null })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "198.51.100.20", hostHeader: "codex.example.com", authorization: null, accessToken: null })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "198.51.100.20", hostHeader: "codex.example.com", authorization: "Basic Zm9vOmJhcg==", accessToken: "correct horse" })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "198.51.100.20", hostHeader: "codex.example.com", authorization: "Basic Y29kZXg6Y29ycmVjdCBob3JzZQ==", accessToken: "correct horse" })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: null, accessToken: null, origin: "https://evil.example" })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: null, accessToken: null, forwardedFor: "198.51.100.20" })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: "Basic Y29kZXg6Y29ycmVjdCBob3JzZQ==", accessToken: "correct horse", forwardedFor: "198.51.100.20" })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: null, accessToken: "correct horse", allowLoopback: false })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "127.0.0.1", hostHeader: "localhost:8899", authorization: "Basic Y29kZXg6Y29ycmVjdCBob3JzZQ==", accessToken: "correct horse", allowLoopback: false })).toBe(true);
  });

  test("accepts a same-origin internal proxy token in LAN no-auth mode", () => {
    const previous = process.env.CODEX_WEBUI_NO_AUTH;
    process.env.CODEX_WEBUI_NO_AUTH = "1";
    try {
      const req: any = {
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          host: "codex.example.com",
          origin: "https://codex.example.com",
          authorization: "Bearer proxy-secret",
          "x-forwarded-for": "198.51.100.20",
        },
      };
      expect(isAuthorizedHttpRequest(req, "proxy-secret")).toBe(true);
      req.headers.origin = "https://evil.example";
      expect(isAuthorizedHttpRequest(req, "proxy-secret")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CODEX_WEBUI_NO_AUTH;
      else process.env.CODEX_WEBUI_NO_AUTH = previous;
    }
  });

  test("accepts private hosts when LAN no-auth listens on every interface", () => {
    const previous = { noAuth: process.env.CODEX_WEBUI_NO_AUTH, host: process.env.HOST, port: process.env.PORT };
    process.env.CODEX_WEBUI_NO_AUTH = "1";
    process.env.HOST = "0.0.0.0";
    process.env.PORT = "8899";
    try {
      const req: any = { socket: { remoteAddress: "192.168.1.20" }, headers: { host: "192.168.1.100:8899", origin: "http://192.168.1.100:8899" } };
      expect(isAuthorizedHttpRequest(req, null)).toBe(true);
      req.socket.remoteAddress = "203.0.113.10";
      expect(isAuthorizedHttpRequest(req, null)).toBe(false);
      req.socket.remoteAddress = "::ffff:203.0.113.10";
      expect(isAuthorizedHttpRequest(req, null)).toBe(false);
      req.socket.remoteAddress = "127.0.0.1";
      req.headers["x-forwarded-for"] = "203.0.113.10";
      expect(isAuthorizedHttpRequest(req, null)).toBe(false);
      delete req.headers["x-forwarded-for"];
      req.socket.remoteAddress = "::ffff:192.168.1.20";
      expect(isAuthorizedHttpRequest(req, null)).toBe(true);
      req.headers.host = "192.168.evil.example:8899";
      req.headers.origin = "http://192.168.evil.example:8899";
      expect(isAuthorizedHttpRequest(req, null)).toBe(false);
      req.headers.host = "public.example:8899";
      req.headers.origin = "http://public.example:8899";
      expect(isAuthorizedHttpRequest(req, null)).toBe(false);
    } finally {
      for (const [name, value] of Object.entries({ CODEX_WEBUI_NO_AUTH: previous.noAuth, HOST: previous.host, PORT: previous.port })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  test("creates signed browser sessions without storing the configured password", () => {
    const session = createPasswordSession("correct horse", { now: 1_700_000_000_000, ttlMs: 60_000 });
    expect(session.token).not.toContain("correct horse");
    expect(session.expiresAt).toBe(1_700_000_060_000);
    expect(verifyPasswordSession(session.token, "correct horse", { now: 1_700_000_030_000 })).toBe(true);
    expect(verifyPasswordSession(session.token, "wrong horse", { now: 1_700_000_030_000 })).toBe(false);
    expect(verifyPasswordSession(session.token, "correct horse", { now: 1_700_000_060_001 })).toBe(false);
    expect(verifyPasswordSession(`${session.token}x`, "correct horse", { now: 1_700_000_030_000 })).toBe(false);
  });

  test("hashes managed passwords and derives a stable session secret", () => {
    const credential = createStoredPassword("correct horse battery staple", { salt: "0123456789abcdef" });
    expect(JSON.stringify(credential)).not.toContain("correct horse battery staple");
    expect(verifyStoredPassword("correct horse battery staple", credential)).toBe(true);
    expect(verifyStoredPassword("wrong horse battery staple", credential)).toBe(false);
    const secret = storedPasswordSessionSecret(credential);
    expect(secret).toBe(storedPasswordSessionSecret(credential));
    expect(secret).not.toBe(credential.hash);
    const session = createPasswordSession(secret, { now: 1_700_000_000_000, ttlMs: 60_000 });
    expect(verifyPasswordSession(session.token, secret, { now: 1_700_000_030_000 })).toBe(true);
  });

  test("accepts the signed session cookie for same-origin LAN HTTP and WebSocket requests", () => {
    const session = createPasswordSession("correct horse", { now: 1_700_000_000_000, ttlMs: 60_000 });
    const cookie = `other=1; codex_webui_session=${encodeURIComponent(session.token)}; theme=dark`;
    expect(parseCookieHeader(cookie).codex_webui_session).toBe(session.token);
    expect(isRequestAuthorized({ remoteAddress: "192.168.2.40", hostHeader: "192.168.2.10:8899", authorization: null, accessToken: "correct horse", cookie, now: 1_700_000_030_000 })).toBe(true);
    expect(isRequestAuthorized({ remoteAddress: "192.168.2.40", hostHeader: "192.168.2.10:8899", authorization: null, accessToken: "correct horse", cookie, now: 1_700_000_060_001 })).toBe(false);
    expect(isRequestAuthorized({ remoteAddress: "192.168.2.40", hostHeader: "192.168.2.10:8899", authorization: null, accessToken: "correct horse", cookie, origin: "https://evil.example", now: 1_700_000_030_000 })).toBe(false);
  });
});
