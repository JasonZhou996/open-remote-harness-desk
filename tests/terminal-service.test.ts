import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createTerminalSession, normalizeTerminalResize, resolveTerminalCwd } from '../server/gateway/terminal-service.js';

describe('terminal service', () => {
  test('accepts bounded PTY sizes and rejects malformed resize messages', () => {
    expect(normalizeTerminalResize({ type: 'resize', cols: 120, rows: 32 })).toEqual({ cols: 120, rows: 32 });
    expect(normalizeTerminalResize({ type: 'resize', cols: 0, rows: 32 })).toBeNull();
    expect(normalizeTerminalResize({ type: 'resize', cols: 120, rows: 5000 })).toBeNull();
    expect(normalizeTerminalResize({ type: 'data', cols: 120, rows: 32 })).toBeNull();
  });

  test('keeps terminal cwd inside the same allowed browse roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'webui-terminal-'));
    try {
      const project = join(root, 'project');mkdirSync(project);
      expect(resolveTerminalCwd(project, [root], root)).toBe(realpathSync(project));
      expect(resolveTerminalCwd(tmpdir(), [root], root)).toBe(realpathSync(root));
      expect(resolveTerminalCwd(null, [root], root)).toBe(realpathSync(root));
    } finally { rmSync(root, { recursive: true }); }
  });

  test('reports a missing PTY worker runtime without crashing the server', async () => {
    const previous = process.env.CODEX_WEBUI_NODE;
    process.env.CODEX_WEBUI_NODE = '/definitely/missing/codex-webui-node';
    try {
      const result = await new Promise(resolve => {
        const session = createTerminalSession({
          cwd: realpathSync(tmpdir()),
          onData: () => {},
          onExit: event => { session.kill(); resolve(event); },
        });
      });
      expect(result.exitCode).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.CODEX_WEBUI_NODE;
      else process.env.CODEX_WEBUI_NODE = previous;
    }
  });

  test('the installed native PTY runs commands and accepts resize through the Node worker', async () => {
    const previous = process.env.SHELL;process.env.SHELL = '/bin/sh';
    let session;
    let timer;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        let text = '', resized = false;
        session = createTerminalSession({cwd:tmpdir(),cols:80,rows:24,onData:data=>{
          text += data;
          if (!resized && text.includes('24 80')) {
            resized = true;session.resize(100,30);
            session.write("stty size; printf 'PTY_%s\\n' OK; exit\r");
          }
        },onExit:event=>event.exitCode===0?resolve(text):reject(new Error(text))});
        session.write('stty size\r');
        timer = setTimeout(()=>reject(new Error(`PTY worker timed out: ${text}`)),4000);
      });
      expect(output).toContain('30 100');expect(output).toContain('PTY_OK');
    } finally {
      clearTimeout(timer);session?.kill();
      if(previous===undefined)delete process.env.SHELL;else process.env.SHELL=previous;
    }
  });
});
