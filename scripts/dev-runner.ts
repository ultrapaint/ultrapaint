/**
 * `pnpm dev`: the `--dev` mode of the `ultrapaint` command, with what development wants on
 * top. The ports are derived from the checkout path so several worktrees run side by side, and
 * move to the next free pair when those are taken (ADR 0089); a relative `--config` is resolved
 * against the directory `pnpm dev` was typed in, and without `--config` or `--ephemeral` the
 * settings are kept across runs in `~/.ultrapaint`.
 */
import path from "node:path";
import { main } from "./command.ts";
import { canListen, freePair, pathPort } from "./dev-ports.ts";

const root = path.resolve(import.meta.dirname, "..");

const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const args = process.argv
  .slice(2)
  .filter((arg) => arg !== "--")
  .map((arg, index, all) => {
    if (all[index - 1] === "--config") {
      return path.resolve(invokedFrom, arg);
    }
    return arg.startsWith("--config=")
      ? `--config=${path.resolve(invokedFrom, arg.slice("--config=".length))}`
      : arg;
  });
const picksStorage =
  args.some((arg) => arg === "--ephemeral" || arg.startsWith("--config")) ||
  process.env.ULTRAPAINT_CONFIG !== undefined;

// The command reads these, and its children inherit them. Ports given win; otherwise the path's
// pair, or the next one free on the address the server and Vite will listen on.
if (
  process.env.ULTRAPAINT_PORT === undefined &&
  process.env.ULTRAPAINT_WEB_PORT === undefined
) {
  const hostAt = args.indexOf("--host");
  const host =
    (hostAt === -1 ? undefined : args[hostAt + 1]) ??
    args.find((arg) => arg.startsWith("--host="))?.slice("--host=".length) ??
    process.env.ULTRAPAINT_HOST ??
    "127.0.0.1";
  const port = await freePair(pathPort(root), canListen(host));
  process.env.ULTRAPAINT_PORT = String(port);
  process.env.ULTRAPAINT_WEB_PORT = String(port + 1);
} else {
  const port = pathPort(root);
  process.env.ULTRAPAINT_PORT ??= String(port);
  process.env.ULTRAPAINT_WEB_PORT ??= String(port + 1);
}
if (!picksStorage) {
  process.env.ULTRAPAINT_HOME ??= path.join(
    process.env.HOME ?? root,
    ".ultrapaint"
  );
}

main(["--dev", ...args]);
