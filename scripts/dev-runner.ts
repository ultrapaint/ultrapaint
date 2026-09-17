/**
 * Starts the server and the web dev server together, on ports derived from the checkout path
 * so several worktrees can run side by side. Children are killed by PID on exit.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = createHash("sha1").update(root).digest();
const base = 4700 + ((hash[0] as number) % 40) * 2;
const serverPort = Number(process.env.ULTRAPAINT_PORT ?? base);
const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? base + 1);

const env = {
  ...process.env,
  ULTRAPAINT_PORT: String(serverPort),
  ULTRAPAINT_WEB_PORT: String(webPort),
};
const children: ChildProcess[] = [];

const run = (name: string, args: string[], cwd: string) => {
  const child = spawn("pnpm", args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout?.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => {
    console.log(`[dev-runner] ${name} exited (${code})`);
  });
};

console.log(
  `[dev-runner] server http://127.0.0.1:${serverPort}  web http://127.0.0.1:${webPort}`
);
run("server", ["dev"], path.join(root, "apps/server"));
run("web", ["dev"], path.join(root, "apps/web"));

const stop = () => {
  for (const c of children) {
    if (c.pid) {
      c.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
