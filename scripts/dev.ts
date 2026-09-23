import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");

const commands = [
  {
    name: "frontend",
    args: ["bun", "build", "web/codex/app.js", "--target=browser", "--outfile=web/codex/app.bundle.js", "--watch", "--no-clear-screen"],
  },
  {
    name: "server",
    args: ["bun", "--watch", "--no-clear-screen", "server/gateway/index.ts"],
  },
];

const children = commands.map(command => ({
  ...command,
  process: Bun.spawn(command.args, {
    cwd: root,
    env: process.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  }),
}));

let stopping = false;

async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.process.exitCode == null) child.process.kill("SIGTERM");
  }
  await Promise.allSettled(children.map(child => child.process.exited));
  process.exit(code);
}

process.on("SIGINT", () => { void stop(0); });
process.on("SIGTERM", () => { void stop(0); });

const exited = await Promise.race(children.map(async child => ({
  name: child.name,
  code: await child.process.exited,
})));

if (!stopping) {
  console.error(`[codex-webui] ${exited.name} development process exited with code ${exited.code}`);
  await stop(exited.code || 1);
}
