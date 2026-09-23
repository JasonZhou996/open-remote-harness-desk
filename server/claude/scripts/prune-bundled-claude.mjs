// The Agent SDK ships a full Claude Code binary per platform as an optional
// dependency — ~460MB on this machine for linux-x64 plus its musl twin. This
// install already has a Claude Code on PATH, and `CLAUDE_CLI_PATH` points the
// runtime at it (see server/shared/claude-cli-path.ts), so the bundled copies
// are never executed. npm re-fetches optional deps on every install, which is
// why this runs from `postinstall` rather than being a one-off delete.
//
// Never fails the install: a missing or unreadable node_modules just means
// there is nothing to prune.
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const scopeDir = path.join(process.cwd(), 'node_modules', '@anthropic-ai');
const PLATFORM_PACKAGE = /^claude-agent-sdk-(darwin|linux|win32)-/;

let freedBytes = 0;

function directorySize(target) {
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(child);
    } else if (entry.isFile()) {
      total += statSync(child).size;
    }
  }
  return total;
}

try {
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PLATFORM_PACKAGE.test(entry.name)) {
      continue;
    }

    const target = path.join(scopeDir, entry.name);
    try {
      freedBytes += directorySize(target);
    } catch {
      // Size is only for the log line; a failure here must not skip the delete.
    }
    rmSync(target, { recursive: true, force: true });
    console.log(`[prune] removed bundled ${entry.name}`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn(`[prune] skipped: ${error?.message ?? error}`);
  }
}

if (freedBytes > 0) {
  console.log(`[prune] freed ${(freedBytes / 1024 / 1024).toFixed(0)}MB — runtime uses CLAUDE_CLI_PATH instead`);
}
