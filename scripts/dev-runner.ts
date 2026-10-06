/**
 * `pnpm dev`: the `--dev` mode of the `ultrapaint` command, with what development wants on
 * top. The ports are derived from the checkout path so several worktrees run side by side, a
 * relative `--config` is resolved against the directory `pnpm dev` was typed in, and without
 * `--config` or `--ephemeral` the settings are kept across runs in `~/.ultrapaint`.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { main } from "./command.ts";

const root = path.resolve(import.meta.dirname, "..");
const hash = createHash("sha1").update(root).digest();
// 4600–4679: below the installed command's 4770 and 4771, so `pnpm dev` and `ultrapaint` run
// side by side.
const base = 4600 + ((hash[0] as number) % 40) * 2;

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

// The command reads these, and its children inherit them.
process.env.ULTRAPAINT_PORT ??= String(base);
process.env.ULTRAPAINT_WEB_PORT ??= String(base + 1);
if (!picksStorage) {
  process.env.ULTRAPAINT_HOME ??= path.join(
    process.env.HOME ?? root,
    ".ultrapaint"
  );
}

main(["--dev", ...args]);
