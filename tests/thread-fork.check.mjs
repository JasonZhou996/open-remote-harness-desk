import assert from 'node:assert/strict';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {finalizeFork} from '../server/codex/thread-fork.js';

const home = mkdtempSync(join(tmpdir(), 'webui-fork-'));
try {
  const db = new Database(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, preview TEXT, archived INTEGER)');
  const source = {id: 'source', name: '对话%_[x]', preview: 'First user message'};
  const insert = db.query('INSERT INTO threads VALUES (?, ?, ?, 0)');
  insert.run(source.id, source.name, source.preview);
  for (const id of ['fork2', 'fork3', 'fork4']) insert.run(id, source.name, '');
  const fork = id => ({id, forkedFromId: source.id, preview: ''});
  assert.deepEqual(finalizeFork(home, fork('fork2'), source), {name: '对话%_[x](2)', preview: source.preview});
  assert.equal(finalizeFork(home, fork('fork3'), source).name, '对话%_[x](3)');
  assert.equal(finalizeFork(home, {id: 'fork4', forkedFromId: 'fork2'}, {id: 'fork2', forkedFromId: source.id, name: '对话%_[x](2)', preview: source.preview}).name, '对话%_[x](4)');
  insert.run('fork5', source.name, 'A newer message');
  assert.deepEqual(finalizeFork(home, fork('fork5'), source), {name: '对话%_[x](5)', preview: 'A newer message'});
  assert.deepEqual(db.query('SELECT name, preview FROM threads WHERE id = ?').get(source.id), {name: source.name, preview: source.preview});
  assert.equal(db.query("SELECT count(*) count FROM threads WHERE preview = ''").get().count, 0);
  assert.throws(() => finalizeFork(home, {id: source.id}, source), /Invalid fork source/);
  db.close();
  console.log('PASS: fork names (2), (3), nested (4), (5); shared previews present; parent and newer previews unchanged');
} finally {rmSync(home, {recursive: true});}
