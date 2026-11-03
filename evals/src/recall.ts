/**
 * `recall`: whether a reviewer told a version of the design skill finds what a person found.
 *
 * Each section of the data directory's `gaps/sections/` (`section.json`, its pictures, its code as
 * it was) is reviewed by a fresh agent with each version of the skill, several runs each: the
 * checkout's `skills/ultrapaint/` (`built-in`), or a candidate laid over it (`candidates/<fix>`).
 * A judge that is not told the version matches each review with the gaps (`evals/gaps/`) whose
 * `sections` name that section. What no gap matches is grouped across every review of the
 * section, for a person to rate as real or noise. A section no gap names is held out: all that is
 * found there is for the person.
 *
 * It resumes: a review, a judgement or a grouping already made is kept. It ends on
 * `runs/<round>/report.md`, and writes each gap's line under **Result.** in its file, its status
 * `testing`.
 */
import path from "node:path";
import { DateTime, Effect, FileSystem, Predicate, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  isFinding,
  type LoadedGap,
  loadGaps,
  partOf,
  recordResult,
} from "./gap.ts";
import { listDir, prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";

export const Section = Schema.Struct({
  /** The files under `code/`, the design system's `DESIGN.md` first. */
  code: Schema.Array(Schema.String),
  /** The commit the pictures and the code are of. */
  commit: Schema.String,
  name: Schema.String,
  pictures: Schema.Array(
    Schema.Struct({ file: Schema.String, shows: Schema.String })
  ),
  /** Where it is and what it is for, in words that do not say what is wrong with it. */
  where: Schema.String,
});
export type Section = typeof Section.Type;

const Finding = Schema.Struct({
  fix: Schema.String,
  problem: Schema.String,
  title: Schema.String,
  where: Schema.String,
});
export type Finding = typeof Finding.Type;

export const Review = Schema.Struct({
  findings: Schema.Array(Finding),
  /** The skill's files the reviewer says it read. */
  read: Schema.Array(Schema.String),
});
export type Review = typeof Review.Type;

const str = { type: "string" };
const reviewAnswer = {
  decode: Review,
  schema: {
    additionalProperties: false,
    properties: {
      findings: {
        items: {
          additionalProperties: false,
          properties: { fix: str, problem: str, title: str, where: str },
          required: ["title", "where", "problem", "fix"],
          type: "object",
        },
        type: "array",
      },
      read: { items: str, type: "array" },
    },
    required: ["read", "findings"],
    type: "object",
  },
};

export const VERDICTS = ["caught", "partly", "missed"] as const;
export const Judgement = Schema.Struct({
  gaps: Schema.Array(
    Schema.Struct({
      /** The numbers of the review's findings that match it, from 1. */
      findings: Schema.Array(Schema.Number),
      id: Schema.String,
      verdict: Schema.Literals(VERDICTS),
      why: Schema.String,
    })
  ),
});
export type Judgement = typeof Judgement.Type;

const judgementAnswer = {
  decode: Judgement,
  schema: {
    additionalProperties: false,
    properties: {
      gaps: {
        items: {
          additionalProperties: false,
          properties: {
            findings: { items: { type: "integer" }, type: "array" },
            id: str,
            verdict: { enum: VERDICTS, type: "string" },
            why: str,
          },
          required: ["id", "verdict", "findings", "why"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["gaps"],
    type: "object",
  },
};

const Problems = Schema.Struct({
  problems: Schema.Array(
    Schema.Struct({
      /** The labels of the findings it groups. */
      findings: Schema.Array(Schema.String),
      problem: Schema.String,
      title: Schema.String,
    })
  ),
});

const problemsAnswer = {
  decode: Problems,
  schema: {
    additionalProperties: false,
    properties: {
      problems: {
        items: {
          additionalProperties: false,
          properties: {
            findings: { items: str, type: "array" },
            problem: str,
            title: str,
          },
          required: ["title", "problem", "findings"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["problems"],
    type: "object",
  },
};

/** What no gap matched in one section, grouped: each problem with the findings it groups by id. */
const Unmatched = Schema.Struct({
  /** The findings that were grouped, so a new review groups them again. */
  keys: Schema.Array(Schema.String),
  problems: Schema.Array(
    Schema.Struct({
      findings: Schema.Array(Schema.String),
      problem: Schema.String,
      title: Schema.String,
    })
  ),
});
type Unmatched = typeof Unmatched.Type;

const Saved = <S extends Schema.Top>(schema: S) =>
  Schema.Struct({ costUsd: Schema.Number, value: schema });

/** A version of the skill by the name the report gives it: `shipped`, or the candidate's. */
export const versionName = (skills: string) =>
  skills === "built-in" ? "shipped" : path.basename(skills);

/**
 * Where a candidate's file goes in the skill's tree: `SKILL.md` is the router, every other file
 * a reference (`states.md`, `patterns/canvas-tools.md`).
 */
export const placeOf = (file: string) =>
  file === "SKILL.md" ? file : path.join("references", file);

const WAYS_RE =
  /\[with the editor's tools: ([\s\S]*?) \| without: ([\s\S]*?)\]/g;

/** The skill's text as an agent without the editor's tools reads it, as the server words it. */
export const withoutTools = (text: string) =>
  text.replace(WAYS_RE, (_, _withTools: string, without: string) => without);

/** The numbers of a review's findings, from 1, that no gap was matched with. */
export const unmatchedOf = (
  review: Review,
  judgement: Judgement | undefined
) => {
  const matched = new Set(
    (judgement?.gaps ?? [])
      .filter((g) => g.verdict !== "missed")
      .flatMap((g) => g.findings)
  );
  return review.findings.map((_, i) => i + 1).filter((n) => !matched.has(n));
};

/** A stable number from a text, so the same findings are shown in the same order. */
const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7);

/** One review of a section with one version, and what was judged of it. */
export interface Reviewed {
  readonly judgement: Judgement | undefined;
  readonly review: Review;
  readonly run: number;
  readonly version: string;
}

/** How many runs of each version caught each gap, and partly caught it. */
export interface Tally {
  readonly caught: number;
  readonly partly: number;
  readonly runs: number;
}

/** Each gap's tally per version, from the judged reviews of its sections. */
export const tallyOf = (
  gaps: readonly {
    readonly id: string;
    readonly sections: readonly string[];
  }[],
  reviewed: Readonly<Record<string, readonly Reviewed[]>>,
  versions: readonly string[]
) =>
  Object.fromEntries(
    gaps.map((gap) => {
      const verdicts = gap.sections
        .flatMap((section) => reviewed[section] ?? [])
        .flatMap((r) => {
          const verdict = r.judgement?.gaps.find(
            (g) => g.id === gap.id
          )?.verdict;
          return verdict === undefined ? [] : [{ verdict, version: r.version }];
        });
      return [
        gap.id,
        Object.fromEntries(
          versions.map((version) => {
            const of = verdicts.filter((v) => v.version === version);
            const count = (verdict: string) =>
              of.filter((v) => v.verdict === verdict).length;
            return [
              version,
              {
                caught: count("caught"),
                partly: count("partly"),
                runs: of.length,
              },
            ];
          })
        ) as Record<string, Tally>,
      ];
    })
  ) as Record<string, Record<string, Tally>>;

/** "1/2", with the partly caught after it: "1/2 (+1 partly)". */
export const showTally = (t: Tally | undefined) =>
  t === undefined || t.runs === 0
    ? "–"
    : `${t.caught}/${t.runs}${t.partly > 0 ? ` (+${t.partly} partly)` : ""}`;

const sum = (tallies: readonly (Tally | undefined)[]): Tally =>
  tallies.filter(Predicate.isNotUndefined).reduce<Tally>(
    (a, t) => ({
      caught: a.caught + t.caught,
      partly: a.partly + t.partly,
      runs: a.runs + t.runs,
    }),
    { caught: 0, partly: 0, runs: 0 }
  );

export interface RecallOptions {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly round: string;
  readonly runs: number;
  /** The sections to review; every one there is when empty. */
  readonly sections: readonly string[];
  /** The versions: `built-in`, `candidates/<fix>`. */
  readonly skills: readonly string[];
}

/** The skill as a version gives it, written once into the round: what its reviewers read. */
const skillTree = Effect.fn("skillTree")(function* (
  round: string,
  skills: string
) {
  const { checkout, data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const tree = path.join(data.runs, round, "skills", versionName(skills));
  if (yield* fs.exists(tree)) {
    return tree;
  }
  const shipped = path.join(checkout, "skills", "ultrapaint");
  const write = (from: string, to: string) =>
    Effect.gen(function* () {
      const text = yield* fs.readFileString(from);
      yield* writeText(to, withoutTools(text));
    });
  for (const file of yield* fs.readDirectory(shipped, { recursive: true })) {
    if (file.endsWith(".md")) {
      yield* write(path.join(shipped, file), path.join(tree, file));
    }
  }
  if (skills !== "built-in") {
    const candidate = path.resolve(data.root, skills);
    const files = (yield* fs.exists(candidate))
      ? (yield* fs.readDirectory(candidate, { recursive: true })).filter((f) =>
          f.endsWith(".md")
        )
      : [];
    if (files.length === 0) {
      return yield* new EvalsError({ message: `no skill files in ${skills}` });
    }
    for (const file of files) {
      yield* write(path.join(candidate, file), path.join(tree, placeOf(file)));
    }
  }
  return tree;
});

/**
 * A section as the round reviews it: its pictures and code copied into the round, where its
 * reviewers and judges work, with nothing beside them that names a gap.
 */
const sectionCopy = Effect.fn("sectionCopy")(function* (
  round: string,
  id: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const from = path.join(data.sections, id);
  const section = yield* readJson(Section, path.join(from, "section.json"));
  const dir = path.join(data.runs, round, "sections", id);
  if (!(yield* fs.exists(dir))) {
    for (const part of ["pictures", "code"]) {
      if (yield* fs.exists(path.join(from, part))) {
        yield* fs.copy(path.join(from, part), path.join(dir, part));
      }
    }
  }
  return { dir, section };
});

const picturesOf = (section: Section) =>
  section.pictures.map((p) => `- \`${p.file}\`: ${p.shows}`).join("\n");

const reviewOne = Effect.fn("reviewOne")(function* (
  copy: { readonly dir: string; readonly section: Section },
  tree: string,
  options: RecallOptions
) {
  const models = yield* Models;
  const { section } = copy;
  const answer = yield* models.ask({
    cwd: copy.dir,
    dirs: [tree],
    effort: options.effort,
    model: options.model,
    prompt: yield* prompt("recall-review", {
      code: section.code.map((f) => `- \`${f}\``).join("\n"),
      name: section.name,
      pictures: picturesOf(section),
      skill: tree,
      where: section.where,
    }),
    ...reviewAnswer,
  });
  return { costUsd: answer.costUsd, value: answer.value };
});

const listFindings = (findings: readonly (readonly [string, Finding])[]) =>
  findings
    .map(
      ([label, f]) =>
        `${label}. **${f.title}** (${f.where}): ${f.problem} Fix: ${f.fix}`
    )
    .join("\n");

const judgeOne = Effect.fn("judgeOne")(function* (
  copy: { readonly dir: string; readonly section: Section },
  gaps: readonly LoadedGap[],
  review: Review,
  options: RecallOptions
) {
  const models = yield* Models;
  const answer = yield* models.ask({
    cwd: copy.dir,
    effort: options.effort,
    model: options.model,
    prompt: yield* prompt("recall-judge", {
      findings:
        review.findings.length === 0
          ? "(none)"
          : listFindings(review.findings.map((f, i) => [String(i + 1), f])),
      gaps: gaps
        .map(
          (g) =>
            `- \`${g.id}\` **${g.title}.** ${partOf(g.body, "What happened")}`
        )
        .join("\n"),
      name: copy.section.name,
      pictures: picturesOf(copy.section),
      where: copy.section.where,
    }),
    ...judgementAnswer,
  });
  return { costUsd: answer.costUsd, value: answer.value };
});

/** What no gap matched in a section's reviews, grouped by problem; asked again when they change. */
const groupUnmatched = Effect.fn("groupUnmatched")(function* (
  copy: { readonly dir: string; readonly section: Section },
  file: string,
  reviewed: readonly Reviewed[],
  options: RecallOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const findings = reviewed.flatMap((r) =>
    unmatchedOf(r.review, r.judgement).map(
      (n) =>
        [`${r.version}/run-${r.run}#${n}`, r.review.findings[n - 1]] as const
    )
  );
  const keys = findings.map(([key]) => key).sort();
  const saved = (yield* fs.exists(file))
    ? yield* readJson(Saved(Unmatched), file)
    : undefined;
  if (saved && saved.value.keys.join("\n") === keys.join("\n")) {
    return saved;
  }
  if (findings.length === 0) {
    return { costUsd: 0, value: { keys, problems: [] } };
  }
  // Shown under labels in an order of their own, so nothing says which version found what.
  const shown = [...findings].sort(([a], [b]) => hash(a) - hash(b));
  const label = new Map(shown.map(([key], i) => [`F${i + 1}`, key]));
  const answer = yield* models.ask({
    cwd: copy.dir,
    effort: options.effort,
    model: options.model,
    prompt: yield* prompt("recall-group", {
      findings: listFindings(
        shown.flatMap(([, f], i) =>
          f === undefined ? [] : [[`F${i + 1}`, f] as const]
        )
      ),
      name: copy.section.name,
      pictures: picturesOf(copy.section),
      where: copy.section.where,
    }),
    ...problemsAnswer,
  });
  const value: Unmatched = {
    keys,
    problems: answer.value.problems.map((p) => ({
      ...p,
      findings: p.findings.flatMap((l) => {
        const key = label.get(l);
        return key === undefined ? [] : [key];
      }),
    })),
  };
  const result = { costUsd: answer.costUsd, value };
  yield* writeJson(file, result);
  return result;
});

/** A step that failed is logged and left out; the next call asks again. */
const orLater = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning(`${what}: not done: ${String(error)}`),
        undefined
      )
    )
  );

/** Reads a saved step, or makes it and saves it. */
const kept = <S extends Schema.Top, E, R>(
  file: string,
  schema: S,
  make: Effect.Effect<
    { readonly costUsd: number; readonly value: S["Type"] },
    E,
    R
  >
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (yield* fs.exists(file)) {
      return yield* readJson(Saved(schema), file);
    }
    const made = yield* make;
    yield* writeJson(file, made);
    return made;
  });

export const recall = Effect.fn("recall")(function* (options: RecallOptions) {
  const { data } = yield* EvalsConfig;
  const out = path.join(data.runs, options.round);
  const gaps = yield* loadGaps();
  const sectionIds =
    options.sections.length > 0
      ? options.sections
      : yield* listDir(data.sections);
  const fs = yield* FileSystem.FileSystem;
  const ids: string[] = [];
  for (const id of sectionIds) {
    // A file beside the sections is not one.
    const isSection = yield* fs
      .exists(path.join(data.sections, id, "section.json"))
      .pipe(Effect.orElseSucceed(() => false));
    if (isSection) {
      ids.push(id);
    }
  }
  const versions = options.skills.map(versionName);
  const trees = new Map<string, string>();
  for (const skills of options.skills) {
    trees.set(versionName(skills), yield* skillTree(options.round, skills));
  }
  yield* writeJson(path.join(out, "recall.json"), {
    effort: options.effort,
    model: options.model,
    runs: options.runs,
    sections: ids,
    skills: options.skills,
  });

  // A finding is matched by the judge; a gap of process is measured through its sections' findings.
  const findingGaps = gaps.filter(isFinding);
  const gapsOf = (section: string) =>
    findingGaps.filter((g) => g.sections.includes(section));

  let cost = 0;
  const reviewed: Record<string, Reviewed[]> = {};
  const unmatched: Record<string, Unmatched> = {};
  yield* Effect.forEach(
    ids,
    (id) =>
      Effect.gen(function* () {
        const copy = yield* sectionCopy(options.round, id);
        const jobs = versions.flatMap((version) =>
          Array.from({ length: options.runs }, (_, i) => ({
            run: i + 1,
            version,
          }))
        );
        const done = yield* Effect.forEach(
          jobs,
          ({ run, version }) =>
            orLater(
              `${id} ${version} run ${run}`,
              Effect.gen(function* () {
                const dir = path.join(out, id, version, `run-${run}`);
                const tree = trees.get(version) ?? "";
                const review = yield* kept(
                  path.join(dir, "review.json"),
                  Review,
                  reviewOne(copy, tree, options)
                );
                cost += review.costUsd;
                const judged =
                  gapsOf(id).length === 0
                    ? undefined
                    : yield* kept(
                        path.join(dir, "judgement.json"),
                        Judgement,
                        judgeOne(copy, gapsOf(id), review.value, options)
                      );
                cost += judged?.costUsd ?? 0;
                yield* Effect.log(
                  `${id} ${version} run ${run}: ${review.value.findings.length} findings`
                );
                return {
                  judgement: judged?.value,
                  review: review.value,
                  run,
                  version,
                } satisfies Reviewed;
              })
            ),
          { concurrency: options.concurrency }
        );
        reviewed[id] = done.flatMap((r) => (r === undefined ? [] : [r]));
        const grouped = yield* orLater(
          `${id} unmatched`,
          groupUnmatched(
            copy,
            path.join(out, id, "unmatched.json"),
            reviewed[id],
            options
          )
        );
        cost += grouped?.costUsd ?? 0;
        if (grouped) {
          unmatched[id] = grouped.value;
        }
      }),
    { concurrency: 2 }
  );

  const tally = tallyOf(findingGaps, reviewed, versions);
  const sectionTally = (sections: readonly string[]) =>
    Object.fromEntries(
      versions.map((v) => [
        v,
        sum(
          findingGaps
            .filter((g) => g.sections.some((s) => sections.includes(s)))
            .map((g) => tally[g.id]?.[v])
        ),
      ])
    );
  const sectionNames = new Map<string, string>();
  for (const id of ids) {
    sectionNames.set(
      id,
      (yield* readJson(Section, path.join(data.sections, id, "section.json")))
        .name
    );
  }
  const text = reportOf({
    cost,
    gaps,
    held: ids.filter((id) => gapsOf(id).length === 0),
    options,
    reviewed,
    sectionNames,
    sectionTally,
    tally,
    unmatched,
    versions,
  });
  yield* writeText(path.join(out, "report.md"), text);
  yield* writeJson(path.join(out, "results.json"), { cost, tally, unmatched });

  const today = DateTime.formatIsoDateUtc(yield* DateTime.now);
  const measured = (gap: LoadedGap) =>
    isFinding(gap)
      ? (tally[gap.id] ?? {})
      : sectionTally(gap.sections.filter((s) => ids.includes(s)));
  for (const gap of gaps) {
    const t = measured(gap);
    if (
      gap.sections.some((s) => ids.includes(s)) &&
      versions.some((v) => (t[v]?.runs ?? 0) > 0)
    ) {
      const what = isFinding(gap) ? "caught" : "its sections' gaps caught";
      const counts = versions.map((v) => `${v} ${showTally(t[v])}`).join(", ");
      yield* recordResult(
        gap,
        options.round,
        `${today}, ${what}: ${counts} (${options.model}, effort ${options.effort}; runs/${options.round}/report.md)`
      );
    }
  }
  yield* Effect.log(`report: ${data.fromData(path.join(out, "report.md"))}`);
});

interface ReportInput {
  readonly cost: number;
  readonly gaps: readonly LoadedGap[];
  readonly held: readonly string[];
  readonly options: RecallOptions;
  readonly reviewed: Readonly<Record<string, readonly Reviewed[]>>;
  readonly sectionNames: ReadonlyMap<string, string>;
  readonly sectionTally: (
    sections: readonly string[]
  ) => Readonly<Record<string, Tally>>;
  readonly tally: Readonly<Record<string, Readonly<Record<string, Tally>>>>;
  readonly unmatched: Readonly<Record<string, Unmatched>>;
  readonly versions: readonly string[];
}

/** The round's report: recall per gap and version, then what no gap matched, to be rated. */
export const reportOf = (input: ReportInput) => {
  const { options, versions } = input;
  const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const head = (cells: readonly string[]) =>
    [row(cells), row(cells.map(() => "---"))].join("\n");
  const findingGaps = input.gaps.filter(
    (g) => isFinding(g) && g.sections.length > 0
  );
  const processGaps = input.gaps.filter(
    (g) => !isFinding(g) && g.sections.length > 0
  );
  const lines = [
    `# Recall: ${options.round}`,
    "",
    `Every reviewer, judge and grouping: \`${options.model}\`, effort ${options.effort}. ` +
      `${options.runs} run(s) per section and version. Versions: ${options.skills
        .map((s) => `${versionName(s)} (\`${s}\`)`)
        .join(", ")}. Cost: $${input.cost.toFixed(2)}.`,
    "",
    "A gap is caught when the judge, blind to the version, found a review's finding naming the " +
      "same problem on the same element; partly, when one touched it and missed what made it one.",
    "",
    "## Recall per gap",
    "",
    head(["Gap", "Kind", "Section", ...versions]),
    ...findingGaps.map((g) =>
      row([
        `${g.id} ${g.title}`,
        g.kind,
        g.sections.join(", "),
        ...versions.map((v) => showTally(input.tally[g.id]?.[v])),
      ])
    ),
    row([
      "**All**",
      "",
      "",
      ...versions.map(
        (v) =>
          `**${showTally(sum(findingGaps.map((g) => input.tally[g.id]?.[v])))}**`
      ),
    ]),
    "",
  ];
  if (processGaps.length > 0) {
    lines.push(
      "## Process gaps, through their sections' gaps",
      "",
      head(["Gap", "Sections", ...versions]),
      ...processGaps.map((g) => {
        const t = input.sectionTally(g.sections);
        return row([
          `${g.id} ${g.title}`,
          g.sections.join(", "),
          ...versions.map((v) => showTally(t[v])),
        ]);
      }),
      ""
    );
  }
  lines.push(
    "## Found where no gap is",
    "",
    "Each problem a review found that matches no gap, grouped across the reviews of its section, " +
      "with how many runs of each version found it. Rate each: real or noise.",
    ""
  );
  for (const [id, grouped] of Object.entries(input.unmatched).sort()) {
    const runs = (v: string) =>
      (input.reviewed[id] ?? []).filter((r) => r.version === v).length;
    lines.push(
      `### ${input.sectionNames.get(id) ?? id} (\`${id}\`${input.held.includes(id) ? ", held out" : ""})`,
      ""
    );
    if (grouped.problems.length === 0) {
      lines.push("Nothing.", "");
      continue;
    }
    lines.push(
      head(["Problem", ...versions, "Real or noise"]),
      ...grouped.problems.map((p) =>
        row([
          `**${p.title}.** ${p.problem}`
            .replaceAll("|", "\\|")
            .replaceAll("\n", " "),
          ...versions.map((v) => {
            const by = new Set(
              p.findings
                .filter((f) => f.startsWith(`${v}/`))
                .map((f) => f.split("#")[0])
            );
            return `${by.size}/${runs(v)}`;
          }),
          "",
        ])
      ),
      ""
    );
  }
  return `${lines.join("\n")}\n`;
};
