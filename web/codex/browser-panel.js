const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const BASE_BROWSER_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts";

export function normalizeBrowserUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { url: null, error: "Enter a URL" };

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[\w.-]+:\d+(?:[/?#]|$)/i.test(raw);
  const isLocal = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw);
  const candidate = hasScheme ? raw : `${isLocal ? "http" : "https"}://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { url: null, error: "Enter a valid URL" };
  }

  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    return { url: null, error: "Only http:// and https:// URLs can be embedded" };
  }
  if (parsed.username || parsed.password) {
    return { url: null, error: "URLs with embedded credentials are not supported" };
  }
  return { url: parsed.href, error: "" };
}

export function browserFrameUrl(value) {
  const url = new URL(value);
  const token = btoa(url.origin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `/api/browser/local/${token}${url.pathname}${url.search}${url.hash}`;
}

export function browserSandbox() { return BASE_BROWSER_SANDBOX; }
