import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReviewPatch } from "../server/codex/review-service.js";
import { createTerminalSession } from "../server/gateway/terminal-service.js";
import { readWorkspaceContext } from "../server/codex/workspace-context.js";

const ROOT = new URL("..", import.meta.url).pathname;
const XARNESS_SECRET_KEY = /^(?:xarness_codex_control_token|xarness_codex_provider_)/i;
const temporaryRoots: string[] = [];

function assertNoXarnessSecrets(environment: Record<string, unknown>) {
  expect(Object.keys(environment).filter((key) => XARNESS_SECRET_KEY.test(key))).toEqual([]);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("non-Codex process environments", () => {
  test("does not pass Xarness control or provider variables to the terminal worker", async () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "codex-webui-process-env-"));
    temporaryRoots.push(root);
    const probePath = join(root, "node-probe");
    const environmentPath = join(root, "environment.json");
    writeFileSync(
      probePath,
      "#!/usr/bin/env node\nconst fs = require('node:fs'); fs.writeFileSync(process.env.XARNESS_PROBE_ENV_PATH, JSON.stringify(process.env));\n",
      "utf8",
    );
    chmodSync(probePath, 0o755);

    const previous = {
      node: process.env.CODEX_WEBUI_NODE,
      probe: process.env.XARNESS_PROBE_ENV_PATH,
      control: process.env.XARNESS_CODEX_CONTROL_TOKEN,
      provider: process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key,
    };
    process.env.CODEX_WEBUI_NODE = probePath;
    process.env.XARNESS_PROBE_ENV_PATH = environmentPath;
    process.env.XARNESS_CODEX_CONTROL_TOKEN = "control-secret";
    process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key = "provider-secret";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("terminal worker probe timed out")), 5_000);
        createTerminalSession({
          cwd: root,
          onData: () => {},
          onExit: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
      assertNoXarnessSecrets(JSON.parse(readFileSync(environmentPath, "utf8")) as Record<string, unknown>);
    } finally {
      if (previous.node === undefined) delete process.env.CODEX_WEBUI_NODE;
      else process.env.CODEX_WEBUI_NODE = previous.node;
      if (previous.probe === undefined) delete process.env.XARNESS_PROBE_ENV_PATH;
      else process.env.XARNESS_PROBE_ENV_PATH = previous.probe;
      if (previous.control === undefined) delete process.env.XARNESS_CODEX_CONTROL_TOKEN;
      else process.env.XARNESS_CODEX_CONTROL_TOKEN = previous.control;
      if (previous.provider === undefined) delete process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key;
      else process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key = previous.provider;
    }
  });

  test("does not pass Xarness variables to workspace-context git or review git", async () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "codex-webui-git-env-"));
    temporaryRoots.push(root);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const environmentPath = join(root, "git-environments.jsonl");
    const fakeGit = join(bin, "git");
    writeFileSync(
      fakeGit,
      [
        "#!/usr/bin/env node",
        `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(environmentPath)}, JSON.stringify(process.env) + '\\n');`,
        "const args = process.argv.slice(2);",
        "if (args[0] === 'branch') process.stdout.write('feature/env\\n');",
        "else if (args[0] === 'rev-parse') process.stdout.write(process.cwd() + '\\n');",
        "else if (args.includes('--numstat')) process.stdout.write('1\\t0\\tsample.txt\\0');",
      ].join("\n"),
      "utf8",
    );
    chmodSync(fakeGit, 0o755);
    const previous = {
      path: process.env.PATH,
      control: process.env.XARNESS_CODEX_CONTROL_TOKEN,
      provider: process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key,
    };
    process.env.PATH = `${bin}:${previous.path ?? ""}`;
    process.env.XARNESS_CODEX_CONTROL_TOKEN = "control-secret";
    process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key = "provider-secret";
    try {
      expect(readWorkspaceContext(root, [root]).branch).toBe("feature/env");
      await expect(
        applyReviewPatch(
          {
            cwd: root,
            action: "reapply",
            diff: "diff --git a/sample.txt b/sample.txt\nindex 1111111..2222222 100644\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-old\n+new\n",
          },
          [root],
        ),
      ).resolves.toMatchObject({ ok: true, action: "reapply" });
      const environments = readFileSync(environmentPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(environments.length).toBeGreaterThanOrEqual(2);
      for (const environment of environments) assertNoXarnessSecrets(environment);
    } finally {
      if (previous.path === undefined) delete process.env.PATH;
      else process.env.PATH = previous.path;
      if (previous.control === undefined) delete process.env.XARNESS_CODEX_CONTROL_TOKEN;
      else process.env.XARNESS_CODEX_CONTROL_TOKEN = previous.control;
      if (previous.provider === undefined) delete process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key;
      else process.env.xArNeSs_CoDeX_PrOvIdEr_Api_Key = previous.provider;
    }
  });
});

describe("Codex app-server process environment", () => {
  test("preserves Xarness control and provider variables for the Codex app-server", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-app-server-env-"));
    temporaryRoots.push(root);
    const probePath = join(root, "codex-probe");
    const environmentPath = join(root, "environment.json");
    const port = 39_000 + Math.floor(Math.random() * 1_000);
    writeFileSync(
      probePath,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.XARNESS_PROBE_ENV_PATH, JSON.stringify(process.env));",
        "process.stdout.write(JSON.stringify({id: 1, result: {codexHome: process.cwd()}}) + '\\n');",
        "process.stdin.resume();",
      ].join("\n"),
      "utf8",
    );
    chmodSync(probePath, 0o755);

    const server = Bun.spawn(["bun", "run", "server/gateway/index.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        XARNESS_BUNDLED_CODEX_BIN: probePath,
        XARNESS_PROBE_ENV_PATH: environmentPath,
        XARNESS_CODEX_CONTROL_TOKEN: "control-secret",
        XARNESS_CODEX_PROVIDER_API_KEY: "provider-secret",
        CODEX_WEBUI_PASSWORD: "",
        CODEX_WEBUI_ACCESS_TOKEN: "integration-access-token",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (response.ok && (await response.json()).codex === true) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const environment = JSON.parse(readFileSync(environmentPath, "utf8")) as Record<string, unknown>;
      expect(environment.XARNESS_CODEX_CONTROL_TOKEN).toBe("control-secret");
      expect(environment.XARNESS_CODEX_PROVIDER_API_KEY).toBe("provider-secret");
    } finally {
      server.kill("SIGTERM");
      await server.exited;
    }
  }, 20_000);
});
