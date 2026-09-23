import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('unified launcher targets the existing services and rejects unknown actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webui-start-'));
  const output = join(directory, 'args');
  try {
    for (const name of ['systemctl', 'journalctl']) {
      await writeFile(join(directory, name), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n', {mode: 0o755});
    }
    const env = {...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE: output};
    for (const action of ['', 'start', 'stop', 'restart']) {
      const result = spawnSync('./start.sh', action ? [action] : [], {env});
      assert.equal(result.status, 0, result.stderr.toString());
      assert.equal(await readFile(output, 'utf8'), `--user\n${action || 'start'}\nai-webui.target\n`);
    }
    for (const action of ['status', 'logs']) {
      assert.equal(spawnSync('./start.sh', [action], {env}).status, 0);
      const args = await readFile(output, 'utf8');
      for (const unit of ['codex-webui.service', 'claude-bridge.service', 'zcode-local.service']) assert.ok(args.includes(unit));
    }
    assert.equal(spawnSync('./start.sh', ['unknown'], {env}).status, 2);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
