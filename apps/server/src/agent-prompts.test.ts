import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/**
 * Every file that prompts an agent, and why the prompt is the person's (ADR 0074): a turn of a
 * chat sends what they sent or queued, or the review's findings in the run their prompt started;
 * a review model looks at that run's pages. Nothing prompts an agent on its own.
 */
const PROMPTED_BY_THE_PERSON: Record<string, string> = {
  "services/review/reviewer.ts":
    "a review model of the run the person's prompt started (ADR 0063)",
  "services/threads/thread-session.ts":
    "a chat's turn: the person's prompt, one they queued, or their run's review findings",
};

const PROMPTS = /\bagent\.prompt\(/;
const SKIPPED = ["testing/"];
const SOURCE = /\.ts$/;
const TEST = /\.test\.ts$/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });

describe("agent prompts", () => {
  it("are sent only for what the person sent", () => {
    const prompting = sources(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !SKIPPED.some((skip) => file.startsWith(skip)))
      .filter((file) => PROMPTS.test(readFileSync(join(SRC, file), "utf8")))
      .sort();
    expect(prompting).toEqual(Object.keys(PROMPTED_BY_THE_PERSON).sort());
  });
});
