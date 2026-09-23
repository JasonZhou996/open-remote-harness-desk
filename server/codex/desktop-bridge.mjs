import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class DesktopBridge {
  socket = null;
  ready = null;
  clientId = 'uninitialized';
  buffer = Buffer.alloc(0);
  pending = new Map();

  async open() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const socket = connect(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock'));
      this.socket = socket;
      socket.on('data', chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        try {
          while (this.buffer.length >= 4) {
            const size = this.buffer.readUInt32LE(0);
            if (!size || size > 268435456) throw new Error('Invalid desktop IPC frame');
            if (this.buffer.length < size + 4) break;
            const message = JSON.parse(this.buffer.subarray(4, size + 4).toString());
            this.buffer = this.buffer.subarray(size + 4);
            if (message.type === 'client-discovery-request') {
              this.write({type: 'client-discovery-response', requestId: message.requestId, response: {canHandle: false}});
            } else if (message.type === 'broadcast') {
              this.onBroadcast?.(message);
            } else if (message.type === 'response') {
              const waiting = this.pending.get(message.requestId);
              if (waiting) { clearTimeout(waiting.timer); this.pending.delete(message.requestId); waiting.resolve(message); }
            }
          }
        } catch (error) { socket.destroy(error); }
      });
      socket.on('error', reject);
      socket.on('close', () => {
        this.onDisconnect?.();
        this.ready = null; this.socket = null; this.buffer = Buffer.alloc(0);
        reject(new Error('Desktop IPC disconnected'));
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Desktop IPC disconnected')); }
        this.pending.clear();
      });
      socket.on('connect', async () => {
        try {
          const response = await this.raw('initialize', {clientType: 'codex-webui-lan'});
          if (response.resultType !== 'success') throw new Error(response.error);
          this.clientId = response.result.clientId;
          resolve();
        } catch (error) { reject(error); socket.destroy(); }
      });
    });
    return this.ready;
  }

  write(message) {
    if (!this.socket?.writable) throw new Error('Desktop IPC unavailable');
    const data = Buffer.from(JSON.stringify(message));
    const frame = Buffer.allocUnsafe(4 + data.length);
    frame.writeUInt32LE(data.length); data.copy(frame, 4); this.socket.write(frame);
  }

  raw(method, params, targetClientId, version = 0) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Desktop request timed out')); }, 15000);
      this.pending.set(requestId, {resolve, reject, timer});
      try { this.write({type: 'request', requestId, sourceClientId: this.clientId, method, params, version, targetClientId, timeoutMs: 12000}); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }

  async owner(threadId) {
    await this.open();
    const response = await this.raw('thread-owner-discovery', {hostId: 'local', conversationId: threadId}, undefined, 1);
    if (response.resultType === 'success') return response.handledByClientId;
    if (response.error === 'no-client-found') return null;
    throw new Error(response.error);
  }

  async control(owner, method, params, cwd) {
    // Desktop renders the original request before app-server supplies defaults.
    if (method === 'turn/start' || method === 'turn/steer') {
      params = {...params, input: params.input.map(item => item.type === 'text'
        ? {...item, text_elements: item.text_elements ?? []} : item)};
    }
    const conversationId = params.threadId;
    let name, payload, version;
    if (method === 'turn/start') {
      name = 'thread-follower-start-turn'; version = 2;
      payload = {conversationId, turnStart: {request: params, context: {inheritThreadSettings: true}}};
    } else if (method === 'turn/steer') {
      name = 'thread-follower-steer-turn'; version = 1;
      const text = (params.input || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
      const id = params.clientUserMessageId || randomUUID();
      payload = {conversationId, input: params.input, clientUserMessageId: id,
        restoreMessage: {id, text, cwd, createdAt: Date.now(), context: {prompt: text, workspaceRoots: [cwd], addedFiles: [], fileAttachments: [], imageAttachments: [], ideContext: null}}};
    } else if (method === 'turn/interrupt') {
      name = 'thread-follower-interrupt-turn'; version = 4;
      payload = {conversationId, mode: 'user-stop', expectedTurnId: params.turnId};
    } else throw new Error('Unsupported desktop command');
    const response = await this.raw(name, payload, owner, version);
    if (response.resultType !== 'success') throw new Error(response.error);
    return method === 'turn/interrupt' ? {} : response.result.result;
  }

  async answerUserInput(owner, threadId, requestId, response) {
    const result = await this.raw('thread-follower-submit-user-input', {
      conversationId: threadId, requestId, response,
    }, owner, 1);
    if (result.resultType !== 'success') throw new Error(result.error);
    return {ok: true};
  }
}
