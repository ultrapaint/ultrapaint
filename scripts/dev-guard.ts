/**
 * Runs one of `pnpm dev`'s processes (the server under `tsx watch`, the editor under Vite) and
 * takes it down with what it started when the runner that started this guard goes away without
 * stopping it: killed, crashed. The process runs in a process group of its own, which the guard
 * signals, the handle that spawned it; a signal the guard is given is passed on the same way.
 *
 * Usage: node dev-guard.ts <command> [args…]
 */
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  process.exit(2);
}

const runner = process.ppid;
const child = spawn(command, args, { detached: true, stdio: "inherit" });

/** Signals the process's group: it, and whatever it started. */
const stop = (signal: NodeJS.Signals) => {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is gone already: nothing is left to stop.
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => stop(signal));
}

// Orphaned, the guard is given another parent: the runner is gone.
const watch = setInterval(() => {
  if (process.ppid !== runner) {
    clearInterval(watch);
    stop("SIGTERM");
    setTimeout(() => stop("SIGKILL"), 3000).unref();
  }
}, 1000);

child.on("exit", (code, signal) => {
  clearInterval(watch);
  process.exitCode = code ?? (signal === null ? 1 : 128);
});
