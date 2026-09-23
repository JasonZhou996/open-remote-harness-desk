import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { saveUpload, MAX_UPLOAD_BYTES } from "./upload-service.js";
import { readThreadPage, readConversationTurns, mergeConversationTurns } from "../codex/thread-history.js";
import { finalizeFork } from "../codex/thread-fork.js";
import { SessionImports } from "./session-import.js";
import { desktopProjects } from "../codex/desktop-projects.js";
import { join, relative, resolve, extname, isAbsolute } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { defaultBrowseRoots, isDirectory, listFolders, resolveBrowsePath } from "./folder-service.js";
import { applyReviewPatch } from "../codex/review-service.js";
import { ReviewDiffStore, parseReviewPatchRequest } from "../codex/review-state.js";
import { unifiedDiffFromFileChanges } from "../../web/codex/codex-surfaces.js";
import { rpcErrorPayload } from "../../web/codex/bridge-errors.js";
import { createTerminalSession, normalizeTerminalResize, resolveTerminalCwd } from "./terminal-service.js";
import { attachZcodeRelay, loadZcodeRelayAuth, createZcodeTerminalProof, startZcodeLocalDeviceRelay } from "../zcode/zcode-relay.js";
import { adaptZcodeAsset } from "../zcode/zcode-assets.js";
import { validateUserInputResponse } from "../../web/codex/user-input.js";
import { readWorkspaceContext } from "../codex/workspace-context.js";
import { searchWorkspaceFiles } from "./file-search.js";
import { resolveLocalFile } from "./file-service.js";
import { isPreviewDocument, previewDocument, documentPage } from "./document-preview.js";
import { resolveLocalImage } from "./image-service.js";
import { LiveSessionStore, rolloutActivity } from "../codex/live-session-service.js";
import { DesktopQueue } from "../codex/desktop-queue.mjs";
import { DesktopSync } from "../codex/desktop-sync.mjs";
const desktopSync = new DesktopSync(payload => broadcast({type: "codex/notification", payload}));
const desktop = desktopSync.bridge;
const desktopQueue = new DesktopQueue(desktopSync);
import {
  createPasswordSession,
  createStoredPassword,
  isAllowedBrowserRpcMethod,
  isAuthorizedHttpRequest,
  isDirectLoopbackRequest,
  isSameOriginBrowserRequest,
  isSecureBrowserRequest,
  loginPeerAddress,
  createLoginLimiter,
  isRequestAuthorized,
  parseCookieHeader,
  passwordSessionCookie,
  resolvePublicAsset,
  resolveSafeRegularFile,
  storedPasswordSessionSecret,
  unauthorizedResponse,
  verifyPasswordSession,
  verifyStoredPassword,
} from "./server-security.js";
import { loadStoredPassword, passwordStorePath, saveStoredPassword, type StoredPassword } from "./password-store.js";
import {
  createAccountIdentityLoader,
  fetchProfileAvatar,
  isLocalAccountRequest,
  resolveAccountIdentity,
  toPublicAccountIdentity,
} from "../codex/profile-service.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8899);
const serverId = randomUUID();
const loginAttempt = createLoginLimiter();
const pendingUserInputs = new Map<number | string, any>();
const userInputsFor = (threadId: unknown) => [...pendingUserInputs.values()].filter(req => req.params.threadId === threadId);

function currentLanUrl() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter(address => address.family === "IPv4" && !address.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address))
      .map(address => ({ name, address: address.address })),
  );
  candidates.sort((a, b) => Number(!/^(wl|en)/.test(a.name)) - Number(!/^(wl|en)/.test(b.name)));
  return `http://${candidates[0]?.address || "127.0.0.1"}:${port}`;
}
const bundledCodexBin = process.env.XARNESS_BUNDLED_CODEX_BIN || "";
if (!isAbsolute(bundledCodexBin) || !existsSync(bundledCodexBin)) {
  throw new Error("XARNESS_BUNDLED_CODEX_BIN must name the bundled Codex executable");
}
const noAuth = process.env.CODEX_WEBUI_NO_AUTH === "1";
const accessToken = process.env.CODEX_WEBUI_ACCESS_TOKEN || null;
const environmentPassword = process.env.CODEX_WEBUI_PASSWORD || null;
const managedPasswordPath = passwordStorePath();
let managedPassword: StoredPassword | null = noAuth || environmentPassword || accessToken ? null : loadStoredPassword(managedPasswordPath);
let authSecret = environmentPassword || accessToken || storedPasswordSessionSecret(managedPassword);
let passwordSetupInProgress = false;
const localhostOnly = host === "127.0.0.1" || host === "::1" || host === "localhost";
const appRoot = resolve(import.meta.dir, "../..");
const publicDir = resolve(appRoot, "web/codex");
const staticCache = new Map<string, {stamp: string; body: Buffer; gzip: Buffer}>();
const zcodeAssetCache = new Map<string, Promise<{body: Buffer; contentType: string}>>();
const claudeBridgeDist = process.env.CLAUDE_BRIDGE_DIST || resolve(appRoot, "web/claude/dist");
const claudeBridgePort = Number(process.env.CLAUDE_BRIDGE_PORT || 3001);
const imagePreviewDir = resolve(tmpdir(), "codex-webui-image-previews");
const imagePreviews = new Map<string, Promise<string>>();
const IMAGE_PREVIEW_SCRIPT = `
from PIL import Image, ImageOps
import sys
source, target = sys.argv[1], sys.argv[2]
with Image.open(source) as image:
    image = ImageOps.exif_transpose(image)
    image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
    image.save(target, "WEBP", quality=72, method=4)
`;

async function imagePreview(path: string) {
  const stat = statSync(path);
  const key = createHash("sha256").update(`${path}\0${stat.size}\0${stat.mtimeMs}`).digest("hex");
  const output = resolve(imagePreviewDir, `${key}.webp`);
  if (existsSync(output)) return output;
  let pending = imagePreviews.get(key);
  if (!pending) {
    pending = new Promise((resolvePreview, rejectPreview) => {
      mkdirSync(imagePreviewDir, { recursive: true });
      const temporary = `${output}.${process.pid}.tmp`;
      const child = spawn("python3", ["-c", IMAGE_PREVIEW_SCRIPT, path, temporary]);
      let error = "";
      child.stderr.on("data", chunk => { if (error.length < 4096) error += chunk; });
      child.on("error", rejectPreview);
      child.on("close", code => {
        if (code === 0) {
          renameSync(temporary, output);
          resolvePreview(output);
        } else {
          rmSync(temporary, { force: true });
          rejectPreview(new Error(error.trim() || `Image preview failed (${code})`));
        }
      });
    }).finally(() => imagePreviews.delete(key));
    imagePreviews.set(key, pending);
  }
  return pending;
}
function uiAssetVersion() {
  const stamps = ['app.bundle.js','style.css','auth-bootstrap.js','system-theme.js','codex-brand.js','i18n.js','favicon.svg'].map(name => {
    const stat = statSync(resolve(publicDir,name));
    return `${name}:${stat.size}:${stat.mtimeMs}`;
  });
  return createHash('sha256').update(stamps.join('|')).digest('hex').slice(0,16);
}
function sendStatic(req: IncomingMessage, res: ServerResponse, file: string) {
  const stat = statSync(file), revision=uiAssetVersion(), html=extname(file)==='.html';
  const authenticated = html && isAuthorizedHttpRequest(req, authSecret);
  const stamp = `"${stat.size}-${stat.mtimeMs}${html?`-${revision}-${authenticated}`:''}"`;
  const version = new URL(req.url || '/', 'http://localhost').searchParams.get('v');
  const fingerprinted = /^[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(relative(resolve(claudeBridgeDist, 'assets'), file));
  const cacheControl = html ? 'private, no-cache' : (version === revision || fingerprinted) ? 'private, max-age=31536000, immutable' : 'no-cache';
  const headers = {"content-type": mime[extname(file)] || "application/octet-stream", "cache-control": cacheControl, etag: stamp, vary: html ? "Accept-Encoding, Cookie, Authorization" : "Accept-Encoding"};
  if (req.headers["if-none-match"] === stamp) {res.writeHead(304, headers); res.end(); return;}
  let cached = staticCache.get(file);
  if (!cached || cached.stamp !== stamp) {
    const original = readFileSync(file);
    const body = html ? Buffer.from(original.toString('utf8')
      .replace(/<html\b/, `<html data-gateway-authenticated="${authenticated}"`)
      .replace(/((?:href|src)="\/(?:style\.css|auth-bootstrap\.js|system-theme\.js|favicon\.svg))"/g,`$1?v=${revision}"`)) : original;
    cached = {stamp, body, gzip: gzipSync(body)};
    staticCache.set(file, cached);
  }
  const compressed = String(req.headers["accept-encoding"] || "").split(",").some(part => /^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.[0-9]*[1-9][0-9]*))?\s*$/.test(part));
  const body = compressed ? cached.gzip : cached.body;
  res.writeHead(200, {...headers, "content-length": body.length, ...(compressed ? {"content-encoding": "gzip"} : {})});
  res.end(req.method === "HEAD" ? undefined : body);
}
const homeDir = process.env.HOME || process.cwd();
const defaultCwd = resolve(process.env.CODEX_WEBUI_CWD || appRoot);
const browseRoots = defaultBrowseRoots(homeDir);
const imageRoots = [...new Set([...browseRoots, resolve(tmpdir()), resolve("/tmp")])];
const fileRoots = [...new Set([...browseRoots, defaultCwd, resolve(tmpdir()), resolve("/tmp")])];
const reviewRoots = [resolve(process.env.CODEX_WEBUI_REVIEW_ROOT || defaultCwd)];
const clients = new Set<WebSocket>();
const sseClients = new Set<ServerResponse>();
let threadStateChangedTimer: ReturnType<typeof setTimeout> | null = null;
const threadStateWatcher = watch(resolve(homeDir, ".codex"), {persistent: false}, (_event, filename) => {
  if (filename !== ".codex-global-state.json" && !/^state_\d+\.sqlite(?:-wal)?$/.test(String(filename || ""))) return;
  if (threadStateChangedTimer) clearTimeout(threadStateChangedTimer);
  threadStateChangedTimer = setTimeout(() => broadcast({type: "host/thread-list-invalidated"}), 80);
});
threadStateWatcher.on("error", error => console.warn("[thread state watcher]", error.message));
const terminalSessions = new Map<WebSocket, ReturnType<typeof createTerminalSession>>();
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const reviewDiffs = new ReviewDiffStore();
const liveSessions = new LiveSessionStore();
const threadPaths = new Map<string, string>();
let codexSessionsRoot = resolve(homeDir, ".codex", "sessions");
let seq = 1;
let codex: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = "";
let connected = false;
let shuttingDown = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let httpClosed = false;
const accountLoader = createAccountIdentityLoader(async (refresh) => {
  const account = await request("account/read", { refreshToken: refresh });
  return resolveAccountIdentity(account);
});

let usageCache: any = null, usageAt = 0, usagePending: Promise<any> | null = null;
async function accountUsage() {
  if (usageCache && Date.now() - usageAt < 30000) return {...usageCache, fetchedAt: usageAt};
  if (!usagePending) usagePending = request("account/rateLimits/read", {}).then(value => {
    usageCache = value; usageAt = Date.now(); return {...value, fetchedAt: usageAt};
  }).catch(error => {
    if (usageCache) return {...usageCache, fetchedAt: usageAt, stale: true};
    throw error;
  }).finally(() => {usagePending = null;});
  return usagePending;
}
function startCodex() {
  if (shuttingDown) return;
  if (codex && codex.exitCode === null) return;
  const child = spawn(bundledCodexBin, ["app-server", "--stdio"], {
    cwd: defaultCwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  codex = child;
  connected = false;
  stdoutBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const pos = stdoutBuffer.indexOf("\n");
      if (pos < 0) break;
      const line = stdoutBuffer.slice(0, pos).trim();
      stdoutBuffer = stdoutBuffer.slice(pos + 1);
      if (!line) continue;
      try { handleCodex(JSON.parse(line)); }
      catch (error) { console.error("[codex-webui] invalid app-server JSON:", line, error); }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => console.error("[codex app-server]", String(data).trimEnd()));
  child.on("exit", (code, signal) => {
    connected = false;
    accountLoader.invalidate();
    reviewDiffs.clear();
    pendingUserInputs.clear();
    broadcast({ type: "bridge/status", status: "disconnected", code, signal });
    for (const item of pending.values()) item.reject(new Error("Codex app-server exited"));
    pending.clear();
    if (codex === child) codex = null;
    if (shuttingDown) maybeFinishShutdown();
    else restartTimer = setTimeout(startCodex, 1000);
  });
  initialize().catch((error) => {
    console.error("[codex-webui] initialize failed", error);
    terminateCodex();
  });
}

function terminateCodex(signal: NodeJS.Signals = "SIGTERM") {
  const child = codex;
  if (!child || child.exitCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); return; }
    catch { /* Fall back to terminating the wrapper process. */ }
  }
  child.kill(signal);
}

function maybeFinishShutdown() {
  if (shuttingDown && httpClosed && !codex) process.exit(0);
}

function sendRaw(message: any) {
  if (shuttingDown) throw new Error("Codex WebUI is shutting down");
  startCodex();
  codex!.stdin.write(JSON.stringify(message) + "\n");
}

function request(method: string, params: any = {}) {
  const id = seq++;
  sendRaw({ id, method, params });
  return new Promise<any>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex request timed out: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
}

async function initialize() {
  const result = await request("initialize", {
    clientInfo: { name: "codex-webui", title: "Codex WebUI", version: "0.2.0" },
    capabilities: { experimentalApi: true },
  });
  sendRaw({ method: "initialized", params: {} });
  if (typeof result?.codexHome === "string") codexSessionsRoot = resolve(result.codexHome, "sessions");
  connected = true;
  void accountUsage().catch(error => console.warn("[quota]", error.message));
  broadcast({ type: "bridge/status", status: "connected", info: result });
}

function handleCodex(message: any) {
  if (message.id !== undefined && ("result" in message || "error" in message)) {
    const item = pending.get(Number(message.id));
    if (item) {
      pending.delete(Number(message.id));
      if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else item.resolve(message.result);
      return;
    }
  }
  if (message.id !== undefined && message.method) {
    if (message.method === "item/tool/requestUserInput") pendingUserInputs.set(message.id, message);
    broadcast({ type: "codex/request", payload: message });
    return;
  }
  if (message.method) {
    if (message.method === "turn/completed") for (const [id, req] of pendingUserInputs) {
      if (req.params.threadId === message.params?.threadId && req.params.turnId === message.params?.turn?.id) pendingUserInputs.delete(id);
    }
    if (message.method === "account/updated") accountLoader.invalidate();
    if (message.method === "turn/diff/updated") reviewDiffs.record(message.params || {});
    if (message.method === "item/fileChange/patchUpdated") recordFileChangeDiff(message.params || {});
    if (message.method === "item/completed" && message.params?.item?.type === "fileChange") {
      recordFileChangeDiff({ ...message.params, changes: message.params.item.changes });
    }
    broadcast({ type: "codex/notification", payload: message });
    if (message.method === "turn/completed" && typeof message.params?.threadId === "string") {
      void request("thread/unsubscribe", {threadId: message.params.threadId})
        .catch(error => console.warn("[thread release]", error.message));
    }
  }
}

function recordFileChangeDiff({ threadId, turnId, changes }: any) {
  const diff = unifiedDiffFromFileChanges(Array.isArray(changes) ? changes : []);
  if (diff) reviewDiffs.record({ threadId, turnId, diff });
}

function recordReviewDiffsFromRpc(method: string, params: any, result: any) {
  if (!["thread/read", "thread/resume", "thread/turns/list"].includes(method)) return;
  const threadId = result?.thread?.id || params?.threadId;
  const turns = result?.thread?.turns || result?.data || [];
  if (typeof threadId !== "string" || !Array.isArray(turns)) return;
  for (const turn of turns) {
    const changes = (turn?.items || []).flatMap((item: any) => item?.type === "fileChange" && Array.isArray(item.changes) ? item.changes : []);
    const diff = unifiedDiffFromFileChanges(changes);
    if (typeof turn?.id === "string" && diff) reviewDiffs.record({ threadId, turnId: turn.id, diff });
  }
}

function recordThreadPathsFromRpc(result: any) {
  const threads = [result?.thread, ...(Array.isArray(result?.data) ? result.data : [])].filter(Boolean);
  for (const thread of threads) {
    if (typeof thread?.id === "string" && typeof thread?.path === "string") threadPaths.set(thread.id, thread.path);
  }
}

async function readLiveThread(threadId: unknown, knownRevision?: unknown) {
  const snapshot = await readLiveThreadSnapshot(threadId);
  const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return knownRevision === revision
    ? {unchanged: true, revision, active: snapshot.active, source: snapshot.source}
    : {...snapshot, revision};
}

async function readLiveThreadSnapshot(threadId: unknown) {
  if (typeof threadId !== "string" || !threadId) throw new Error("Invalid thread id");
  const thread = await desktopSync.observe(threadId).catch(() => null);
  if (thread) return {active: !!thread.activeTurnId, turn: thread.turns.at(-1) || null, source: "desktop", settings:{model:thread.model,modelReasoningEffort:thread.modelReasoningEffort,desktopSettings:thread.desktopSettings}, queue:desktopQueue.read(threadId), userInputRequests: (desktopSync.followed.get(threadId)?.state?.requests || []).filter((request: any) => request.method === 'item/tool/requestUserInput')};
  let path = threadPaths.get(threadId);
  if (!path) {
    const result = await request("thread/read", { threadId, includeTurns: false });
    recordThreadPathsFromRpc(result);
    path = threadPaths.get(threadId);
  }
  if (!path) return { active: false, turn: null, lastEventAt: null };
  const child = relative(codexSessionsRoot, resolve(path));
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("Thread rollout is outside the Codex sessions directory");
  const safePath = resolveSafeRegularFile(codexSessionsRoot, child);
  if (!safePath) {
    if (!existsSync(resolve(path))) return { active: false, turn: null, lastEventAt: null };
    throw new Error("Thread rollout is not a safe regular file");
  }
  return {...await liveSessions.read(safePath), userInputRequests: userInputsFor(threadId)};
}

function broadcast(data: any) {
  const text = JSON.stringify(["bridge/status", "pong"].includes(data.type) ? {...data, instanceId:bridgeInstanceId, issuedAt:Date.now()} : data);
  // A stalled client recovers from history instead of accumulating an unbounded event backlog.
  for (const client of clients) if (client.readyState === WebSocket.OPEN) {
    if (client.bufferedAmount > 4 * 1024 * 1024) client.terminate(); else client.send(text);
  }
  for (const client of sseClients) if (!client.writableEnded && !client.destroyed) {
    if (client.writableLength > 4 * 1024 * 1024) client.destroy(); else client.write(`data: ${text}\n\n`);
  }
}

// Built-in app-server section, also used by the desktop pin control.
const PINNED_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318";
function readDesktopState() {
  try {return JSON.parse(readFileSync(resolve(homeDir, ".codex/.codex-global-state.json"), "utf8"));}
  catch (error: any) {if (error.code === "ENOENT") return {}; throw error;}
}
async function browserRequest(method: string, params: any) {
  if (method === "thread/fork") {
    const result = await request(method, {...params, threadSource: "user"});
    const source = await request("thread/read", {threadId: result.thread.forkedFromId, includeTurns: false});
    Object.assign(result.thread, finalizeFork(resolve(homeDir, ".codex"), result.thread, source.thread));
    await request("thread/name/set", {threadId: result.thread.id, name: result.thread.name});
    return result;
  }
  if (method === "host/thread/pin") {
    if (typeof params.threadId !== "string" || typeof params.pinned !== "boolean") throw new Error("Invalid pin request");
    return request("thread/section/move", {threadId:params.threadId, sectionId:params.pinned ? PINNED_SECTION_ID : null});
  }
  if (method === "host/thread/user-input/answer") {
    if (typeof params.threadId !== 'string' || !['string', 'number'].includes(typeof params.requestId)) throw new Error('Invalid question request');
    const localQuestion = pendingUserInputs.get(params.requestId);
    if (localQuestion?.params.threadId === params.threadId) {
      const response = validateUserInputResponse(localQuestion.params.questions, params.response);
      sendRaw({id: localQuestion.id, result: response}); pendingUserInputs.delete(localQuestion.id);
      return {ok: true};
    }
    const native = await desktopSync.observe(params.threadId);
    if (native) {
      const entry = desktopSync.followed.get(params.threadId);
      const question = entry?.state?.requests?.find((req: any) => req.id === params.requestId && req.method === 'item/tool/requestUserInput');
      if (!question) throw new Error('此问题已回答或已失效，请刷新会话');
      return desktop.answerUserInput(entry.owner, params.threadId, params.requestId, validateUserInputResponse(question.params.questions, params.response));
    }
    throw new Error('此问题已回答或已失效，请刷新会话');
  }
  if (method === "thread/turns/list" && params.itemsView === "summary") return readConversationTurns(request, params);
  if(method === "host/thread/queue") return desktopQueue.change(params);
  if(method === "host/thread/settings") {
    const native=await desktopSync.observe(params.threadId);
    if(!native)throw new Error("桌面会话当前不可用");
    const settings=params.settings || {}, allowed=new Set(["model","effort","approvalPolicy","approvalsReviewer","sandboxPolicy","permissions"]);
    if(Object.keys(settings).some(key=>!allowed.has(key)))throw new Error("Unsupported thread setting");
    const owner=desktopSync.followed.get(params.threadId).owner;
    const result=await desktop.raw("thread-follower-update-thread-settings",{conversationId:params.threadId,threadSettings:settings},owner,1);
    if(result.resultType!=="success")throw new Error(result.error);
    return {ok:true};
  }
  if (method === "thread/list") {
    const result = await request(method, {...params, useStateDbOnly: true});
    if (!params.cursor && params.sectionId === undefined && !params.archived) {
      const pinned = await request(method, {sectionId:PINNED_SECTION_ID, limit:100, sortKey:"section_position", sortDirection:"asc", useStateDbOnly:true});
      const ids = new Set(pinned.data.map((thread: any) => thread.id));
      result.data = [...pinned.data, ...result.data.filter((thread: any) => !ids.has(thread.id))];
    }
    result.projects = desktopProjects(readDesktopState(), result.data || []);
    for (const thread of result.data || []) {
      thread.pinned = thread.section?.id === PINNED_SECTION_ID;
      if (typeof thread.path !== "string") continue;
      const child = relative(codexSessionsRoot, resolve(thread.path));
      const safePath = child && !child.startsWith("..") ? resolveSafeRegularFile(codexSessionsRoot, child) : null;
      if (!safePath) continue;
      try {const active = rolloutActivity(safePath); if (active !== null) thread.status = {type: active ? "active" : "idle"};} catch {}
    }
    return result;
  }
  if (method === "thread/read" && params.includeTurns) {
    const [result, native] = await Promise.all([
      readThreadPage(request, params.threadId),
      desktopSync.observe(params.threadId).catch(error => {console.warn("[desktop sync]", error.message); return null;}),
    ]);
    if (native) {
      result.thread = {...result.thread, status: native.status, model:native.model, modelReasoningEffort:native.modelReasoningEffort, desktopSettings:native.desktopSettings, queue:desktopQueue.read(params.threadId), turns: mergeConversationTurns(result.thread.turns, native.turns, !!result.thread.olderTurnsCursor), canAcceptDirectInput: true};
    }
    desktopProjects(readDesktopState(), [result.thread]);
    result.thread.pinned = result.thread.section?.id === PINNED_SECTION_ID;
    return result;
  }
  if (["thread/resume", "turn/start", "turn/steer", "turn/interrupt"].includes(method)) {
    const owner = await desktop.owner(params.threadId);
    if (owner) {
      const history = method === "thread/resume"
        ? await readThreadPage(request, params.threadId)
        : await request("thread/read", {threadId: params.threadId, includeTurns: false});
      if (method === "thread/resume") return {...history, thread: {...history.thread, canAcceptDirectInput: true}};
      await desktopSync.observe(params.threadId);
      const live = await readLiveThread(params.threadId);
      if (method === "turn/steer" && live.turn?.id !== params.expectedTurnId) throw new Error("The active turn changed; refresh and retry");
      return desktop.control(owner, method, method === "turn/start" ? {threadId:params.threadId,input:params.input} : params, history.thread.cwd || defaultCwd);
    }
    const live = await readLiveThread(params.threadId);
    if (live.active) throw new Error("The running task owner is unavailable; keep the desktop task open");
  }
  return request(method, params);
}

const bridgeInstanceId = randomUUID();
// ponytail: receipts last one day in this process; expired/restarted requests must be reconciled, never replayed.
const browserWriteReceipts = new Map<string, {signature: string, createdAt: number, result: Promise<any>}>();
async function dispatchBrowserMessage(message: any) {
  const id = message?.id;
  if (message?.type === "rpc") {
    try {
      if (!isAllowedBrowserRpcMethod(message.method)) throw new Error("RPC method is not available to browser clients");
      const params = message.params || {};
      const execute = () => message.method === "host/thread/live" ? readLiveThread(params.threadId, params.revision) : browserRequest(message.method, params);
      let operation;
      if (message.operation) {
        const key = message.operation.id;
        if (typeof key !== "string" || key.length > 128 || !key || !["thread/start", "turn/start", "host/thread/queue"].includes(message.method)) throw new Error("Invalid write operation");
        if (message.operation.instanceId !== bridgeInstanceId) throw Object.assign(new Error("服务已重启，上一条发送结果待确认，请先核对会话。"), {code:"request_outcome_unknown"});
        const signature = JSON.stringify([message.method, params]), receipt = browserWriteReceipts.get(key);
        if (receipt && receipt.signature !== signature) throw new Error("Write operation does not match its original input");
        if (receipt) operation = receipt.result;
        else {
          const now = Date.now(), ttl = 86_400_000;
          if (!Number.isFinite(message.operation.issuedAt) || now - message.operation.issuedAt > ttl || message.operation.issuedAt > now) throw Object.assign(new Error("发送回执已过期，请先核对会话。"), {code:"request_outcome_unknown"});
          for (const [id, entry] of browserWriteReceipts) if (now - entry.createdAt > ttl) browserWriteReceipts.delete(id);
          operation = Promise.resolve().then(execute);
          browserWriteReceipts.set(key, {signature, createdAt:now, result:operation});
        }
      } else operation = execute();
      const result = await operation;
      recordThreadPathsFromRpc(result);
      recordReviewDiffsFromRpc(message.method, params, result);
      return { type: "rpc/result", id, result };
    } catch (error) {
      if (message.operation && /timed out|timeout|disconnected|socket closed/i.test(String((error as any)?.message))) return {...rpcErrorPayload(id, error), code:"request_outcome_unknown"};
      return rpcErrorPayload(id, error);
    }
  }
  if (message?.type === "codex/response") {
    if (!Number.isSafeInteger(message.requestId)) throw new Error("Invalid Codex request id");
    sendRaw({ id: message.requestId, result: message.result });
    return { type: "ack" };
  }
  if (message?.type === "codex/error") {
    if (!Number.isSafeInteger(message.requestId)) throw new Error("Invalid Codex request id");
    sendRaw({ id: message.requestId, error: message.error });
    return { type: "ack" };
  }
  if (message?.type === "ping") return { type: "pong" };
  throw new Error("Unsupported browser bridge message");
}

async function handleClient(client: WebSocket, message: any) {
  try { client.send(JSON.stringify(await dispatchBrowserMessage(message))); }
  catch (error) { client.send(JSON.stringify(rpcErrorPayload(message?.id, error))); }
}

function readJsonBody(req: IncomingMessage, maxBytes = 256_000) {
  return new Promise<any>((resolvePromise, reject) => {
    let body = "", tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", chunk => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > maxBytes) { tooLarge = true; return; }
      body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) return reject(new Error("Bridge payload too large"));
      try { resolvePromise(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON payload")); }
    });
  });
}

function passwordSetupRequired() {
  return !noAuth && !localhostOnly && !authSecret;
}

function browserPasswordConfigured() {
  return !noAuth && Boolean(environmentPassword || managedPassword || accessToken);
}

function requestMatchesSecret(req: IncomingMessage, submittedPassword: string, expectedSecret: string | null) {
  if (!submittedPassword || !expectedSecret) return false;
  return isRequestAuthorized({
    remoteAddress: req.socket.remoteAddress,
    hostHeader: req.headers.host,
    authorization: `Bearer ${submittedPassword}`,
    accessToken: expectedSecret,
    origin: req.headers.origin,
    fetchSite: req.headers["sec-fetch-site"],
    forwardedFor: req.headers["x-forwarded-for"],
    forwarded: req.headers.forwarded,
    realIp: req.headers["x-real-ip"],
    allowLoopback: false,
  });
}

function validBrowserPassword(req: IncomingMessage, submittedPassword: string) {
  if (environmentPassword) return requestMatchesSecret(req, submittedPassword, environmentPassword);
  if (managedPassword) {
    if (!isSameOriginBrowserRequest(req)) return false;
    return verifyStoredPassword(submittedPassword, managedPassword);
  }
  return requestMatchesSecret(req, submittedPassword, accessToken);
}

function sendAuthError(res: ServerResponse, status: number, error: string, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify({ error }));
}

function issueBrowserSession(req: IncomingMessage, res: ServerResponse) {
  if (!authSecret) throw new Error("Authentication is not configured");
  const session = createPasswordSession(authSecret);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": passwordSessionCookie(session.token, { secure: isSecureBrowserRequest(req, accessToken) }),
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify({ ok: true }));
}

function encodeContentDispositionFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".txt": "text/plain; charset=utf-8",
};

function proxyClaudeApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const target = new URL(url.pathname.slice("/claude/app".length) + url.search, `http://127.0.0.1:${claudeBridgePort}`);
  const headers = { ...req.headers, host: target.host };
  delete headers.origin;
  delete headers.referer;
  const upstream = httpRequest(target, { method: req.method, headers }, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", error => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Claude bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
  req.pipe(upstream);
}

const localBrowserPrefix = "/api/browser/local/";
function localBrowserError(res: ServerResponse, status: number, message: string) {
  const text=message.replace(/[&<>"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]!));
  res.writeHead(status,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="codex-browser-error" content="${text}"><style>body{padding:20px;font:14px/1.5 system-ui;overflow-wrap:anywhere;color-scheme:light dark}</style><p>${text}</p>`);
}
function forwardProxyRequest(req: IncomingMessage, res: ServerResponse) {
  if (!isDirectLoopbackRequest(req)) {
    res.writeHead(407, {"proxy-authenticate": 'Basic realm="Codex WebUI"', connection: "close"});
    res.end("Proxy authentication required");
    return;
  }
  let target: URL;
  try { target = new URL(req.url || ""); }
  catch { res.writeHead(400); res.end("Invalid proxy URL"); return; }
  if (target.protocol !== "http:" && target.protocol !== "https:") {res.writeHead(400);res.end("Unsupported proxy protocol");return;}
  const headers = {...req.headers, host: target.host};
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {method:req.method, headers}, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", error => {if (!res.headersSent) res.writeHead(502);res.end(error.message);});
  req.pipe(upstream);
}
function localBrowserPath(target: URL) {return `${localBrowserPrefix}${Buffer.from(target.origin).toString("base64url")}${target.pathname}${target.search}${target.hash}`;}
function localBrowserTarget(url: URL) {
  const rest=url.pathname.slice(localBrowserPrefix.length),slash=rest.indexOf("/");
  if(slash<0)throw new Error("Invalid browser URL");
  const base=new URL(Buffer.from(rest.slice(0,slash),"base64url").toString("utf8"));
  if(!/^https?:$/.test(base.protocol))throw new Error("Only HTTP and HTTPS URLs are supported");
  return new URL(rest.slice(slash)+url.search,base);
}
function localBrowserReference(value:string,base:URL){
  if(!value||/^(?:#|data:|blob:|javascript:|mailto:|tel:)/i.test(value))return value;
  try{const target=new URL(value,base);return /^https?:$/.test(target.protocol)?localBrowserPath(target):value}catch{return value}
}
function decodeLocalBrowserBody(bytes:Buffer,type:string){
  const charset=type.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]||(/text\/html/i.test(type)?bytes.subarray(0,1024).toString("latin1").match(/<meta\b[^>]*\bcharset\s*=\s*["']?([^\s;"'>]+)/i)?.[1]:null)||"utf-8";
  let decoder;try{decoder=new TextDecoder(charset)}catch{decoder=new TextDecoder("utf-8")}
  return decoder.decode(bytes);
}
function rewriteLocalBrowserBody(body:string,type:string,target:URL){
  if(type.includes("text/html")){
    // ponytail: rewrite markup/CSS only; dynamic script URLs still follow page-origin rules.
    let style="";
    return new HTMLRewriter().on("*",{element(element){
      for(const name of ["src","href","action","poster"]){const value=element.getAttribute(name);if(value)element.setAttribute(name,localBrowserReference(value,target))}
      const srcset=element.getAttribute("srcset");if(srcset)element.setAttribute("srcset",srcset.split(",").map(part=>{const[url,...descriptor]=part.trim().split(/\s+/);return[localBrowserReference(url,target),...descriptor].join(" ")}).join(", "));
      const inline=element.getAttribute("style");if(inline)element.setAttribute("style",rewriteLocalBrowserBody(inline,"text/css",target));
    }}).on("style",{element(){style=""},text(chunk){
      style+=chunk.text;if(chunk.lastInTextNode)chunk.replace(rewriteLocalBrowserBody(style,"text/css",target),{html:true});else chunk.remove();
    }}).onDocument({end(end){end.append('<script>document.addEventListener("DOMContentLoaded",()=>parent.postMessage({type:"codex-browser-ready"},location.origin),{once:true});</script>',{html:true})}}).transform(body);
  }
  if(type.includes("text/css"))return body.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi,(_all,quote,value)=>`url(${quote}${localBrowserReference(value,target)}${quote})`).replace(/(@import\s+)(["'])([^"']+)(\2)/gi,(_all,start,quote,value,end)=>`${start}${quote}${localBrowserReference(value,target)}${end}`);
  if(type.includes("application/json")||type.startsWith("text/plain"))return `<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:16px;font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style><body>${body.replace(/[&<>]/g,value=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[value]!))}</body>`;
  return body;
}

const importClients = new Set<ServerResponse>();
const sessionImports = new SessionImports({home: homeDir, request, publish: (event: any) => {
  for (const client of importClients) if (!client.writableEnded) client.write(`data: ${JSON.stringify(event.jobs)}\n\n`);
}, claudeRequest: async (path: string, body?: any, method = body ? "POST" : "GET") => {
  const response = await fetch(`http://127.0.0.1:${claudeBridgePort}${path}`, {method, headers: {"content-type": "application/json"}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.error || "Claude 服务不可用");
  return result.data ?? result;
}});

const server = createServer(async (req, res) => {
  if (/^https?:\/\//i.test(req.url || "")) {forwardProxyRequest(req, res);return;}
  let url: URL;
  try { url = new URL(req.url || "/", "http://localhost"); }
  catch {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({ error: "Invalid request URL" }));
    return;
  }
  const appRoute = req.method === "GET" && (url.pathname === "/" || url.pathname === "/zcode" || /^\/settings(?:\/[^/]+)?\/?$/.test(url.pathname));
  const loginAssets = new Set(["/", "/index.html", "/style.css", "/favicon.svg", "/auth-bootstrap.js", "/system-theme.js", "/i18n.js", "/codex-brand.js", "/manifest.json", "/assets/codex-lan-icon.png"]);
  if (url.pathname === "/api/auth/status") {
    const authenticated = isAuthorizedHttpRequest(req, authSecret);
    // The HTTPS gateway has already authenticated this browser before forwarding.
    // Exchange that login once; page loads must not consume password-login attempts.
    const remember = authenticated && authSecret && isSecureBrowserRequest(req, accessToken)
      && !verifyPasswordSession(parseCookieHeader(req.headers.cookie).codex_webui_session, authSecret);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
      ...(remember ? { "set-cookie": passwordSessionCookie(createPasswordSession(authSecret!).token, { secure: true }) } : {}),
      ...(authenticated ? { "x-codex-server-id": serverId, "x-codex-lan-url": currentLanUrl() } : {}) });
    res.end(JSON.stringify({
      setupRequired: passwordSetupRequired() && !authenticated,
      passwordRequired: browserPasswordConfigured(),
      authenticated,
      assetVersion: uiAssetVersion(),
    }));
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/setup")) {
    const retryAfter = loginAttempt(loginPeerAddress(req, accessToken));
    if (retryAfter) { sendAuthError(res, 429, "Too many login attempts", { "retry-after": String(retryAfter) }); return; }
  }
  if (url.pathname === "/api/auth/setup") {
    if (req.method !== "POST") {
      sendAuthError(res, 405, "Method not allowed", { allow: "POST" });
      return;
    }
    let payload: any;
    try { payload = await readJsonBody(req, 4096); }
    catch (error) {
      sendAuthError(res, 400, error instanceof Error ? error.message : "Invalid setup request");
      return;
    }
    const submittedPassword = typeof payload?.password === "string" ? payload.password : "";
    if (submittedPassword.length < 12 || submittedPassword.length > 256) {
      sendAuthError(res, 400, "Password must be between 12 and 256 characters");
      return;
    }
    if (!isSameOriginBrowserRequest(req)) {
      sendAuthError(res, 403, "Password setup request was rejected");
      return;
    }
    if (!passwordSetupRequired() || passwordSetupInProgress) {
      sendAuthError(res, 409, "Password setup is no longer available");
      return;
    }
    passwordSetupInProgress = true;
    try {
      const credential = createStoredPassword(submittedPassword) as StoredPassword;
      saveStoredPassword(managedPasswordPath, credential);
      managedPassword = credential;
      authSecret = storedPasswordSessionSecret(credential);
      issueBrowserSession(req, res);
    } catch (error: any) {
      if (error?.code === "EEXIST") {
        try {
          managedPassword = loadStoredPassword(managedPasswordPath);
          authSecret = storedPasswordSessionSecret(managedPassword);
        } catch { /* Keep the original exclusive-create failure as the response. */ }
        sendAuthError(res, 409, "Password setup is no longer available");
      } else {
        console.error("[codex-webui] password setup failed", error);
        sendAuthError(res, 500, "Unable to save the password");
      }
    } finally {
      passwordSetupInProgress = false;
    }
    return;
  }
  if (url.pathname === "/api/auth/login") {
    if (req.method !== "POST") {
      sendAuthError(res, 405, "Method not allowed", { allow: "POST" });
      return;
    }
    let payload: any;
    try { payload = await readJsonBody(req, 4096); }
    catch {
      sendAuthError(res, 401, "Incorrect password");
      return;
    }
    const submittedPassword = typeof payload?.password === "string" ? payload.password : "";
    if (!validBrowserPassword(req, submittedPassword)) {
      sendAuthError(res, 401, "Incorrect password");
      return;
    }
    issueBrowserSession(req, res);
    return;
  }
  if (!isAuthorizedHttpRequest(req, authSecret)) {
    if (appRoute || loginAssets.has(url.pathname)) {
      const file = resolvePublicAsset(appRoute ? "/" : url.pathname, publicDir);
      if (file) {
        res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
        res.end(readFileSync(file));
        return;
      }
    }
    unauthorizedResponse(res);
    return;
  }
  if (url.pathname.startsWith('/api/session-import/')) {
    try {
      if (req.method !== 'GET' && !isSameOriginBrowserRequest(req)) {sendAuthError(res, 403, 'Import request rejected'); return;}
      const route = url.pathname.slice('/api/session-import/'.length);
      if (route === 'events' && req.method === 'GET') {
        res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no'});
        res.write(`retry: 1000\ndata: ${JSON.stringify(sessionImports.snapshot())}\n\n`);
        importClients.add(res); res.on('close', () => importClients.delete(res)); return;
      }
      let result;
      if (route === 'candidates' && req.method === 'GET') result = await sessionImports.candidates(url.searchParams.get('target'), url.searchParams.get('projectPath'));
      else if (route === 'start' && req.method === 'POST') result = await sessionImports.start(await readJsonBody(req, 8192));
      else if (route === 'dismiss' && req.method === 'POST') {sessionImports.dismiss((await readJsonBody(req, 4096)).id); result = {ok: true};}
      else {sendAuthError(res, 405, 'Method not allowed'); return;}
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(result));
    } catch (error) {sendAuthError(res, 400, error instanceof Error ? error.message : String(error));}
    return;
  }
  if (url.pathname === "/api/zcode/relay-proof") {
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
    try {
      const payload = await readJsonBody(req, 4096);
      const proof = createZcodeTerminalProof(payload?.nonce, payload?.deviceSid);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ proof }));
    } catch { sendAuthError(res, 403, "Invalid relay challenge"); }
    return;
  }
  if(url.pathname.startsWith(localBrowserPrefix)){
    if(req.method!=="GET"&&req.method!=="HEAD"){res.setHeader("allow","GET, HEAD");localBrowserError(res,405,"当前网页预览不支持此请求。");return}
    const abort=new AbortController(),cancel=()=>abort.abort();res.once("close",cancel);
    try{
      const headers:Record<string,string>={};for(const name of ["accept","accept-language","user-agent",...Object.keys(req.headers).filter(name=>name.startsWith("sec-ch-ua"))]){const value=req.headers[name];if(typeof value==="string")headers[name]=value}
      const target=localBrowserTarget(url),upstream=await fetch(target,{redirect:"manual",headers,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])}),location=upstream.headers.get("location");
      if(location){res.writeHead(upstream.status,{location:localBrowserPath(new URL(location,target)),"cache-control":"no-store"});res.end();return}
      if(!upstream.ok){localBrowserError(res,upstream.status,`网站返回错误（HTTP ${upstream.status}）。`);return}
      const type=upstream.headers.get("content-type")||"application/octet-stream",bytes=Buffer.from(await upstream.arrayBuffer()),rewritable=/^(?:text\/|application\/(?:javascript|json))/i.test(type),rewritten=rewritable?rewriteLocalBrowserBody(decodeLocalBrowserBody(bytes,type),type,target):null,body=rewritten===null?bytes:Buffer.from(rewritten),responseType=(type.includes("application/json")||type.startsWith("text/plain"))?"text/html; charset=utf-8":rewritable?`${type.split(";")[0]}; charset=utf-8`:type;
      const compressed=rewritable&&body.length>1024&&String(req.headers["accept-encoding"]||"").split(",").some(part=>/^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.[0-9]*[1-9][0-9]*))?\s*$/.test(part)),payload=compressed?gzipSync(body):body;
      res.writeHead(upstream.status,{"content-type":responseType,"content-length":payload.length,"cache-control":"no-store","x-content-type-options":"nosniff",vary:"Accept-Encoding",...(compressed?{"content-encoding":"gzip"}:{})});res.end(req.method==="HEAD"?undefined:payload);
    }catch(error){if(!res.destroyed){const reason=error instanceof Error?error.message:String(error);localBrowserError(res,502,/CERT_|TLS|SSL/i.test(reason)?"此网站的安全证书无效，请检查网址。":"无法连接网站，请检查网址或稍后重试。")}}finally{res.off("close",cancel)}
    return;
  }
  if (url.pathname === "/api/attachments") {
    if (req.method !== "POST") {res.writeHead(405, {allow:"POST"}); res.end(); return;}
    if (Number(req.headers["content-length"]) > MAX_UPLOAD_BYTES) {
      res.writeHead(413, {"content-type":"application/json"});res.end(JSON.stringify({error:"单个附件不能超过 25 MB"}));return;
    }
    try {
      const attachment = await saveUpload(req, url.searchParams.get("name"));
      res.writeHead(200, {"content-type":"application/json", "cache-control":"no-store"});
      res.end(JSON.stringify(attachment));
    } catch (error) {
      res.writeHead(400, {"content-type":"application/json"});
      res.end(JSON.stringify({error:error instanceof Error ? error.message : String(error)}));
    }
    return;
  }
  if (url.pathname === "/api/events") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    res.flushHeaders?.();
    res.write("retry: 1000\n\n");
    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "bridge/status", status: connected ? "connected" : "connecting", instanceId:bridgeInstanceId, issuedAt:Date.now() })}\n\n`);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (url.pathname === "/api/rpc" || url.pathname === "/api/codex/respond") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const historyStarted = payload.method === "thread/read" && payload.params?.includeTurns ? Date.now() : 0;
      const message = url.pathname === "/api/rpc"
        ? { type: "rpc", id: payload.id, method: payload.method, params: payload.params || {}, operation: payload.operation }
        : { type: payload.error ? "codex/error" : "codex/response", requestId: payload.requestId, result: payload.result, error: payload.error };
      const reply = await dispatchBrowserMessage(message);
      const json = Buffer.from(JSON.stringify(reply));
      const compressed = json.length > 1024 && String(req.headers["accept-encoding"] || "").split(",").some(part => /^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.[0-9]*[1-9][0-9]*))?\s*$/.test(part));
      const body = compressed ? gzipSync(json) : json;
      if (historyStarted) res.once("finish", () => console.info(`[thread/read] ${payload.params.threadId} ${Date.now() - historyStarted}ms ${json.length}->${body.length} bytes`));
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store", "x-content-type-options": "nosniff", vary: "Accept-Encoding", ...(historyStarted ? {"server-timing": `thread-read;dur=${Date.now() - historyStarted}`} : {}), ...(compressed ? {"content-encoding": "gzip"} : {}) });
      res.end(body);
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/zcode/client") {
    if (req.method !== "GET") { res.writeHead(405, { allow: "GET" }); res.end(); return; }
    try {
      const { deviceSid } = loadZcodeRelayAuth();
      const destination = new URL("http://localhost/remote/v4/");
      destination.searchParams.set("sid", deviceSid);
      destination.searchParams.set("hash", "local-proxy");
      destination.searchParams.set("t", String(Date.now()));
      destination.searchParams.set("theme", url.searchParams.get("theme") === "dark" ? "dark" : "light");
      res.writeHead(302, { location: destination.pathname + destination.search, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end();
    } catch (error) {
      console.warn("[codex-webui] ZCode Remote Control unavailable:", error instanceof Error ? error.message : String(error));
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("ZCode Remote Control is unavailable. Open ZCode and enable Remote Control, then reload this page.");
    }
    return;
  }
  if (url.pathname === "/remote/v4/") {
    const file = resolveSafeRegularFile(publicDir, "zcode-remote.html");
    if (!file) { res.writeHead(404); res.end(); return; }
    sendStatic(req, res, file);
    return;
  }
  if (url.pathname.startsWith("/remote/v4/assets/")) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }
    const assetName = url.pathname.slice("/remote/v4/assets/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(assetName)) { res.writeHead(404); res.end(); return; }
    let pendingAsset = zcodeAssetCache.get(assetName);
    if (!pendingAsset) {
      pendingAsset = fetch(`https://zcode.z.ai/remote/v4/assets/${assetName}`, { signal: AbortSignal.timeout(30_000) }).then(async response => {
        if (!response.ok) throw new Error(`ZCode asset request failed: ${response.status}`);
        return { body: adaptZcodeAsset(assetName, Buffer.from(await response.arrayBuffer())), contentType: response.headers.get("content-type") || "application/octet-stream" };
      });
      zcodeAssetCache.set(assetName, pendingAsset);
      pendingAsset.catch(() => zcodeAssetCache.delete(assetName));
    }
    try {
      const asset = await pendingAsset;
      res.writeHead(200, { "content-type": asset.contentType, "content-length": String(asset.body.length), "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : asset.body);
    } catch {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("ZCode asset unavailable");
    }
    return;
  }
  if (url.pathname === "/claude") {
    res.writeHead(302, { location: "/claude/app/", "cache-control": "no-store" });
    res.end();
    return;
  }
  if (url.pathname.startsWith("/claude/app/api/")) {
    proxyClaudeApi(req, res, url);
    return;
  }
  if (url.pathname === "/claude/app" || url.pathname === "/claude/app/") {
    const file = resolveSafeRegularFile(claudeBridgeDist, "index.html");
    if (!file) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); res.end("Claude build is missing. Run npm run build:claude from the project root."); return; }
    sendStatic(req, res, file);
    return;
  }
  if (url.pathname.startsWith("/claude/app/")) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }
    const file = resolveSafeRegularFile(claudeBridgeDist, url.pathname.slice("/claude/app/".length));
    if (!file) { res.writeHead(404); res.end(); return; }
    sendStatic(req, res, file);
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, codex: connected, version: "0.2.0" }));
    return;
  }
  if (url.pathname === "/api/config") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ home: homeDir, defaultCwd, reviewRoot: reviewRoots[0] }));
    return;
  }
  if (url.pathname === "/api/workspace/context") {
    try {
      const context = readWorkspaceContext(url.searchParams.get("cwd") || defaultCwd, browseRoots);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(context));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/list" || url.pathname === "/api/files/preview") {
    if (req.method !== "GET") {res.writeHead(405, {allow:"GET"});res.end();return;}
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      let result: any;
      if (url.pathname.endsWith("/list")) {
        const path = resolveBrowsePath(url.searchParams.get("path") || cwd, fileRoots, homeDir);
        const entries = readdirSync(path, {withFileTypes:true}).filter(entry => entry.isDirectory() || entry.isFile())
          .map(entry => ({name:entry.name,path:resolve(path,entry.name),directory:entry.isDirectory()}))
          .sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
        let parent: string | null = null;
        try {const candidate=resolveBrowsePath(resolve(path,".."),fileRoots,homeDir);if(candidate!==path)parent=candidate;} catch {}
        result={path,parent,entries};
      } else {
        const file=resolveLocalFile(url.searchParams.get("path"),{cwd,home:homeDir,allowedRoots:fileRoots});
        const extension=extname(file.path).toLowerCase();
        result={...file,parent:resolve(file.path,"..")};
        if ([".png",".jpg",".jpeg",".gif",".webp"].includes(extension)) result.kind="image";
        else if(isPreviewDocument(file.path)) {
          const document=await previewDocument(file);
          Object.assign(result,{kind:"document",pages:document.pages,version:document.version,width:document.width,height:document.height});
        }
        else if(file.size>2*1024*1024) Object.assign(result,{kind:"download",reason:"文件超过 2 MB，请下载查看"});
        else {
          const bytes=readFileSync(file.path);
          if(bytes.includes(0)) Object.assign(result,{kind:"download",reason:"此文件格式请下载查看"});
          else Object.assign(result,{kind:/^\.(html?|xhtml)$/i.test(extension)?"html":/^\.(md|markdown)$/i.test(extension)?"markdown":"text",text:bytes.toString("utf8")});
        }
      }
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(result));
    } catch(error) {
      res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));
    }
    return;
  }
  if (url.pathname === "/api/files/document-page") {
    if(req.method!=="GET"){res.writeHead(405,{allow:"GET"});res.end();return;}
    try {
      const file=resolveLocalFile(url.searchParams.get("path"),{cwd:url.searchParams.get("cwd")||defaultCwd,home:homeDir,allowedRoots:fileRoots});
      const page=Number(url.searchParams.get("page")),rendered=await documentPage(file,page);
      const etag=`"${rendered.version}-${page}"`;
      const headers={"content-type":"image/jpeg","cache-control":url.searchParams.get("v")===rendered.version?"private, max-age=86400, immutable":"no-cache",etag,"x-content-type-options":"nosniff"};
      if(req.headers["if-none-match"]===etag){res.writeHead(304,headers);res.end();return;}
      res.writeHead(200,{...headers,"content-length":statSync(rendered.path).size});
      const stream=createReadStream(rendered.path);stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
    } catch(error) {
      res.writeHead(400,{"content-type":"application/json","cache-control":"no-store"});
      res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));
    }
    return;
  }
  if (url.pathname === "/api/files/search") {
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      const query = url.searchParams.get("query") || "";
      const items = await searchWorkspaceFiles(cwd, query, { allowedRoots: browseRoots, limit: 30 });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ cwd, query, items }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/download") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const file = resolveLocalFile(url.searchParams.get("path"), {
        cwd: url.searchParams.get("cwd") || defaultCwd,
        home: homeDir,
        allowedRoots: fileRoots,
      });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(file.size),
        "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeContentDispositionFilename(file.filename)}`,
        "cache-control": "no-store",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      });
      const stream = createReadStream(file.path);
      stream.on("error", () => res.destroy());
      req.on("aborted", () => stream.destroy());
      stream.pipe(res);
    } catch {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: "File unavailable" }));
    }
    return;
  }
  if (url.pathname === "/api/images/local") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const image = resolveLocalImage(url.searchParams.get("path"), {
        cwd: url.searchParams.get("cwd") || defaultCwd,
        home: homeDir,
        allowedRoots: imageRoots,
      });
      const path = url.searchParams.get("preview") === "1" ? await imagePreview(image.path) : image.path;
      const imageStat = statSync(path), size=imageStat.size, etag=`"${size}-${imageStat.mtimeMs}"`;
      const imageHeaders = {
        "content-type": path === image.path ? image.contentType : "image/webp",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
        "cache-control": "private, max-age=300",
        etag,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      };
      if(req.headers['if-none-match']===etag){res.writeHead(304,imageHeaders);res.end();return;}
      res.writeHead(200, {...imageHeaders,"content-length":String(size)});
      res.end(readFileSync(path));
    } catch {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: "Image unavailable" }));
    }
    return;
  }
  if (url.pathname === "/api/account" || url.pathname === "/api/account/avatar" || url.pathname === "/api/account/usage") {
    if (!noAuth && !isLocalAccountRequest(req.socket.remoteAddress, req.headers.host, req.headers["sec-fetch-site"] as string | undefined)) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Account identity is available only on localhost" }));
      return;
    }
    try {
      if (url.pathname === "/api/account/usage") {
        const usage = await accountUsage();
        res.writeHead(200, {"content-type": "application/json", "cache-control": "no-store"});
        res.end(JSON.stringify(usage)); return;
      }
      const account = await accountLoader.get(url.searchParams.get("refresh") === "1");
      if (url.pathname === "/api/account") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(JSON.stringify(toPublicAccountIdentity(account)));
        return;
      }
      if (!account.imageUrl) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "No profile avatar" }));
        return;
      }
      const avatar = await fetchProfileAvatar(account.imageUrl);
      res.writeHead(200, {
        "content-type": avatar.contentType,
        "content-length": String(avatar.body.byteLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      });
      res.end(avatar.body);
    } catch (error) {
      console.warn("[codex-webui] account request failed:", error instanceof Error ? error.message : String(error));
      if (url.pathname === "/api/account/avatar") {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "Profile avatar unavailable" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(toPublicAccountIdentity(await resolveAccountIdentity({ account: null, requiresOpenaiAuth: true }))));
    }
    return;
  }
  if (url.pathname === "/api/folders") {
    try {
      const path = resolveBrowsePath(url.searchParams.get("path") || "~", browseRoots, homeDir);
      if (!isDirectory(path)) throw new Error("Directory not found");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(listFolders(path, browseRoots)));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/review/patch") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy(new Error("Review patch payload too large"));
    });
    req.on("end", async () => {
      let requestPayload: ReturnType<typeof parseReviewPatchRequest> | null = null;
      let operationStarted = false;
      let success = false;
      try {
        const payload = JSON.parse(body || "{}");
        requestPayload = parseReviewPatchRequest(payload);
        const stored = reviewDiffs.begin(requestPayload.threadId, requestPayload.turnId, requestPayload.action);
        operationStarted = true;
        const threadResult = await request("thread/read", { threadId: requestPayload.threadId, includeTurns: false });
        const cwd = threadResult?.thread?.cwd;
        if (typeof cwd !== "string" || !cwd) throw new Error("Thread working directory is unavailable");
        const result = await applyReviewPatch({ cwd, diff: stored.diff, action: requestPayload.action }, reviewRoots);
        success = true;
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (operationStarted && requestPayload) reviewDiffs.finish(requestPayload.threadId, requestPayload.turnId, requestPayload.action, success);
      }
    });
    return;
  }
  if (url.pathname.startsWith("/vendor/katex/")) {
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice("/vendor/katex/".length)); }
    catch { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
    const katexDir = resolve(appRoot, "node_modules/katex/dist");
    const file = resolveSafeRegularFile(katexDir, relative);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
    }
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "public, max-age=86400" });
    res.end(readFileSync(file));
    return;
  }
  if (url.pathname === "/vendor/xterm/xterm.css") {
    const xtermDir = resolve(appRoot, "node_modules/@xterm/xterm/css");
    const file = resolveSafeRegularFile(xtermDir, "xterm.css");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
    }
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" });
    res.end(readFileSync(file));
    return;
  }
  const file = resolvePublicAsset(appRoute ? "/" : url.pathname, publicDir);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
  }
  sendStatic(req, res, file);
});

const sseKeepalive = setInterval(() => {
  broadcast({type:"pong"});
}, 15_000);
sseKeepalive.unref();

const wss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });
const zcodeRelayWss = new WebSocketServer({ noServer: true });
const zcodeLocalDeviceRelay = startZcodeLocalDeviceRelay();
server.on("connect", (req, socket, head) => {
  if (!isDirectLoopbackRequest(req)) {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Codex WebUI"\r\nConnection: close\r\n\r\n');
    return;
  }
  let target: URL;
  try {target = new URL(`http://${req.url}`);}
  catch {socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");return;}
  const upstream = netConnect(Number(target.port || 443), target.hostname, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
});
server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try { pathname = new URL(req.url || "/", "http://localhost").pathname; }
  catch { socket.destroy(); return; }
  // Carry the existing HTTP proxy through the authenticated HTTPS reverse proxy.
  if (pathname === "/browser-proxy" && isAuthorizedHttpRequest(req, authSecret) && req.headers.upgrade === "codex-http-proxy") {
    const upstream = netConnect(port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: codex-http-proxy\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    return;
  }
  if (pathname === "/claude/app/ws" && isAuthorizedHttpRequest(req, authSecret)) {
    const upstream = netConnect(claudeBridgePort, "127.0.0.1", () => {
      const lines = ["GET /ws HTTP/1.1", `Host: 127.0.0.1:${claudeBridgePort}`];
      for (const name of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions", "authorization"]) {
        const value = req.headers[name];
        if (value !== undefined) lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    return;
  }
  if ((pathname !== "/ws" && pathname !== "/terminal" && pathname !== "/zcode-relay") || !isAuthorizedHttpRequest(req, authSecret)) {
    const body = JSON.stringify({ error: "Authentication required" });
    socket.end([
      "HTTP/1.1 401 Unauthorized",
      "Connection: close",
      'WWW-Authenticate: Basic realm="Codex WebUI", charset="UTF-8"',
      "Content-Type: application/json; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "X-Content-Type-Options: nosniff",
      "",
      body,
    ].join("\r\n"));
    return;
  }
  const target = pathname === "/terminal" ? terminalWss : pathname === "/zcode-relay" ? zcodeRelayWss : wss;
  target.handleUpgrade(req, socket, head, client => target.emit("connection", client, req));
});
wss.on("connection", (client) => {
  clients.add(client);
  client.send(JSON.stringify({ type: "bridge/status", status: connected ? "connected" : "connecting", instanceId:bridgeInstanceId, issuedAt:Date.now() }));
  client.on("message", (raw) => {
    try { handleClient(client, JSON.parse(String(raw))); }
    catch (error) { client.send(JSON.stringify({ type: "rpc/error", error: String(error) })); }
  });
  client.on("close", () => clients.delete(client));
});
zcodeRelayWss.on("connection", client => attachZcodeRelay(client));
terminalWss.on("connection", (client, req) => {
  let terminal: ReturnType<typeof createTerminalSession> | null = null;
  try {
    const url = new URL(req.url || "/terminal", "http://localhost");
    const cwd = resolveTerminalCwd(url.searchParams.get("cwd"), browseRoots, defaultCwd);
    terminal = createTerminalSession({
      cwd,
      cols: 100,
      rows: 24,
      onData: data => { if (client.readyState === WebSocket.OPEN) client.send(data); },
      onExit: event => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`\r\n[Process exited ${event.exitCode}]\r\n`);
          client.close(1000, "Terminal exited");
        }
      },
    });
    terminalSessions.set(client, terminal);
  } catch (error) {
    console.error("[codex-webui] terminal failed", error);
    client.close(1011, "Terminal unavailable");
    return;
  }
  client.on("message", (raw, isBinary) => {
    if (!terminal || raw.byteLength > 1_000_000) return;
    if (isBinary) {
      terminal.write(Buffer.from(raw as Buffer).toString("utf8"));
      return;
    }
    try {
      const resize = normalizeTerminalResize(JSON.parse(String(raw)));
      if (resize) terminal.resize(resize.cols, resize.rows);
    } catch { /* Terminal input is sent as binary; ignore malformed control frames. */ }
  });
  client.on("close", () => {
    terminalSessions.delete(client);
    terminal?.kill();
    terminal = null;
  });
  client.on("error", () => client.close());
});

const frontendBuild = await Bun.build({
  entrypoints: [resolve(publicDir, "app.js")],
  outdir: publicDir,
  naming: "app.bundle.js",
  target: "browser",
  minify: true,
});
if (!frontendBuild.success) throw new Error(`Frontend build failed: ${frontendBuild.logs.join("\n")}`);

startCodex();
server.listen(port, host, () => {
  console.log(`Codex WebUI listening on http://${host}:${port}`);
  if (passwordSetupRequired()) console.warn(`[codex-webui] LAN password setup is required; the first LAN visitor will create it in ${managedPasswordPath}`);
  if (!localhostOnly) {
    const addresses = Object.values(networkInterfaces()).flat().filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.family === "IPv4" && !entry.internal);
    for (const entry of addresses) console.log(`LAN: http://${host}:${port} (${noAuth ? "no authentication" : "authentication required"})`);
  }
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  connected = false;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  clearInterval(sseKeepalive);
  if (threadStateChangedTimer) clearTimeout(threadStateChangedTimer);
  threadStateWatcher.close();
  for (const item of pending.values()) item.reject(new Error("Codex WebUI is shutting down"));
  pending.clear();
  for (const client of clients) client.terminate();
  clients.clear();
  for (const client of sseClients) client.end();
  sseClients.clear();
  wss.close();
  for (const [client, terminal] of terminalSessions) { terminal.kill(); client.terminate(); }
  terminalSessions.clear();
  terminalWss.close();
  zcodeRelayWss.close();
  zcodeLocalDeviceRelay.close();
  desktopSync.close();
  terminateCodex();
  server.close(() => { httpClosed = true; maybeFinishShutdown(); });
  server.closeAllConnections?.();
  const forceExit = setTimeout(() => {
    terminateCodex("SIGKILL");
    process.exit(0);
  }, 5000);
  forceExit.unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
