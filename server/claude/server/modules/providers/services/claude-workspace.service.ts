import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { projectsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { AppError } from '@/shared/utils.js';

const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** Providers' workspace routes resolve only registered projects, never arbitrary client paths. */
export function claudeWorkspacePath(projectId?: string): string {
  if (!projectId) return os.homedir();
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw new AppError('项目不存在', { statusCode: 404, code: 'PROJECT_NOT_FOUND' });
  return project.project_path;
}

/** Obtain native control data without submitting a prompt or persisting a dummy conversation. */
export async function withClaudeControl<T>(cwd: string, operation: (instance: Query) => Promise<T>): Promise<T> {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  async function* input(): AsyncGenerator<SDKUserMessage> { await held; yield* []; }
  const instance = query({ prompt: input(), options: {
    cwd, persistSession: false, settingSources: ['user', 'project', 'local'],
    pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(),
    permissionMode: 'default',
  } });
  const drain = (async () => { try { for await (const _ of instance) { /* control-only */ } } catch { /* closed below */ } })();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation(instance), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new AppError('Claude Code 控制接口超时，请重试', { statusCode: 504, code: 'CLI_CONTROL_TIMEOUT' })), 25000);
    })]);
  } finally {
    clearTimeout(timeout); release(); instance.close(); await drain;
  }
}

type NativeCatalogModel = Awaited<ReturnType<Query['supportedModels']>>[number];
type CatalogModel = Omit<NativeCatalogModel, 'supportedEffortLevels'> & { supportedEffortLevels?: string[]; menuGroup?: 'more' };
type Catalog = { models: CatalogModel[]; commands: Awaited<ReturnType<Query['supportedCommands']>>; outputStyles: string[] };

// The CLI control menu omits legacy models accepted by --model. These exact IDs
// exist in Claude Code 2.1.278 and match the user's desktop "More models" menu.
export function completeClaudeModels(models: CatalogModel[]): CatalogModel[] {
  const more = [
    ['claude-fable-5', 'Fable 5 · Requires usage credits'],
    ['claude-opus-4-8', 'Opus 4.8'],
    ['claude-opus-4-7', 'Opus 4.7'],
    ['claude-opus-4-6', 'Opus 4.6'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
  ];
  const result = models.map(model => ({ ...model,
    ...(model.supportsEffort && model.supportedEffortLevels?.includes('xhigh') && !model.supportedEffortLevels.includes('ultracode')
      ? {supportedEffortLevels:[...model.supportedEffortLevels, 'ultracode']} : {}),
  }));
  for (const [value, description] of more) {
    const existing = result.find(model => model.value !== 'default' && (model.value === value || model.resolvedModel?.replace(/\[1m\]$/, '') === value));
    if (existing) existing.menuGroup = 'more';
    else result.push({ value, resolvedModel: value, displayName: description.split(' · ')[0], description, menuGroup: 'more' });
  }
  return result;
}
const catalogs = new Map<string, { at: number; promise: Promise<Catalog> }>();
const contextWindows = new Map<string, Promise<number>>();
/** Token-usage REST reads the CLI's real model limit; no prompt, resume, or quota request. */
export function getClaudeContextWindow(cwd: string, model: string): Promise<number> {
  const key = JSON.stringify([cwd, model]);
  const cached = contextWindows.get(key);
  if (cached) return cached;
  const pending = withClaudeControl(cwd, async instance => {
    await instance.initializationResult();
    await instance.setModel(model);
    const context = await instance.getContextUsage({ detail: 'summary' });
    if (!Number.isFinite(context.rawMaxTokens) || context.rawMaxTokens <= 0) throw new Error('Claude Code 未返回上下文窗口上限');
    return context.rawMaxTokens;
  }).catch(error => { contextWindows.delete(key); throw error; });
  contextWindows.set(key, pending);
  return pending;
}
/** Native directory consumed by model selection and the web slash-command menu. */
export function getClaudeCatalog(cwd = os.homedir(), refresh = false): Promise<Catalog> {
  const cached = catalogs.get(cwd);
  if (!refresh && cached && Date.now() - cached.at < 60000) return cached.promise;
  const promise = withClaudeControl(cwd, async instance => {
    const init = await instance.initializationResult();
    return { models: completeClaudeModels(init.models), commands: init.commands, outputStyles: init.available_output_styles };
  }).catch(error => { catalogs.delete(cwd); throw error; });
  catalogs.set(cwd, { at: Date.now(), promise });
  return promise;
}

function hash(content: string) { return createHash('sha256').update(content).digest('hex'); }
async function textOrEmpty(file: string) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}

async function instructionPath(scope: string, projectId?: string) {
  if (scope === 'user') return path.join(home, 'CLAUDE.md');
  if (scope !== 'project' || !projectId) throw new AppError('请选择项目', { statusCode: 400, code: 'PROJECT_REQUIRED' });
  const cwd = claudeWorkspacePath(projectId);
  const root = path.join(cwd, 'CLAUDE.md');
  const nested = path.join(cwd, '.claude', 'CLAUDE.md');
  try { await fs.access(root); return root; } catch { /* try native alternative */ }
  try { await fs.access(nested); return nested; } catch { return root; }
}

/** Read actual user/project instructions and return a revision for safe editing. */
export async function readClaudeInstructions(scope: string, projectId?: string) {
  const file = await instructionPath(scope, projectId);
  const content = await textOrEmpty(file);
  return { path: file, content, revision: hash(content) };
}

let instructionWrites = Promise.resolve();
/** Serialize editors and refuse stale or symlink writes instead of overwriting unknown content. */
export async function writeClaudeInstructions(scope: string, projectId: string | undefined, content: unknown, revision: unknown) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 256 * 1024 || typeof revision !== 'string') {
    throw new AppError('指令内容或版本无效（最大 256 KB）', { statusCode: 400, code: 'INVALID_INSTRUCTIONS' });
  }
  const job = instructionWrites.then(async () => {
    const current = await readClaudeInstructions(scope, projectId);
    if (current.revision !== revision) throw new AppError('文件已被其他程序修改，请重新载入后再保存', { statusCode: 409, code: 'INSTRUCTIONS_CHANGED' });
    const parent = path.dirname(current.path);
    await fs.mkdir(parent, { recursive: true });
    if (await fs.realpath(parent) !== parent) throw new AppError('此目录是符号链接，请在 CLI 编辑', { statusCode: 409, code: 'SYMLINK_DIRECTORY' });
    const stat = await fs.lstat(current.path).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (stat?.isSymbolicLink()) throw new AppError('此指令文件是符号链接，请在 CLI 编辑', { statusCode: 409, code: 'SYMLINK_FILE' });
    const temp = `${current.path}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { mode: stat ? stat.mode & 0o777 : 0o600, flag: 'wx' }); await fs.rename(temp, current.path); }
    finally { await fs.unlink(temp).catch(() => {}); }
    return { path: current.path, content, revision: hash(content) };
  });
  instructionWrites = job.then(() => {}, () => {});
  return job;
}

/** List the native project's memory files; no synthetic memories or prompt injection. */
export async function readClaudeMemory(projectId?: string) {
  const cwd = await fs.realpath(claudeWorkspacePath(projectId));
  // Native Claude project storage uses its encoded absolute working directory.
  const directory = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), 'memory');
  const names = await fs.readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const files = [];
  for (const name of names.filter(n => n.endsWith('.md'))) {
    const file = path.join(directory, name);
    const info = await fs.lstat(file);
    if (info.isFile() && info.size <= 256 * 1024) files.push({ name, content: await fs.readFile(file, 'utf8') });
  }
  return { directory, files };
}
