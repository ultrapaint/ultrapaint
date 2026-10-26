#!/usr/bin/env node
/**
 * Stands in for `ultrapaint new` in the app's tests: the server's flags come first, then `new`,
 * the folder and the new design's own. What it does depends on the folder's name:
 *
 *   unfinished  the install fails, said on its line, and it exits 1
 *   crash       says why on stderr and exits 2, before any step
 *   other       every step done, the git step when `--git` is given
 *
 * It writes the arguments after `new` to `FAKE_NEW_RECORD`, when set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(process.argv.indexOf("new") + 1);
const folder = args[0] ?? "";
if (process.env.FAKE_NEW_RECORD) {
  writeFileSync(process.env.FAKE_NEW_RECORD, JSON.stringify(args));
}
const name = path.basename(folder);
if (name === "crash") {
  console.error("Error: something the command could not get past");
  process.exit(2);
}
const say = (step, state, detail) =>
  console.log(JSON.stringify({ ...(detail ? { detail } : {}), state, step }));
say("folder", "active");
mkdirSync(folder, { recursive: true });
say("folder", "done", folder);
say("write", "active");
say("write", "done", "11 files");
say("install", "active");
if (name === "unfinished") {
  say("install", "failed", "pnpm install failed:\nERR_FAKE no registry");
  process.exit(1);
}
say("install", "done", "With pnpm.");
if (args.includes("--git")) {
  say("git", "active");
  say("git", "done", "Committed: Start it");
}
