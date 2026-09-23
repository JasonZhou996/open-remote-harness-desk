import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('native file events synchronize both directions, follow project changes, and never start polling', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-instructions-'));
  const oldDatabase = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(directory, 'test.db');
  await fs.writeFile(process.env.DATABASE_PATH, '');
  const { initializeDatabase, projectsDb, closeConnection } = await import('@/modules/database/index.js');
  const { startProjectInstructionsSync } = await import('../services/project-instructions-sync.service.js');
  let stop = async () => {};
  const agents = path.join(directory, 'AGENTS.md');
  const claude = path.join(directory, 'CLAUDE.md');
  const expectContent = async (file: string, expected: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await fs.readFile(file, 'utf8').catch(() => '') === expected) return;
      await delay(30);
    }
    assert.equal(await fs.readFile(file, 'utf8'), expected);
  };
  try {
    await initializeDatabase();
    t.mock.method(globalThis, 'setInterval', () => { throw new Error('Polling is forbidden'); });
    stop = startProjectInstructionsSync();
    await fs.writeFile(agents, 'initial rules\n');
    projectsDb.createProjectPath(directory);
    await expectContent(claude, 'initial rules\n');
    await delay(20);
    await fs.writeFile(claude, 'Claude edit\n');
    await expectContent(agents, 'Claude edit\n');
    await delay(20);
    await fs.writeFile(agents + '.edit', 'Agents atomic edit\n');
    await fs.rename(agents + '.edit', agents);
    await expectContent(claude, 'Agents atomic edit\n');
    const before = await Promise.all([fs.stat(agents), fs.stat(claude)]);
    await delay(300);
    const after = await Promise.all([fs.stat(agents), fs.stat(claude)]);
    assert.deepEqual(after.map(s => [s.ino, s.mtimeMs]), before.map(s => [s.ino, s.mtimeMs]), 'no rewrite loop');
    projectsDb.updateProjectIsArchived(directory, true);
    await fs.writeFile(agents, 'archived edit\n');
    await delay(300);
    assert.equal(await fs.readFile(claude, 'utf8'), 'Agents atomic edit\n');
    projectsDb.updateProjectIsArchived(directory, false);
    await expectContent(claude, 'archived edit\n');
    const outside = path.join(directory, 'outside.md');
    await fs.writeFile(outside, 'preserve symlink target\n');
    await fs.unlink(claude);
    await fs.symlink(outside, claude);
    await fs.writeFile(agents, 'newer rules\n');
    await delay(300);
    assert.equal(await fs.readFile(outside, 'utf8'), 'preserve symlink target\n');
    assert.ok((await fs.lstat(claude)).isSymbolicLink());
  } finally {
    await stop();
    closeConnection();
    if (oldDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldDatabase;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
