import { DesktopBridge } from './desktop-bridge.mjs';

// Desktop publishes Immer patches over its existing IPC socket.
export function applyPatches(state, patches) {
  for (const {op, path, value} of patches) {
    if (!Array.isArray(path) || path.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Invalid desktop patch path');
    if (!path.length) { state = structuredClone(value); continue; }
    let parent = state;
    for (const key of path.slice(0, -1)) parent = parent[key];
    const key = path.at(-1);
    if (op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
    } else if (op === 'add' || op === 'replace') {
      if (Array.isArray(parent) && op === 'add') parent.splice(key === '-' ? parent.length : Number(key), 0, structuredClone(value));
      else parent[key] = structuredClone(value);
    } else throw new Error(`Unsupported desktop patch: ${op}`);
  }
  return state;
}

function desktopItems(turn) {
  const source = turn.items || [];
  const items = source.filter(item => item.type !== 'steered' &&
    (item.type !== 'steeringUserMessage' || !item.serverUserMessageId ||
      !source.some(other => other.type === 'userMessage' && other.id === item.serverUserMessageId)));
  // Native reasoning has no item status. Only the latest assistant activity can
  // still be thinking; accepting a user follow-up does not finish that activity.
  const latestActivity = items.findLast(item => !['userMessage', 'steeringUserMessage'].includes(item.type));
  return items.map(item => {
    if (item.type === 'reasoning' && !item.status) return {...item,
      status: turn.status === 'inProgress' && item === latestActivity ? 'inProgress' : 'completed'};
    if (item.type === 'contextCompaction') return {...item,
      status: item.completed ? 'completed' : turn.status === 'inProgress' ? 'inProgress' : turn.status === 'failed' ? 'failed' : 'interrupted'};
    return item.type === 'steeringUserMessage' ? {
      id: item.serverUserMessageId || item.clientUserMessageId || item.id,
      clientId: item.clientUserMessageId, type: 'userMessage', content: item.input || [], status: item.status,
    } : item;
  });
}

export function desktopThread(state) {
  const history = state.turnHistory;
  const nativeTurns = history?.kind === 'canonical'
    ? Object.values(history.history.entitiesByKey) : state.turns || [];
  const turns = nativeTurns.map(t => ({
    id: t.turnId, status: t.status, items: desktopItems(t),
    createdAt: t.turnStartedAtMs, startedAtMs: t.turnStartedAtMs, durationMs: t.durationMs, error: t.error,
    completedAt: t.durationMs == null ? null : t.turnStartedAtMs + t.durationMs,
  })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const settings = state.latestThreadSettings || {}, permissions = state.currentPermissions || {};
  const activeTurnId = turns.findLast(t => t.status === 'inProgress')?.id || null;
  return {
    id: state.id, cwd: state.cwd, name: state.title || state.generatedTitle,
    createdAt: state.createdAt, updatedAt: state.updatedAt,
    model: settings.model ?? state.latestModel,
    modelReasoningEffort: settings.effort === undefined ? state.latestReasoningEffort ?? state.latestCollaborationMode?.settings?.reasoning_effort ?? null : settings.effort,
    desktopSettings: {approvalPolicy:settings.approvalPolicy ?? permissions.approvalPolicy,approvalsReviewer:settings.approvalsReviewer ?? permissions.approvalsReviewer,sandboxPolicy:settings.sandboxPolicy ?? permissions.sandboxPolicy,activePermissionProfile:settings.activePermissionProfile === undefined ? permissions.activePermissionProfile : settings.activePermissionProfile},
    status: {type: activeTurnId ? 'active' : 'idle'}, activeTurnId, turns,
  };
}

export class DesktopSync {
  bridge = new DesktopBridge();
  followed = new Map();
  waiting = new Map();
  emitted = new Map();

  constructor(emit) {
    this.emit = emit;
    this.bridge.onBroadcast = m => this.receive(m);
    this.bridge.onDisconnect = () => {
      for (const entry of this.followed.values()) entry.revision = null;
    };
  }

  subscribe(threadId, owner) {
    this.bridge.write({type: 'broadcast', method: 'thread-stream-following-changed',
      sourceClientId: this.bridge.clientId, version: 1, targetClientIds: [owner],
      params: {hostId: 'local', conversationId: threadId, following: true}});
  }

  async follow(threadId, owner) {
    let entry = this.followed.get(threadId);
    if (entry?.owner === owner && entry.revision != null) { entry.ownerCheckedAt = Date.now(); return entry; }
    entry = entry?.owner === owner ? entry : {owner, revision: null, state: null, ownerCheckedAt: Date.now()};
    this.followed.set(threadId, entry);
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(threadId); reject(new Error('Desktop state subscription timed out')); }, 5000);
      this.waiting.set(threadId, () => { clearTimeout(timer); resolve(entry); });
    });
    this.subscribe(threadId, owner);
    return ready;
  }

  receive(message) {
    if(message.method === 'thread-queued-followups-changed') {
      const entry=this.followed.get(message.params.conversationId);
      if(entry?.owner===message.sourceClientId)this.emit({method:'host/thread/queue',params:{threadId:message.params.conversationId,messages:message.params.messages}});
      return;
    }
    if (message.method === 'thread-stream-following-status-requested') {
      const entry = this.followed.get(message.params.conversationId);
      if (entry) {
        if (entry.owner !== message.sourceClientId) {
          entry.owner = message.sourceClientId;
          entry.revision = null;
          entry.state = null;
        }
        entry.ownerCheckedAt = Date.now();
        this.subscribe(message.params.conversationId, entry.owner);
      }
      return;
    }
    if (message.method !== 'thread-stream-state-changed') return;
    const {conversationId: threadId, change} = message.params;
    const entry = this.followed.get(threadId);
    if (!entry || message.sourceClientId !== entry.owner) return;
    try {
      if (entry.revision != null && (change.revision === entry.revision || (typeof change.revision === 'number' && typeof entry.revision === 'number' && change.revision < entry.revision))) return;
      if (change.type === 'snapshot') entry.state = change.conversationState;
      else if (change.type === 'patches' && change.baseRevision === entry.revision) entry.state = applyPatches(entry.state, change.patches);
      else { entry.revision = null; this.subscribe(threadId, entry.owner); return; }
      entry.revision = change.revision;
      this.waiting.get(threadId)?.();
      this.waiting.delete(threadId);
      this.publish(threadId, desktopThread(entry.state));
    } catch (error) {
      console.warn('Desktop synchronization failed:', error.message);
      entry.revision = null;
      this.subscribe(threadId, entry.owner);
    }
  }

  settingsSent = new Map();
  publish(threadId, thread) {
    const settings={threadId,model:thread.model,modelReasoningEffort:thread.modelReasoningEffort,desktopSettings:thread.desktopSettings};
    const encoded=JSON.stringify(settings);
    if(this.settingsSent.get(threadId)!==encoded){this.settingsSent.set(threadId,encoded);this.emit({method:'host/thread/settings',params:settings});}
    const turn = thread.turns.at(-1);
    if (!turn) return;
    const previous = this.emitted.get(threadId);
    const sameTurn = previous?.id === turn.id;
    if (turn.status === 'inProgress' && (!sameTurn || previous.status !== 'inProgress')) {
      this.emit({method: 'turn/started', params: {threadId, turn: {...turn, items: []}}});
    }
    const items = new Map();
    for (const [itemIndex, item] of turn.items.entries()) {
      const encoded = JSON.stringify(item);
      items.set(item.id, encoded);
      if (!sameTurn || previous.items.get(item.id) !== encoded) {
        this.emit({method: item.status === 'inProgress' ? 'item/started' : 'item/completed', params: {threadId, turnId: turn.id, item, itemIndex}});
      }
    }
    if (turn.status !== 'inProgress' && (!sameTurn || previous.status !== turn.status)) {
      this.emit({method: 'turn/completed', params: {threadId, turn}});
    }
    this.emitted.set(threadId, {id: turn.id, status: turn.status, items});
  }

  observing = new Map();
  async observe(threadId) {
    const entry = this.followed.get(threadId);
    if (entry?.revision != null && this.bridge.socket?.writable && Date.now() - entry.ownerCheckedAt < 5000) return desktopThread(entry.state);
    if (this.observing.has(threadId)) return this.observing.get(threadId);
    const operation = (async () => {
      const owner = await this.bridge.owner(threadId);
      if (!owner) { this.followed.delete(threadId); this.emitted.delete(threadId); this.settingsSent.delete(threadId); return null; }
      const entry = await this.follow(threadId, owner);
      return desktopThread(entry.state);
    })();
    this.observing.set(threadId, operation);
    try { return await operation; } finally { this.observing.delete(threadId); }
  }

  close() { this.bridge.socket?.destroy(); }
}
