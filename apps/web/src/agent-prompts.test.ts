import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/**
 * Every file that prompts an agent, and why the prompt is the person's (ADR 0074): an agent is
 * prompted only for what the person sent or pressed, never on opening, on a timer or on a state
 * the editor notices. What the editor would have an agent do it drafts instead (`startTask`).
 */
const PROMPTED_BY_THE_PERSON: Record<string, string> = {
  "lib/first-prompt.ts":
    "the prompt they typed on the start screen, or sent once they chose its look",
  "lib/start-thread.ts": "Make from code, a button they pressed (`runTask`)",
  "panels/thread-composer.tsx": "the composer's Send",
  "panels/thread-review.tsx": "the run card's Go on",
  "state/comments.ts": "a comment's Send to agent",
};

const PROMPTS = /"threads\.prompt"/;
const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });

describe("agent prompts", () => {
  it("are sent only where the person sends them", () => {
    const prompting = sources(SRC)
      .filter((file) => PROMPTS.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file))
      .sort();
    expect(prompting).toEqual(Object.keys(PROMPTED_BY_THE_PERSON).sort());
  });
});
