import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { persistZcodeWorkspace } from '../server/zcode/zcode-assets.js';

test('ZCode preview selection, inline contents and explicit close survive a new page', () => {
  const storage = new Map();
  const localStorage = {getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value)};
  const source = persistZcodeWorkspace('zl=new Map;function Bl(e,t){return zl.delete(e),zl.set(e,t),t}');
  const open = () => runInNewContext(source+';({save:Bl,read:key=>zl.get(key)})', {localStorage});
  const view = {isSidePaneCollapsed:false,sidePaneState:{activeTabId:'preview',tabs:[{id:'preview',type:'code-viewer',source:{type:'text',content:'preview body'}}]}};
  open().save('/work',view);
  expect(JSON.parse(JSON.stringify(open().read('/work')))).toEqual(view);
  open().save('/work',{isSidePaneCollapsed:true,sidePaneState:null});
  expect(open().read('/work').isSidePaneCollapsed).toBe(true);
  expect(open().read('/work').sidePaneState).toBe(null);
});

test("desktop layout switch survives folding and reload without reloading the conversation", () => {
  const html = readFileSync(new URL("../web/codex/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../web/codex/app.js", import.meta.url), "utf8");
  const source = app.slice(app.indexOf("function initializeZcodeLayout()"), app.indexOf("async function boot()"));
  const dom = new JSDOM(html, { url: "http://localhost/zcode" });
  const { document, localStorage } = dom.window;
  const frame = document.querySelector<HTMLIFrameElement>("#zcodeFrame")!;
  const button = document.querySelector<HTMLButtonElement>("#zcodeDesktopLayout")!;
  const viewport = document.querySelector("#zcodeViewport")!;
  let width = 720, height = 780, resize = () => {};
  Object.defineProperties(viewport, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  const start = runInNewContext(`${source};initializeZcodeLayout`, {
    $: (selector: string) => document.querySelector(selector), localStorage, document, getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} },
  });
  frame.src = "/remote/v4/?existing-conversation";
  frame.contentDocument!.write('<!doctype html><html><body></body></html>');
  const originalSource = frame.src;
  start();
  expect(button.getAttribute("aria-pressed")).toBe("false");
  button.click();
  for (const nextWidth of [720, 390, 1440, 720]) {
    width = nextWidth; resize();
    const scale = Number(frame.style.transform.match(/scale\((.+)\)/)?.[1]);
    expect(parseFloat(frame.style.width)).toBeGreaterThanOrEqual(1024);
    expect(parseFloat(frame.style.width) * scale).toBeCloseTo(width);
    expect(parseFloat(frame.style.height) * scale).toBeCloseTo(height);
    expect(parseFloat(frame.contentDocument!.documentElement.style.getPropertyValue('--codex-zcode-font-size')) * scale).toBeCloseTo(13);
  }
  expect(localStorage.getItem("codex-webui-zcode-layout")).toBe("desktop");
  start();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  button.click();
  expect(frame.style.transform).toBe("");
  expect(frame.style.width).toBe("");
  expect(frame.style.height).toBe("");
  expect(frame.contentDocument!.documentElement.style.getPropertyValue('--codex-zcode-font-size')).toBe('13px');
  expect(frame.src).toBe(originalSource);
  dom.window.close();
});

test("HTTP and HTTPS ZCode clients replace placeholder proof through the authorized local endpoint", async () => {
  const html = readFileSync(new URL("../web/codex/zcode-remote.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("const NativeWebSocket"));
  expect(script).toBeDefined();
  for (const protocol of ["http:", "https:"]) {
    class Socket {
      static OPEN = 1;
      readyState = 1;
      sent: string[] = [];
      handlers: any[] = [];
      constructor(public url: URL) {}
      send(data: string) { this.sent.push(data); }
      addEventListener(_name: string, callback: any) { this.handlers.push(callback); }
      message(data: object) { for (const handler of this.handlers) handler({ data: JSON.stringify(data) }); }
      close() { this.readyState = 3; }
    }
    const window: any = { WebSocket: Socket, crypto: {}, isSecureContext: protocol === "https:" };
    let allow = true, signatures = 0;
    const fetch = async (url: string, options: any) => {
      expect(url).toBe("/api/zcode/relay-proof");
      expect(options.credentials).toBe("same-origin");
      expect(JSON.parse(options.body)).toEqual({ nonce: "challenge", deviceSid: "test-device" });
      signatures++;
      return { ok: allow, json: async () => ({ proof: "actual-server-proof" }) };
    };
    const location = { protocol, host: "192.168.1.100:8899", href: `${protocol}//192.168.1.100:8899/remote/v4/` };
    runInNewContext(script!, { window, location, URL, fetch, Uint8Array });
    const socket = new window.WebSocket("wss://zcode.z.ai/ws");
    expect(socket.url.pathname).toBe("/zcode-relay");
    socket.send(JSON.stringify({ type: "auth_init", role: "terminal", device_sid: "test-device" }));
    socket.message({ type: "auth_challenge", nonce: "challenge" });
    socket.send(JSON.stringify({ type: "auth_response", device_sid: "test-device", proof: "placeholder" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(JSON.parse(socket.sent.at(-1))).toEqual({ type: "auth_response", device_sid: "test-device", proof: "actual-server-proof" });
    expect(signatures).toBe(1);
    allow = false;
    socket.send(JSON.stringify({ type: "auth_response", device_sid: "test-device", proof: "placeholder" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(socket.readyState).toBe(3);
    expect(socket.sent).toHaveLength(2);
  }
});

test("ZCode returns to the saved workspace after closing the browser", () => {
  const html = readFileSync(new URL("../web/codex/zcode-remote.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("const NativeWebSocket"))!;
  const key = 'codex-webui-zcode-view:device';
  const boot = (saved?: string) => {
    const dom = new JSDOM('', {url: 'https://localhost/remote/v4/?sid=device'});
    if (saved) dom.window.localStorage.setItem(key, saved);
    class Socket extends dom.window.EventTarget {
      static OPEN = 1;
      readyState = 1;
      send(_data: string) {}
      message(data: object) {
        const event = new dom.window.MessageEvent('message', {data: JSON.stringify(data)});
        this.dispatchEvent(event); return JSON.parse(event.data);
      }
    }
    Object.defineProperty(dom.window, 'WebSocket', {value: Socket, writable: true});
    runInNewContext(script, {window: dom.window, location: dom.window.location, URL, Uint8Array});
    const socket = new (dom.window.WebSocket as any)('wss://zcode.z.ai/ws');
    return {dom, socket};
  };
  const first = boot();
  first.socket.send(JSON.stringify({type:'data',payload:{zcode_type:'mobile-view-state-update',viewState:{activeWorkspaceKey:'/work',activeTaskId:'last-task'}}}));
  first.dom.window.history.pushState({zcodeMobilePage:'chat'},'');
  first.dom.window.dispatchEvent(new first.dom.window.Event('pagehide'));
  const saved = first.dom.window.localStorage.getItem(key)!;
  first.dom.window.close();
  const next = boot(saved);
  try {
    expect(next.dom.window.history.state.zcodeMobilePage).toBe('chat');
    const response = {type:'data',payload:{zcode_type:'bootstrap-response',result:{workspaces:[{workspacePath:'/other'},{workspacePath:'/work'}],mobileViewState:{activeWorkspaceKey:'/other',activeTaskId:'desktop-task'}}}};
    expect(next.socket.message(response).payload.result.mobileViewState).toEqual({activeWorkspaceKey:'/work',activeTaskId:'last-task'});
    response.payload.result.workspaces = [{workspacePath:'/other'}];
    expect(next.socket.message(response).payload.result.mobileViewState.activeTaskId).toBe('desktop-task');
    next.socket.send(JSON.stringify({type:'data',payload:{zcode_type:'mobile-view-state-update',viewState:{activeWorkspaceKey:'/work'}}}));
    expect(JSON.parse(next.dom.window.localStorage.getItem(key)!).viewState.activeTaskId).toBeUndefined();
  } finally { next.dom.window.close(); }
});
