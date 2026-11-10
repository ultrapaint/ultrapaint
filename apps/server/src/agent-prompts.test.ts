import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/**
 * Every place that prompts an agent, by its file, and why each prompt is the person's (ADR
 * 0074): a turn of a chat sends what they sent or queued, or the review's findings in the run
 * their prompt started; a review model looks at that run's pages. Nothing prompts an agent on
 * its own. A file has a reason for each `agent.prompt(` in it: one more call needs its own.
 */
const PROMPTED_BY_THE_PERSON: Record<string, readonly string[]> = {
  "services/review/reviewer.ts": [
    "a review model of the run the person's prompt started (ADR 0063)",
  ],
  "services/threads/thread-session.ts": [
    "a chat's turn: the person's prompt, one they queued, or their run's review findings",
  ],
};

const PROMPTS = /\bagent\s*\.prompt\(/g;
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
    const sites = Object.fromEntries(
      sources(SRC)
        .map((file) => relative(SRC, file))
        .filter((file) => !SKIPPED.some((skip) => file.startsWith(skip)))
        .map(
          (file) =>
            [
              file,
              readFileSync(join(SRC, file), "utf8").match(PROMPTS)?.length ?? 0,
            ] as const
        )
        .filter(([, count]) => count > 0)
    );
    expect(sites).toEqual(
      Object.fromEntries(
        Object.entries(PROMPTED_BY_THE_PERSON).map(([file, why]) => [
          file,
          why.length,
        ])
      )
    );
  });
});
