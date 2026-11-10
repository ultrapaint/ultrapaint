/**
 * `pairwise`: two rounds judged blind, run by run. For each reference and run both rounds have,
 * the judge sees the reference and the two designs under letters the run's name shuffles, and
 * says which is better, level by level. The verdicts are kept under the rounds' names in
 * `runs/<a>-vs-<b>/pairwise.json`, so a run judged once is not asked again; `reads.json` beside
 * it lists the skill's files each run opened.
 *
 * A judge leans to one letter, so each run is judged twice, the designs shown the other way
 * round the second time (`swapped`): a side that changes with the order is a tie, and how many
 * winners changed is the judge's flip rate. `oneOrder` asks once, as rounds were judged before.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";

import { EvalsConfig } from "./config.ts";
import { listDir, PROMPTS, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";

/**
 * The levels a side is given at: the judge's eight (`judge.ts`), in the prompt's order, colour
 * spelt as the prompt and the verdicts kept so far spell it.
 */
export const PAIR_LEVELS = [
  "layout",
  "hierarchy",
  "restraint",
  "typography",
  "colour",
  "spacing",
  "components",
  "craft",
] as const;
const SIDES = ["A", "B", "tie"] as const;
const MARGINS = ["clear", "slight", "none"] as const;

/** The judge's answer: the designs under the letters they were shown as. */
export const Verdict = Schema.Struct({
  levels: Schema.Record(Schema.String, Schema.Literals(SIDES)),
  margin: Schema.Literals(MARGINS),
  reasons: Schema.Array(Schema.String),
  winner: Schema.Literals(SIDES),
});

const verdictSchema = {
  additionalProperties: false,
  properties: {
    levels: {
      additionalProperties: false,
      properties: Object.fromEntries(
        PAIR_LEVELS.map((l) => [l, { enum: SIDES, type: "string" }])
      ),
      required: PAIR_LEVELS,
      type: "object",
    },
    margin: { enum: MARGINS, type: "string" },
    reasons: { items: { type: "string" }, type: "array" },
    winner: { enum: SIDES, type: "string" },
  },
  required: ["winner", "margin", "levels", "reasons"],
  type: "object",
};

/** A verdict, as the judge answers it. */
export const verdictAnswer = { decode: Verdict, schema: verdictSchema };

const judged = {
  levels: Schema.Record(Schema.String, Schema.String),
  margin: Schema.String,
  reasons: Schema.Array(Schema.String),
  shownFirst: Schema.String,
  winner: Schema.String,
};

/** A verdict with its letters turned into the rounds' names. */
export const Judged = Schema.Struct({
  ...judged,
  /** The same run judged with the designs shown the other way round. */
  swapped: Schema.optional(Schema.Struct(judged)),
});
const Results = Schema.Record(Schema.String, Judged);

/**
 * What a run's two verdicts settle: a side both orders gave stands, one that changed with the
 * order is a tie. A run judged in one order is as that order said.
 */
export const settled = (run: typeof Judged.Type) => {
  const { swapped } = run;
  if (swapped === undefined) {
    return { levels: run.levels, winner: run.winner };
  }
  const both = (one: string, other: string | undefined) =>
    one === other ? one : "tie";
  return {
    levels: Object.fromEntries(
      Object.entries(run.levels).map(([level, side]) => [
        level,
        both(side, swapped.levels[level]),
      ])
    ),
    winner: both(run.winner, swapped.winner),
  };
};

/** The runs judged in both orders, and those whose winner changed with the order. */
export const flipsOf = (
  results: Readonly<Record<string, typeof Judged.Type>>
) => {
  const both = Object.values(results).filter((r) => r.swapped !== undefined);
  return {
    both: both.length,
    flipped: both.filter((r) => r.swapped?.winner !== r.winner).length,
  };
};

/** A stable number from a run's name, so the same run always shows the same round first. */
const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7);

/**
 * The rounds a run's designs are shown as, A then B: which comes first follows the run's name, so
 * neither round is always first, and a run asked again is shown as before.
 */
export const shownAs = (
  a: string,
  b: string,
  key: string
): readonly [string, string] => (hash(key) % 2 === 1 ? [b, a] : [a, b]);

/** A blind verdict with its letters turned into the rounds' names. */
export const unblind = (
  verdict: typeof Verdict.Type,
  [first, second]: readonly [string, string]
): typeof Judged.Type => {
  const nameOf = (side: (typeof SIDES)[number]) => {
    if (side === "tie") {
      return "tie";
    }
    return side === "A" ? first : second;
  };
  return {
    levels: Object.fromEntries(
      Object.entries(verdict.levels).map(([l, v]) => [l, nameOf(v)])
    ),
    margin: verdict.margin,
    reasons: verdict.reasons,
    shownFirst: first,
    winner: nameOf(verdict.winner),
  };
};

const RUN_RE = /^run-\d+$/;
/** A path or a brace list of them ending on `.md`, as a tool call names files. */
const MD_RE = /[\w{},/.$-]*\.md/g;
/** Up to a file's path in the skill's cache: the version's folder. */
const CACHE_PREFIX_RE = /^.*\.cache\/ultrapaint\/skills\/[0-9a-f]+\//;
/** Up to a file's path in the skill as a project installs it, for Codex or for Claude Code. */
const INSTALLED_PREFIX_RE = /^.*\.(?:agents|claude)\/skills\/ultrapaint\//;
const INSTALLED_RE = /\.(?:agents|claude)\/skills\/ultrapaint\//;
/** The folder of one wording, in a cache from before it held the whole skill. */
const WORDING_RE = /^(?:with-tools|without-tools)\//;
const BRACES_RE = /\{([^{}]*)\}/;
/** A shell variable naming the folder (`$S/layout.md`), as an agent writes a long path once. */
const VARIABLE_RE = /^\$\w+\//;
const SKILL_FILE_RE = /^(?:SKILL|[a-z0-9-]+(?:\/[a-z0-9-]+)*)\.md$/;

/** `content/{voice,interface}.md` as the shell expands it. */
const expand = (file: string): string[] => {
  // Typed by hand: the linter otherwise takes the match for non-null.
  const m: RegExpExecArray | null = BRACES_RE.exec(file);
  if (!m) {
    return [file];
  }
  return (m[1] ?? "")
    .split(",")
    .flatMap((part) => expand(file.replace(m[0], part)));
};

/**
 * The skill's files a trace shows opened, from its tool calls, each by its path in the skill
 * (`SKILL.md`, `references/system/components.md`), sorted: in the cache the editor's agents read
 * it from, or where a project installs it (`.agents/skills/ultrapaint/`, a run outside the editor). A brace list opens each of its files,
 * and a call that reads part of a file counts. A call marked failed still read its files when
 * only a later command of its chain failed. A trace from before the cache held the whole skill
 * names a reference by its path under `references/`, which the cache was then, and a
 * `references/` path in it opened nothing.
 */
export const skillReads = (trace: string) => {
  const files = new Set<string>();
  for (const line of trace.split("\n")) {
    if (line.includes(".cache/ultrapaint/skills") || INSTALLED_RE.test(line)) {
      for (const [token] of line.matchAll(MD_RE)) {
        for (const file of inSkill(token)) {
          files.add(file);
        }
      }
    }
  }
  return [...files].sort();
};

/** The skill's files a path in a tool call names, by their paths in the skill. */
const inSkill = (token: string): string[] => {
  const inCache = token
    .replace(CACHE_PREFIX_RE, "")
    .replace(INSTALLED_PREFIX_RE, "")
    .replace(VARIABLE_RE, "");
  // Before, the cache held the references alone, a folder per wording or none.
  const before = WORDING_RE.test(inCache);
  return expand(inCache.replace(WORDING_RE, "")).flatMap((file) => {
    if (!SKILL_FILE_RE.test(file)) {
      return [];
    }
    if (file === "SKILL.md" || file.startsWith("references/")) {
      // A `references/` path in a cache of the references alone opened nothing.
      return before ? [] : [file];
    }
    return [`references/${file}`];
  });
};

/** The skill's files a run opened, from the tool calls of its trace. */
const readsOf = Effect.fn("readsOf")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(dir, "trace.md");
  return skillReads(
    (yield* fs.exists(file)) ? yield* fs.readFileString(file) : ""
  );
});

const pictures = Effect.fnUntraced(function* (dir: string) {
  const { data } = yield* EvalsConfig;
  return (yield* listDir(dir))
    .filter((f) => f.endsWith(".jpg"))
    .map((f) => `- \`${data.fromData(path.join(dir, f))}\``)
    .join("\n");
});

/** The runs both rounds drew, as `<reference>/run-<n>`. */
const sharedRuns = Effect.fn("sharedRuns")(function* (a: string, b: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const shot = (round: string, key: string) =>
    fs.exists(path.join(data.runs, round, key, "shots"));
  const keys: string[] = [];
  for (const reference of yield* listDir(path.join(data.runs, a))) {
    const dir = path.join(data.runs, a, reference);
    // A round's directory holds its findings and report beside the references' runs.
    if ((yield* fs.stat(dir)).type !== "Directory") {
      continue;
    }
    for (const run of yield* listDir(dir)) {
      const key = `${reference}/${run}`;
      if (RUN_RE.test(run) && (yield* shot(a, key)) && (yield* shot(b, key))) {
        keys.push(key);
      }
    }
  }
  return keys;
});

/**
 * One run of each round judged against the other, shown in the order given, the verdict under
 * the rounds' names.
 */
const judgeRun = Effect.fn("judgeRun")(function* (
  order: readonly [string, string],
  key: string,
  options: { readonly model: string; readonly principles: string }
) {
  const { data } = yield* EvalsConfig;
  const models = yield* Models;
  const reference = key.slice(0, key.indexOf("/"));
  const [first, second] = order;
  const answer = yield* models.ask({
    cwd: data.root,
    effort: "high",
    model: options.model,
    prompt: yield* prompt("pairwise", {
      a: yield* pictures(path.join(data.runs, first, key, "shots")),
      b: yield* pictures(path.join(data.runs, second, key, "shots")),
      principles: options.principles,
      reference: yield* pictures(data.captureDir(reference)),
    }),
    ...verdictAnswer,
  });
  return unblind(answer.value, order);
});

/** How many runs each round won, overall and level by level. */
export const tallyOf = (
  results: Readonly<Record<string, typeof Judged.Type>>
) => {
  const tally: Record<string, number> = {};
  const count = (k: string) => {
    tally[k] = (tally[k] ?? 0) + 1;
  };
  for (const r of Object.values(results)) {
    const { levels, winner } = settled(r);
    count(winner);
    for (const [level, side] of Object.entries(levels)) {
      count(`${level}:${side}`);
    }
  }
  return tally;
};

export const pairwise = Effect.fn("pairwise")(function* (
  a: string,
  b: string,
  options: {
    readonly model: string;
    /** Judges each run once, in the order its name gives; twice, both ways round, without it. */
    readonly oneOrder?: boolean;
  }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const out = path.join(data.runs, `${a}-vs-${b}`);
  const file = path.join(out, "pairwise.json");
  const results: Record<string, typeof Judged.Type> = (yield* fs.exists(file))
    ? { ...(yield* readJson(Results, file)) }
    : {};
  const reads: Record<string, Record<string, readonly string[]>> = {};
  const principles = yield* fs.readFileString(
    path.join(PROMPTS, "principles.md")
  );

  for (const key of yield* sharedRuns(a, b)) {
    reads[key] = {
      [a]: yield* readsOf(path.join(data.runs, a, key)),
      [b]: yield* readsOf(path.join(data.runs, b, key)),
    };
    const [first, second] = shownAs(a, b, key);
    const ask = (order: readonly [string, string]) =>
      judgeRun(order, key, { model: options.model, principles }).pipe(
        // A run the judge could not answer for is left out; the next call asks again.
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning(`${key}: not judged: ${String(error)}`),
            undefined
          )
        )
      );
    const kept = results[key];
    if (
      kept !== undefined &&
      (kept.swapped !== undefined || options.oneOrder)
    ) {
      continue;
    }
    const once = kept ?? (yield* ask([first, second]));
    if (once === undefined) {
      continue;
    }
    const swapped = options.oneOrder ? undefined : yield* ask([second, first]);
    if (kept !== undefined && swapped === undefined) {
      continue;
    }
    const run = swapped === undefined ? once : { ...once, swapped };
    results[key] = run;
    yield* writeJson(file, results);
    yield* Effect.log(
      `${key}: ${settled(run).winner}${
        swapped !== undefined && swapped.winner !== once.winner
          ? ` (${once.winner} one way round, ${swapped.winner} the other)`
          : ` (${once.margin})`
      }`
    );
  }
  yield* writeJson(path.join(out, "reads.json"), reads);
  yield* Effect.log(`tally ${JSON.stringify(tallyOf(results))}`);
  const flips = flipsOf(results);
  if (flips.both > 0) {
    yield* Effect.log(
      `${flips.flipped} of ${flips.both} winners changed with the order the designs were shown in: each is counted a tie`
    );
  }
});
