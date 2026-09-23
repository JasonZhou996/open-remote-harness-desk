import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, realpath, open, writeFile, link, rm} from 'node:fs/promises';
import {join, dirname, isAbsolute, sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {desktopProjects} from '../codex/desktop-projects.js';

const run = promisify(execFile);
const LIMIT = 64 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const platform = value => {if (!['claude', 'codex'].includes(value)) throw new Error('请选择 Claude Code 或 Codex'); return value;};

// Owns cross-harness jobs for both web clients; conversion runs in a separate process.
export class SessionImports {
  constructor({home, request, claudeRequest, publish, converter = join(home, '.cargo/bin/transession')}) {
    Object.assign(this, {home, request, claudeRequest, publish, converter});
    this.root = join(home, '.local/share/tri-web/imports');
    this.codexHome = process.env.CODEX_HOME || join(home, '.codex');
    this.jobs = new Map();
    mkdirSync(this.root, {recursive: true, mode: 0o700});
    const file = join(this.root, 'jobs.json');
    if (existsSync(file)) for (const job of JSON.parse(readFileSync(file, 'utf8'))) {
      if (job.status === 'running') {job.status = 'failed'; job.error = '服务已重启，导入中断，请重试';}
      this.jobs.set(job.id, job);
    }
    this.save();
  }
  save() {
    const file = join(this.root, 'jobs.json');
    writeFileSync(file + '.tmp', JSON.stringify([...this.jobs.values()]), {mode: 0o600});
    renameSync(file + '.tmp', file);
  }
  snapshot() {return [...this.jobs.values()].map(job => ({...job}));}
  update(job, patch) {Object.assign(job, patch); this.save(); this.publish({type: 'session/import', jobs: this.snapshot()});}
  async cwd(value) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('请先选择项目');
    return realpath(value);
  }
  savedProjects() {
    try {return JSON.parse(readFileSync(join(this.codexHome, '.codex-global-state.json'), 'utf8'));}
    catch (error) {if (error.code === 'ENOENT') return {}; throw error;}
  }
  async sources(target, projectPath) {
    platform(target);
    const cwd = await this.cwd(projectPath);
    if (target === 'codex') return this.claudeRequest(`/api/providers/sessions/import-candidates?projectPath=${encodeURIComponent(cwd)}`);
    const db = new Database(join(this.codexHome, 'state_5.sqlite'), {readonly: true});
    let rows;
    try {rows = db.query("SELECT id, name, title, preview, cwd, project_id AS projectId, rollout_path AS file, updated_at * 1000 AS updatedAt FROM threads WHERE archived = 0 AND thread_source = 'user' ORDER BY updated_at DESC").all();}
    finally {db.close();}
    const saved = this.savedProjects(), projects = desktopProjects(saved, rows);
    const matches = await Promise.all(projects.map(async p => ({...p, matches: (await Promise.all(p.roots.map(root => realpath(root).catch(() => '')))).includes(cwd)})));
    const ids = new Set(matches.filter(p => p.matches).map(p => p.id));
    const selected = await Promise.all(rows.map(async row => {
      // An explicit move or projectless assignment takes precedence over cwd.
      const assigned = saved['thread-project-assignments']?.[row.id] || saved['projectless-thread-ids']?.includes(row.id);
      const match = row.projectId ? ids.has(row.projectId) : !assigned && await realpath(row.cwd).catch(() => '') === cwd;
      return match ? {id: row.id, title: row.name || row.title || row.preview || '未命名对话', file: row.file, updatedAt: row.updatedAt} : null;
    }));
    return selected.filter(Boolean);
  }
  async candidates(target, cwd) {
    const rows = await this.sources(target, cwd);
    return rows.map(({file, ...row}) => row);
  }
  async start({target, projectPath, sourceId, requestId}) {
    platform(target);
    if (typeof sourceId !== 'string' || !UUID.test(sourceId)) throw new Error('来源会话无效');
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new Error('导入请求无效');
    const existing = this.jobs.get('import-' + requestId);
    if (existing) return {...existing};
    if (this.snapshot().filter(j => j.status === 'running').length >= 2) throw new Error('已有两个导入正在进行，请稍后再试');
    const cwd = await this.cwd(projectPath);
    const source = (await this.sources(target, cwd)).find(row => row.id === sourceId);
    if (!source) throw new Error('来源会话不属于当前项目，或已被移除');
    if (!existsSync(this.converter)) throw new Error('尚未安装 transession，请运行 npm run install:converter');
    const sourceRoot = await realpath(join(target === 'codex' ? join(this.home, '.claude') : this.codexHome, target === 'codex' ? 'projects' : 'sessions'));
    const file = await realpath(source.file);
    if (!file.startsWith(sourceRoot + sep) || !file.endsWith('.jsonl') || file.includes('/subagents/')) throw new Error('来源会话文件无效');
    if (this.jobs.has('import-' + requestId)) return {...this.jobs.get('import-' + requestId)};
    if (this.snapshot().filter(j => j.status === 'running').length >= 2) throw new Error('已有两个导入正在进行，请稍后再试');
    const job = {id: 'import-' + requestId, target, sourceId, projectPath: cwd, title: source.title + '（导入）', status: 'running', stage: 0, createdAt: Date.now(), targetId: randomUUID()};
    this.jobs.set(job.id, job);
    this.update(job, {});
    // The HTTP request returns immediately; changing the selected chat never cancels this work.
    setImmediate(() => {void this.perform(job, file);});
    return {...job};
  }
  async command(args) {
    await run(this.converter, args, {timeout: 120000, maxBuffer: 1024 * 1024, env: {...process.env, TRANSESSION_CODEX_BIN: process.env.XARNESS_BUNDLED_CODEX_BIN || 'codex'}});
  }
  async perform(job, sourceFile) {
    const work = join(this.root, job.id), snapshot = join(work, 'source.jsonl'), irFile = join(work, 'session.json'), output = join(work, 'target.jsonl');
    let targetFile, written = false;
    try {
      await mkdir(work, {recursive: true, mode: 0o700});
      const handle = await open(sourceFile, 'r');
      let bytes;
      try {
        const info = await handle.stat();
        if (!info.isFile() || !info.size || info.size > LIMIT) throw new Error('会话为空或超过 64 MB 导入上限');
        bytes = Buffer.alloc(info.size); let offset = 0;
        while (offset < bytes.length) {const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead;}
        bytes = bytes.subarray(0, offset);
      } finally {await handle.close();}
      // Import a fixed snapshot of complete records even while the source app appends new turns.
      const end = bytes.lastIndexOf(10);
      if (end < 0) throw new Error('来源会话没有完整记录');
      await writeFile(snapshot, bytes.subarray(0, end + 1), {mode: 0o600});
      this.update(job, {stage: 1});
      const from = job.target === 'codex' ? 'claude' : 'codex';
      await this.command(['import', snapshot, irFile, '--from', from]);
      const ir = JSON.parse(await readFile(irFile, 'utf8'));
      if (!ir.events?.some(event => event.kind === 'message' && event.role === 'user')) throw new Error('没有可导入的用户消息');
      // Transfer conversation content, never carry source system instructions, permissions or model settings across harnesses.
      ir.events = ir.events.filter(event => event.kind !== 'reasoning' && (event.kind !== 'message' || ['user', 'assistant'].includes(event.role)));
      ir.metadata = {...ir.metadata, session_id: job.targetId, cwd: job.projectPath, title: job.title, model: undefined, extra: {}};
      await writeFile(irFile, JSON.stringify(ir), {mode: 0o600});
      await this.command(['export', irFile, output, '--to', job.target]);
      this.update(job, {stage: 2});
      targetFile = job.target === 'claude'
        ? join(this.home, '.claude/projects', job.projectPath.replace(/[^a-zA-Z0-9]/g, '-'), `${job.targetId}.jsonl`)
        : join(this.codexHome, 'sessions', ...new Date().toISOString().slice(0, 10).split('-'), `rollout-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}-${job.targetId}.jsonl`);
      await mkdir(dirname(targetFile), {recursive: true});
      const temp = targetFile + '.tmp';
      await writeFile(temp, await readFile(output), {flag: 'wx', mode: 0o600});
      try {await link(temp, targetFile); written = true;} finally {await rm(temp, {force: true});}
      if (job.target === 'codex') this.registerCodex(job, targetFile);
      this.update(job, {stage: 3});
      if (job.target === 'claude') {
        const result = await this.claudeRequest('/api/providers/sessions/import', {sessionId: job.targetId, projectPath: job.projectPath});
        job.targetId = result.sessionId;
        const history = await this.claudeRequest(`/api/providers/sessions/${job.targetId}/messages?limit=1`);
        if (!history.messages?.length) throw new Error('目标端没有读到导入历史');
      } else {
        await this.request('thread/resume', {threadId: job.targetId, excludeTurns: true, cwd: job.projectPath, approvalPolicy: 'on-request', sandbox: 'workspace-write'});
        await this.request('thread/name/set', {threadId: job.targetId, name: job.title});
        const history = await this.request('thread/turns/list', {threadId: job.targetId, limit: 1, sortDirection: 'desc'});
        if (!history.data?.length) throw new Error('目标端没有读到导入历史');
      }
      this.update(job, {status: 'completed', stage: 4});
    } catch (error) {
      if (written) {
        try {
          if (job.target === 'codex') {
            await this.request('thread/archive', {threadId: job.targetId}).catch(() => {});
            const db = new Database(join(this.codexHome, 'state_5.sqlite'), {readwrite: true});
            try {db.query('DELETE FROM threads WHERE id = ? AND rollout_path = ?').run(job.targetId, targetFile);} finally {db.close();}
          } else await this.claudeRequest(`/api/providers/sessions/${job.targetId}`, undefined, 'DELETE').catch(() => {});
          await rm(targetFile, {force: true});
        } catch (cleanupError) {console.error('[import] cleanup failed', job.id, cleanupError.message);}
      }
      this.update(job, {status: 'failed', error: String(error.message || error).slice(0, 500)});
    } finally {await rm(work, {recursive: true, force: true});}
  }
  registerCodex(job, file) {
    const db = new Database(join(this.codexHome, 'state_5.sqlite'), {readwrite: true});
    try {
      const now = Date.now();
      db.query(`INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version, first_user_message, memory_mode, thread_source, preview, history_mode, name, recency_at, recency_at_ms)
        VALUES (?, ?, ?, ?, 'cli', 'openai', ?, ?, ?, 'on-request', 0, 1, 0, '', ?, 'enabled', 'user', ?, 'legacy', ?, ?, ?)`).run(
        job.targetId, file, Math.floor(now / 1000), Math.floor(now / 1000), job.projectPath, job.title,
        JSON.stringify({type: 'workspace-write'}), job.title, job.title, job.title, Math.floor(now / 1000), now);
    } finally {db.close();}
  }
  dismiss(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.status === 'running') throw new Error('导入进行中');
    this.jobs.delete(id); this.save(); this.publish({type: 'session/import', jobs: this.snapshot()});
  }
}
