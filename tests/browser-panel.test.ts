import { describe, expect, test } from "bun:test";
import { browserFrameUrl, browserSandboxFor, normalizeBrowserUrl } from "../web/codex/browser-panel.js";

describe("browser panel URLs", () => {
  test("normalizes host-like input to HTTPS", () => {
    expect(normalizeBrowserUrl(" example.com/docs ")).toEqual({
      url: "https://example.com/docs",
      error: "",
    });
  });

  test("preserves supported HTTP URLs", () => {
    expect(normalizeBrowserUrl("http://127.0.0.1:8899/api/config?panel=1")).toEqual({
      url: "http://127.0.0.1:8899/api/config?panel=1",
      error: "",
    });
  });

  test("routes every page through the Ubuntu WebUI host", () => {
    expect(browserFrameUrl("http://127.0.0.1:8000/app?q=1")).toMatch(/^\/api\/browser\/local\/[^/]+\/app\?q=1$/);
    expect(browserFrameUrl("https://example.com/app")).toMatch(/^\/api\/browser\/local\/[^/]+\/app$/);
  });

  test("rejects unsafe schemes and embedded credentials", () => {
    expect(normalizeBrowserUrl("javascript:alert(1)").error).toContain("http:// and https://");
    expect(normalizeBrowserUrl("https://user:secret@example.com").error).toContain("credentials");
    expect(normalizeBrowserUrl(" ").error).toBe("Enter a URL");
  });

  test("enables same-origin website behavior without exposing the WebUI origin", () => {
    const app = "http://127.0.0.1:8899/";
    expect(browserSandboxFor("https://example.com/app", app)).toContain("allow-same-origin");
    expect(browserSandboxFor("http://127.0.0.1:8899/api/config", app)).not.toContain("allow-same-origin");
  });
});
