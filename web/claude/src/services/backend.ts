import {t, englishUiError} from '../i18n';
/** Claude service REST and WebSocket client, reached through the unified gateway. */

const TOKEN_KEY = 'cc_bridge_jwt';
/** Deployment base: '/' in dev, '/claude/app/' when served by Codex WebUI. */
const BASE_URL = import.meta.env.BASE_URL || '/';

export type BackendFrame = Record<string, any> & { kind?: string };

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent('cc-auth-changed'));
}

async function api<T = any>(path: string, init: RequestInit = {}, baseUrl = BASE_URL): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string> | undefined)
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path.replace(/^\//, '')}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(t(englishUiError((typeof body.error === 'string' ? body.error : body.error?.message) || body.message || `Request failed (${res.status})`)));
    (err as any).status = res.status;
    (err as any).code = body.code;
    throw err;
  }
  return (body.data ?? body) as T;
}

// ---------------------------------------------------------------- websocket

type FrameListener = (frame: BackendFrame) => void;
const listeners = new Set<FrameListener>();
/** Highest seq seen per session — replay cursor across reconnects. */
const lastSeqBySession = new Map<string, number>();
/** Sessions to resubscribe after a reconnect. */
const wantedSubscriptions = new Set<string>();

let ws: WebSocket | null = null;
let wsEverOpened = false;
let reconnectTimer: number | null = null;
/** Frames emitted before anyone subscribed are queued, not dropped. */
const earlyFrames: BackendFrame[] = [];

function trackSeq(frame: BackendFrame) {
  if (typeof frame.seq === 'number' && typeof frame.sessionId === 'string') {
    lastSeqBySession.set(frame.sessionId, frame.seq);
  }
}

function dispatch(frame: BackendFrame) {
  if (!(frame as any).kind) return;
  trackSeq(frame);
  if (listeners.size === 0 && earlyFrames.length < 200) {
    earlyFrames.push(frame);
    return;
  }
  listeners.forEach((fn) => {
    try {
      fn(frame);
    } catch (e) {
      console.error('[ws listener]', e);
    }
  });
}

function sendRaw(payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function resubscribeAll() {
  if (wantedSubscriptions.size === 0) return;
  sendRaw({
    type: 'chat.subscribe',
    sessions: Array.from(wantedSubscriptions).map((sessionId) => ({
      sessionId,
      lastSeq: lastSeqBySession.get(sessionId)
    }))
  });
}

export function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const token = getToken();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}${BASE_URL}ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error('[ws] construct failed', e);
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    wsEverOpened = true;
    resubscribeAll();
    // Anything buffered while offline/closed now reaches the listeners.
    while (earlyFrames.length > 0) {
      const frame = earlyFrames.shift()!;
      listeners.forEach((fn) => fn(frame));
    }
  };
  ws.onmessage = (event) => {
    let frame: any;
    try {
      frame = JSON.parse(event.data as string);
    } catch {
      return;
    }
    // One TCP frame may carry several NDJSON lines on some transports.
    if (Array.isArray(frame)) frame.forEach(dispatch);
    else dispatch(frame);
  };
  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* onclose follows */
  };
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (wsEverOpened || listeners.size) connectWebSocket();
  }, 2000);
}

// ------------------------------------------------------------------- public

export const backend = {
  api,
  setToken,

  filePreview: (path: string, cwd: string) => api<{path:string;filename:string;kind:string;text?:string;reason?:string}>(`/api/files/preview?${new URLSearchParams({path, cwd})}`, {}, '/'),

  auth: {
    status: () => api<{ needsSetup: boolean; loggedIn: boolean }>('/api/auth/status'),
    async login(username: string, password: string): Promise<{ token: string }> {
      return api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
    },
    async register(username: string, password: string): Promise<{ token: string }> {
      return api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
    }
  },

  workspace: (projectId?: string) => api<NativeCatalog>(`/api/providers/claude/workspace${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  instructions: (projectId?: string) => api<Instructions>(`/api/providers/claude/instructions?scope=${projectId ? 'project&projectId=' + encodeURIComponent(projectId) : 'user'}`),
  saveInstructions: (value: Instructions, projectId?: string) => api<Instructions>('/api/providers/claude/instructions', {method:'PUT', body:JSON.stringify({...value, scope:projectId ? 'project' : 'user', projectId})}),
  async upload(files: File[]) {
    const body = new FormData(); files.forEach(file => body.append('files', file));
    return api<{attachments: Array<{path:string;name:string;mimeType:string;size:number}>}>('/api/assets/files', {method:'POST',body});
  },
  projects: () => api<{ projects: any[] }>('/api/projects'),

  /** Real subscription plan + rate-limit windows from the CLI's OAuth token. */
  claudeUsage: () => api<{ plan: string; usage?: any; error?: string }>('/api/providers/claude/usage'),
  claudeUsageRefresh: () => api<{ plan: string; usage?: any; error?: string; captured_at?: string }>('/api/providers/claude/usage/refresh', { method: 'POST' }),

  runningSessions: () =>
    api<{ sessions: Array<{ sessionId: string }> }>('/api/providers/sessions/running'),

  recentSessions: (limit = 100) =>
    api<{ conversations: any[]; total: number; hasMore: boolean }>(
      `/api/providers/sessions/recent?limit=${limit}`
    ),

  sessionMessages: (sessionId: string) =>
    api<{ messages: any[]; total: number; hasMore: boolean }>(
      `/api/providers/sessions/${sessionId}/messages`
    ),

  createSession: (projectPath: string, initialMessage: string) =>
    api<{ sessionId: string; sessionName: string }>('/api/providers/sessions', {
      method: 'POST',
      body: JSON.stringify({ provider: 'claude', projectPath, initialMessage })
    }),

  sessionActiveModel: (sessionId: string) =>
    api<{ model: string | null; effort: string | null }>(
      `/api/providers/claude/sessions/${sessionId}/active-model?requestedModel=default`
    ),

  sessionPermissionMode: (sessionId: string) =>
    api<{mode:string}>(`/api/providers/sessions/${sessionId}/permission-mode`),
  setPermissionMode: (sessionId: string, mode: string) =>
    api<{mode:string;appliedToActiveRun:boolean}>(`/api/providers/sessions/${sessionId}/permission-mode`, {method:'POST',body:JSON.stringify({mode})}),

  renameSession: (sessionId: string, name: string) =>
    api<{sessionId: string; summary: string}>(`/api/providers/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({ summary: name })
    }),

  deleteSession: (sessionId: string) =>
    api(`/api/providers/sessions/${sessionId}`, { method: 'DELETE' }),

  retractMessage: (sessionId: string, anchorId: string) =>
    api<{messages:any[]}>(`/api/providers/sessions/${sessionId}/retract`, {
      method:'POST', body:JSON.stringify({anchorId}),
    }),

  // ------------------------------------------------------------- websocket

  connect: connectWebSocket,

  onFrame(fn: FrameListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  subscribeSessions(sessionIds: string[]) {
    sessionIds.forEach((id) => wantedSubscriptions.add(id));
    if (sessionIds.length === 0) return;
    sendRaw({
      type: 'chat.subscribe',
      sessions: sessionIds.map((sessionId) => ({
        sessionId,
        lastSeq: lastSeqBySession.get(sessionId)
      }))
    });
  },

  sendChat(
    sessionId: string,
    content: string,
    options?: { model?: string; effort?: string; permissionMode?: string; attachments?: unknown[] }
  ) {
    if (!sendRaw({ type: 'chat.send', sessionId, content, options: options ?? {} })) {
      throw new Error(t("Connection is not ready. Please try again shortly."));
    }
  },

  editSend(sessionId: string, anchorId: string, content: string, options: {model?:string;effort?:string;permissionMode?:string} = {}) {
    if (!sendRaw({ type: 'chat.edit-send', sessionId, anchorId, content, options })) {
      throw new Error(t("Connection is not ready. Please try again shortly."));
    }
  },

  abort(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = ws;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        listeners.delete(onFrame);
        socket?.removeEventListener('close', onClose);
        error ? reject(error) : resolve();
      };
      const onClose = () => finish(new Error(t("Connection lost. No new message was sent.")));
      const onFrame = (frame: BackendFrame) => {
        if (frame.sessionId !== sessionId) return;
        if (frame.kind === 'complete') {
          finish(frame.aborted && frame.exitCode !== 0 ? new Error(t("Could not stop the response. No new message was sent.")) : undefined);
        } else if (frame.kind === 'protocol_error') {
          finish(frame.code === 'NO_ACTIVE_RUN' ? undefined : new Error(frame.error || t("Could not stop the response")));
        }
      };
      const timer = setTimeout(() => finish(new Error(t("Timed out waiting for stop confirmation. No new message was sent."))), 15000);
      listeners.add(onFrame);
      socket?.addEventListener('close', onClose);
      if (!sendRaw({ type: 'chat.abort', sessionId })) finish(new Error(t("Connection is not ready. Please try again shortly.")));
    });
  },

  respondPermission(
    requestId: string,
    allow: boolean,
    updatedInput?: unknown,
    rememberEntry?: boolean
  ) {
    if (!sendRaw({
      type: 'chat.permission-response',
      requestId,
      allow,
      updatedInput,
      rememberEntry
    })) throw new Error(t("Connection lost. Please try again shortly."));
  }
};

export interface NativeModel { value:string; resolvedModel?:string; displayName:string; description:string; supportsEffort?:boolean; supportedEffortLevels?:string[]; supportsAutoMode?:boolean; supportsFastMode?:boolean; menuGroup?:'more' }
export interface NativeCatalog { cwd:string; models:NativeModel[]; commands:Array<{name:string;description:string;argumentHint?:string;builtin?:boolean}>; outputStyles:string[] }
export interface Instructions {path:string;content:string;revision:string}
