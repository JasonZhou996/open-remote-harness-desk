import { randomUUID } from 'node:crypto';
import { constants, watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, projectChanges } from '@/modules/database/index.js';

async function stat(file: string) {
  return fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function syncInstructions(directory: string) {
  const agents = path.join(directory, 'AGENTS.md');
  const claude = path.join(directory, 'CLAUDE.md');
  const [a, c] = await Promise.all([stat(agents), stat(claude)]);
  if ((!a && !c) || (a && !a.isFile()) || (c && !c.isFile())) return;
  // ponytail: timestamp-only sync; equal millisecond timestamps are treated as unchanged.
  if (a && c && Math.round(a.mtimeMs) === Math.round(c.mtimeMs)) return;
  const fromAgents = a && (!c || a.mtimeMs > c.mtimeMs);
  const [source, target, newer, older] = fromAgents ? [agents, claude, a!, c] : [claude, agents, c!, a];
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, temp, constants.COPYFILE_EXCL);
    if (older) await fs.chmod(temp, older.mode & 0o777);
    await fs.utimes(temp, newer.atimeMs / 1000, Math.round(newer.mtimeMs) / 1000);
    // An edit during the copy emits another event; let that event handle the newer version.
    if ((await stat(source))?.mtimeMs !== newer.mtimeMs || (await stat(target))?.mtimeMs !== older?.mtimeMs) return;
    await fs.rename(temp, target);
  } finally {
    await fs.unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Server startup watches registered project roots through native filesystem events. */
export function startProjectInstructionsSync() {
  const watchers = new Map<string, FSWatcher>();
  // ponytail: one write queue for these small files; split by project only if writes become slow.
  let pending = Promise.resolve();
  const sync = (directory: string) => {
    pending = pending.then(async () => {
      if (watchers.has(directory)) await syncInstructions(directory);
    }).catch(error => console.error('[Project instructions sync]', directory, error));
  };
  const refresh = () => {
    const roots = new Set(projectsDb.getProjectPaths().map(project => project.project_path));
    for (const [root, watcher] of watchers) {
      if (!roots.has(root)) { watcher.close(); watchers.delete(root); }
    }
    for (const root of roots) {
      if (watchers.has(root)) continue;
      try {
        const watcher = watch(root, (_event, file) => {
          if (file === null || file === 'AGENTS.md' || file === 'CLAUDE.md') sync(root);
        });
        watcher.on('error', error => console.error('[Project instructions watch]', root, error));
        watchers.set(root, watcher);
        sync(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[Project instructions watch]', root, error);
      }
    }
  };
  projectChanges.on('change', refresh);
  refresh();
  return async () => {
    projectChanges.off('change', refresh);
    for (const watcher of watchers.values()) watcher.close();
    await pending;
    watchers.clear();
  };
}
