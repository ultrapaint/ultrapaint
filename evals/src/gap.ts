/**
 * A design gap: a place where a design made with the design skill went wrong, as a person found
 * it, and what the lab tries for it. One file each in `evals/gaps/` (in git: the backlog, and the
 * ground truth `recall` matches reviews against), its front matter then its text; its pictures in
 * the data directory's `gaps/<id>/`. See `evals/gaps/README.md`.
 */
import path from "node:path";
import { Console, Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import { listDir } from "./layout.ts";

export const GAP_KINDS = ["missing", "missed", "process"] as const;
export const GAP_STATUSES = ["open", "testing", "done", "wontfix"] as const;

export const Gap = Schema.Struct({
  /** The day a person found it. */
  found: Schema.String,
  id: Schema.String,
  /** missing: no rule says it; missed: a rule says it and was not applied; process: how the skill is run. */
  kind: Schema.Literals(GAP_KINDS),
  /** The sections of the data directory's `gaps/sections/` that `recall` reviews for it. */
  sections: Schema.Array(Schema.String),
  /** The skill's files it concerns, from `skills/ultrapaint/`. */
  skill: Schema.Array(Schema.String),
  /** The work it was found in. */
  source: Schema.String,
  status: Schema.Literals(GAP_STATUSES),
  title: Schema.String,
});
export type Gap = typeof Gap.Type;

export interface LoadedGap extends Gap {
  /** Its text after the front matter. */
  readonly body: string;
  readonly file: string;
}

/**
 * Whether a gap is something a person saw in a design (`g01`), which a reviewer can be judged to
 * find, rather than how the skill is run (`p01`), which is measured through what is found.
 */
export const isFinding = (gap: Pick<Gap, "id">) => gap.id.startsWith("g");

const FENCE = "---\n";
const NEXT_PART_RE = /\n\*\*[A-Z][^*\n]*\.\*\*/;
const OPEN_RE = /^status: open$/m;
const LIST_RE = /^\[.*\]$/;

/**
 * The front matter's fields, a line each: `key: value`, or `key: [a, b]` for a list. The fields
 * are decoded with `Gap`; this only splits them.
 */
export const splitFrontMatter = (text: string) => {
  const end = text.indexOf(`\n${FENCE}`, FENCE.length);
  if (!text.startsWith(FENCE) || end < 0) {
    return;
  }
  const fields: Record<string, string | readonly string[]> = {};
  for (const line of text.slice(FENCE.length, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const value = line.slice(colon + 1).trim();
      fields[line.slice(0, colon).trim()] = LIST_RE.test(value)
        ? value
            .slice(1, -1)
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "")
        : value;
    }
  }
  return { body: text.slice(end + 1 + FENCE.length), fields };
};

/** A paragraph of a gap's text by its bold heading (`**What happened.**`), up to the next one. */
export const partOf = (body: string, heading: string) => {
  const start = body.indexOf(`**${heading}.**`);
  if (start < 0) {
    return "";
  }
  const from = start + heading.length + 5;
  const next = body.slice(from).search(NEXT_PART_RE);
  return body.slice(from, next < 0 ? undefined : from + next).trim();
};

const RESULT = "**Result.**";

/**
 * A gap's file with a run's line under **Result.** (the line it had from that run replaced) and an
 * open gap's status `testing`.
 */
export const withResult = (text: string, run: string, line: string) => {
  const opened = text.replace(OPEN_RE, "status: testing");
  const entry = `- \`${run}\`: ${line}`;
  const at = opened.indexOf(RESULT);
  if (at < 0) {
    return `${opened.trimEnd()}\n\n${RESULT}\n\n${entry}\n`;
  }
  const head = opened.slice(0, at + RESULT.length);
  // What is under it stays as written, a list item's indented lines and the paragraphs too.
  const kept = opened
    .slice(at + RESULT.length)
    .split("\n")
    .filter((l) => !l.startsWith(`- \`${run}\`:`));
  while (kept.length > 0 && kept.at(-1)?.trim() === "") {
    kept.pop();
  }
  return kept.some((l) => l.trim() !== "")
    ? `${head}${kept.join("\n")}\n${entry}\n`
    : `${head}\n\n${entry}\n`;
};

const decodeGap = Schema.decodeUnknownEffect(Gap);

/** Every gap, by its id. */
export const loadGaps = Effect.fn("loadGaps")(function* () {
  const { gaps } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* listDir(gaps)).filter(
    (f) => f.endsWith(".md") && f !== "README.md"
  );
  return yield* Effect.forEach(files, (name) =>
    Effect.gen(function* () {
      const file = path.join(gaps, name);
      const split = splitFrontMatter(yield* fs.readFileString(file));
      if (!split) {
        return yield* new EvalsError({
          message: `${name} has no front matter between --- lines`,
        });
      }
      const gap = yield* decodeGap(split.fields).pipe(
        Effect.mapError(
          (issue) => new EvalsError({ message: `${name}: ${issue}` })
        )
      );
      return { ...gap, body: split.body, file } satisfies LoadedGap;
    })
  );
});

/** Writes a run's line into a gap's file, under **Result.**, and opens it to `testing`. */
export const recordResult = Effect.fn("recordResult")(function* (
  gap: LoadedGap,
  run: string,
  line: string
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(gap.file);
  yield* fs.writeFileString(gap.file, withResult(text, run, line));
});

/** `pnpm evals gaps`: every gap, its kind and status, and the sections recall reviews for it. */
export const listGaps = Effect.fn("listGaps")(function* () {
  const gaps = yield* loadGaps();
  const width = Math.max(...gaps.map((g) => g.title.length));
  for (const gap of gaps) {
    const sections = gap.sections.length > 0 ? gap.sections.join(", ") : "-";
    yield* Console.log(
      `${gap.id}  ${gap.kind.padEnd(7)}  ${gap.status.padEnd(7)}  ${gap.title.padEnd(width)}  ${sections}`
    );
  }
});
