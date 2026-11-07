/**
 * `triage` (ADR 0066, issue #8): what review models find in real use, turned into design gaps.
 * The findings log (`~/.ultrapaint/findings/*.jsonl`, kept while the person keeps findings) is read
 * from where the last applied triage stopped; a model groups the findings that describe the same
 * problem, category by category; a group that recurs (in several designs, or found by several
 * review models) and that its designers did not mostly decline is checked by review models on two
 * providers against the skill and the gaps; what they agree is real and general is drafted as a
 * gap, or as evidence for the gap that covers it, and put to the person in a decision deck.
 * `--apply` writes what the person kept into `evals/gaps/`.
 *
 * Everything a run makes is in the data directory's `triage/<name>/`: what it read, the groups and
 * the checks (kept, so a run resumes), the drafts, and the crops the deck shows. Nothing of a
 * project reaches git until the person keeps it.
 */
import path from "node:path";
import {
  CATEGORIES,
  CATEGORY_FILES,
  type Category,
  LoggedFinding,
} from "@ultrapaint/contracts/review";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { type Card, type Deck, OWN_ANSWER } from "./decide.ts";
import { EvalsError } from "./errors.ts";
import { type LoadedGap, loadGaps } from "./gap.ts";
import { listDir, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";

// ---- The log ----

const decodeLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(LoggedFinding)
);

/** The findings of a log's text, a line each, and how many lines did not read as one. */
export const parseLog = (text: string) => {
  const findings: LoggedFinding[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const finding = decodeLine(line);
    if (Option.isSome(finding)) {
      findings.push(finding.value);
    } else {
      unreadable += 1;
    }
  }
  return { findings, unreadable };
};

/** A design a finding was made in: the project's page. */
const designOf = (f: LoggedFinding) => `${f.project} › ${f.page}`;

// ---- Evidence ----

export interface Evidence {
  /** Findings the designer declined, with a reason: evidence against. */
  readonly declined: number;
  /** The designs it was found in. */
  readonly designs: readonly string[];
  readonly fixed: number;
  /** The review models that found it, the ones that agreed included. */
  readonly models: readonly string[];
  readonly projects: readonly string[];
}

export const evidenceOf = (findings: readonly LoggedFinding[]): Evidence => ({
  declined: findings.filter((f) => f.designer.did === "declined").length,
  designs: [...new Set(findings.map(designOf))].sort(),
  fixed: findings.filter((f) => f.designer.did === "fixed").length,
  models: [
    ...new Set(findings.flatMap((f) => [f.reviewer, ...f.agreedBy])),
  ].sort(),
  projects: [...new Set(findings.map((f) => f.project))].sort(),
});

export interface Thresholds {
  readonly minDesigns: number;
  readonly minModels: number;
}

/**
 * Whether a group recurs enough to be checked: found in enough designs, or by enough review
 * models, and not mostly declined by the designers who were asked.
 */
export const recurs = (evidence: Evidence, at: Thresholds) =>
  (evidence.designs.length >= at.minDesigns ||
    evidence.models.length >= at.minModels) &&
  evidence.declined <= evidence.fixed;

// ---- Grouping ----

const Grouped = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({
      members: Schema.Array(Schema.Number),
      title: Schema.String,
    })
  ),
});
type Grouped = typeof Grouped.Type;

const str = { type: "string" } as const;

const groupAnswer = {
  decode: Grouped,
  schema: {
    additionalProperties: false,
    properties: {
      groups: {
        items: {
          additionalProperties: false,
          properties: {
            members: { items: { type: "integer" }, type: "array" },
            title: str,
          },
          required: ["title", "members"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["groups"],
    type: "object",
  },
};

/** A finding as a model reads it among others, by its number. */
const findingLine = (f: LoggedFinding, n: number) =>
  `[${n}] (${f.severity}) ${f.title}: ${f.problem}${f.rule ? ` Rule cited: ${f.rule}.` : ""} In ${designOf(f)}, ${f.section}; by ${f.reviewer}; the designer ${f.designer.did}${f.designer.reason ? `: ${f.designer.reason}` : ""}.`;

/**
 * The groups a model made of findings, as lists of the findings: a number it gave twice keeps its
 * first group, and a finding it left out is a group of its own.
 */
export const groupsFrom = (
  findings: readonly LoggedFinding[],
  grouped: Grouped
): { readonly findings: LoggedFinding[]; readonly title: string }[] => {
  const taken = new Set<number>();
  const groups: { findings: LoggedFinding[]; title: string }[] = [];
  for (const group of grouped.groups) {
    const members = group.members.filter(
      (n) =>
        Number.isInteger(n) && n >= 0 && n < findings.length && !taken.has(n)
    );
    for (const n of members) {
      taken.add(n);
    }
    if (members.length > 0) {
      groups.push({
        findings: members.map((n) => findings[n] as LoggedFinding),
        title: group.title,
      });
    }
  }
  findings.forEach((f, n) => {
    if (!taken.has(n)) {
      groups.push({ findings: [f], title: f.title });
    }
  });
  return groups;
};

// ---- Checking ----

export const GapKind = Schema.Literals(["missing", "missed", "process"]);

const Checked = Schema.Struct({
  gap: Schema.String,
  general: Schema.Boolean,
  happened: Schema.String,
  kind: GapKind,
  proposed: Schema.String,
  real: Schema.Boolean,
  rule: Schema.String,
  skill: Schema.Array(Schema.String),
  test: Schema.String,
  title: Schema.String,
});
export type Checked = typeof Checked.Type;

const checkAnswer = {
  decode: Checked,
  schema: {
    additionalProperties: false,
    properties: {
      gap: str,
      general: { type: "boolean" },
      happened: str,
      kind: { enum: ["missing", "missed", "process"], type: "string" },
      proposed: str,
      real: { type: "boolean" },
      rule: str,
      skill: { items: str, type: "array" },
      test: str,
      title: str,
    },
    required: [
      "real",
      "general",
      "kind",
      "rule",
      "gap",
      "title",
      "happened",
      "proposed",
      "test",
      "skill",
    ],
    type: "object",
  },
};

/** A group with what each model said of it. */
export interface CheckedGroup {
  readonly category: Category;
  readonly checks: Readonly<Record<string, Checked>>;
  readonly evidence: Evidence;
  readonly findings: readonly LoggedFinding[];
  readonly key: string;
  readonly title: string;
}

/** What becomes of a checked group: a new gap, evidence for one there is, or nothing. */
export type Verdict =
  | { readonly kind: "new"; readonly check: Checked }
  | { readonly kind: "evidence"; readonly gap: string }
  | { readonly kind: "none"; readonly why: string };

/**
 * Every model must find it real and general. A gap that covers it, named by any model and there
 * in `evals/gaps/`, takes it as evidence; else the first model's draft is the new gap's.
 */
export const verdictOf = (
  group: Pick<CheckedGroup, "checks">,
  known: ReadonlySet<string>
): Verdict => {
  const said = Object.entries(group.checks);
  if (said.length === 0) {
    return { kind: "none", why: "no model checked it" };
  }
  const against = said.filter(([, c]) => !(c.real && c.general));
  if (against.length > 0) {
    return {
      kind: "none",
      why: `${against.map(([model]) => model).join(", ")} found it not real or not general`,
    };
  }
  const covered = said
    .map(([, c]) => c.gap.trim())
    .find((id) => id !== "" && known.has(id));
  if (covered) {
    return { gap: covered, kind: "evidence" };
  }
  return { check: (said[0] as [string, Checked])[1], kind: "new" };
};

// ---- Gaps ----

const SLUG_RE = /[^a-z0-9]+/g;
const EDGE_RE = /^-|-$/g;
const ID_RE = /^([gp])(\d+)$/;

const slugOf = (title: string) =>
  title.toLowerCase().replace(SLUG_RE, "-").replace(EDGE_RE, "").slice(0, 48);

/** The next ids of the gaps: `g` for a problem seen in designs, `p` for how the skill is run. */
export const nextIds = (gaps: readonly Pick<LoadedGap, "id">[]) => {
  const highest = { g: 0, p: 0 };
  for (const { id } of gaps) {
    const found: RegExpExecArray | null = ID_RE.exec(id);
    if (found) {
      const letter = found[1] as "g" | "p";
      highest[letter] = Math.max(highest[letter], Number(found[2]));
    }
  }
  return (kind: Checked["kind"]) => {
    const letter = kind === "process" ? "p" : "g";
    highest[letter] += 1;
    return `${letter}${String(highest[letter]).padStart(2, "0")}`;
  };
};

/** The evidence in a line: how many findings, designs, projects and models. */
export const evidenceLine = (evidence: Evidence, findings: number) =>
  `${findings} finding${findings === 1 ? "" : "s"} in ${evidence.designs.length} design${evidence.designs.length === 1 ? "" : "s"} of ${evidence.projects.join(", ")}, by ${evidence.models.join(", ")}; ${evidence.fixed} fixed, ${evidence.declined} declined`;

/** A finding quoted in a gap or a card: its words, where, by whom, and what the designer did. */
const quoted = (f: LoggedFinding) =>
  `- ${f.title}: ${f.problem} (${designOf(f)}, ${f.section}; ${f.reviewer}; ${f.designer.did}${f.designer.reason ? `: ${f.designer.reason}` : ""})`;

/** A new gap's file, from the check that drafted it and the findings it rests on. */
export const gapFile = (options: {
  readonly check: Checked;
  readonly evidence: Evidence;
  readonly findings: readonly LoggedFinding[];
  readonly found: string;
  readonly id: string;
  readonly run: string;
}) => {
  const { check, evidence, findings, found, id, run } = options;
  const skill = check.skill.length > 0 ? check.skill.join(", ") : "SKILL.md";
  return `---
id: ${id}
title: ${check.title}
kind: ${check.kind}
status: open
found: ${found}
source: findings log, triage ${run}: ${evidenceLine(evidence, findings.length)}
skill: [${skill}]
sections: []
---

**What happened.** ${check.happened}

${findings.slice(0, 8).map(quoted).join("\n")}

**The skill now.** ${check.kind === "missed" && check.rule ? check.rule : "No rule says it."}

**Proposed.** ${check.proposed}

**Test.** ${check.test}

**Result.**
`;
};

const RESULT = "**Result.**";

/** A gap's text with a line of new evidence under **Result.**, its status left as it is. */
export const withEvidence = (text: string, line: string) => {
  const at = text.indexOf(RESULT);
  if (at < 0) {
    return `${text.trimEnd()}\n\n${RESULT}\n\n${line}\n`;
  }
  return `${text.trimEnd()}\n${line}\n`;
};

// ---- The run ----

/** Where a run keeps what it makes, and where the last applied run stopped. */
const triageDir = (data: string) => path.join(data, "triage");

const Last = Schema.Struct({ at: Schema.String });

/** A draft put to the person: a new gap or evidence, with what it rests on. */
const Draft = Schema.Struct({
  category: Schema.String,
  check: Schema.optional(Checked),
  evidence: Schema.Struct({
    declined: Schema.Number,
    designs: Schema.Array(Schema.String),
    fixed: Schema.Number,
    models: Schema.Array(Schema.String),
    projects: Schema.Array(Schema.String),
  }),
  findings: Schema.Array(LoggedFinding),
  gap: Schema.optional(Schema.String),
  id: Schema.String,
  title: Schema.String,
});
type Draft = typeof Draft.Type;
const Drafts = Schema.Array(Draft);

export interface TriageOptions extends Thresholds {
  /** Read every finding, not only those after the last applied triage. */
  readonly all: boolean;
  readonly concurrency: number;
  readonly effort: string;
  /** The model that groups the findings. */
  readonly grouper: string;
  /** The models that check each group, on different providers. */
  readonly models: readonly string[];
  readonly name: string;
}

/** Every logged finding after `since`, with how many lines could not be read. */
const readLogs = Effect.fn("readLogs")(function* (since: string | undefined) {
  const { findings: dir } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* fs.exists(dir))
    ? (yield* listDir(dir)).filter((f) => f.endsWith(".jsonl"))
    : [];
  const found: LoggedFinding[] = [];
  let unreadable = 0;
  for (const file of files) {
    const read = parseLog(yield* fs.readFileString(path.join(dir, file)));
    found.push(...read.findings);
    unreadable += read.unreadable;
  }
  return {
    findings: found.filter((f) => since === undefined || f.at > since),
    unreadable,
  };
});

/** A card of the deck: what the person keeps or drops. */
const cardOf = (draft: Draft, pictures: Card["pictures"]): Card => {
  const head = `${evidenceLine(draft.evidence, draft.findings.length)}.`;
  const findings = draft.findings.slice(0, 6).map(quoted).join("\n");
  if (draft.gap) {
    return {
      body: `${head}\n\n${findings}`,
      eyebrow: `Seen again · ${draft.category}`,
      id: draft.id,
      options: [
        {
          key: "keep",
          label: `Add as evidence to ${draft.gap}`,
          leads: "A line under its Result",
        },
        { key: "drop", label: "Drop", leads: "Nothing is written" },
      ],
      ...(pictures && pictures.length > 0 ? { pictures } : {}),
      recommend: "keep",
      title: `${draft.gap}: ${draft.title}`,
    };
  }
  const { check } = draft;
  return {
    body: `${head}\n\n${findings}\n\n**The skill now.** ${check?.kind === "missed" && check.rule ? check.rule : "No rule says it."}\n\n**Proposed.** ${check?.proposed ?? ""}`,
    eyebrow: `${check?.kind ?? "missing"} · ${draft.category}`,
    id: draft.id,
    options: [
      {
        key: "keep",
        label: "Keep as a gap",
        leads: "A new file in evals/gaps/, status open, for the lab",
      },
      { key: "drop", label: "Drop", leads: "Nothing is written" },
    ],
    ...(pictures && pictures.length > 0 ? { pictures } : {}),
    recommend: "keep",
    title: check?.title ?? draft.title,
  };
};

interface Group {
  readonly category: Category;
  readonly findings: readonly LoggedFinding[];
  readonly key: string;
  readonly title: string;
}

/** What a run is given beside its options: where it writes, and the models. */
interface Run {
  readonly checkout: string;
  readonly models: Models["Service"];
  readonly options: TriageOptions;
  readonly out: string;
}

/** A category's findings in groups: kept, so a run resumes; one finding is its own group. */
const groupCategory = Effect.fnUntraced(function* (
  run: Run,
  category: Category,
  these: readonly LoggedFinding[]
) {
  const fs = yield* FileSystem.FileSystem;
  const cached = path.join(run.out, "groups", `${category}.json`);
  if (yield* fs.exists(cached)) {
    return yield* readJson(Grouped, cached);
  }
  const grouped: Grouped =
    these.length === 1
      ? { groups: [{ members: [0], title: these[0]?.title ?? "" }] }
      : (yield* run.models.ask({
          ...groupAnswer,
          cwd: run.checkout,
          effort: run.options.effort,
          model: run.options.grouper,
          prompt: yield* prompt("triage-group", {
            category,
            file: CATEGORY_FILES[category],
            findings: these.map(findingLine).join("\n"),
          }),
        })).value;
  yield* writeJson(cached, grouped);
  return grouped;
});

/** Every finding in a group, category by category: a problem is one rule's, a rule one reference's. */
const groupAll = Effect.fnUntraced(function* (
  run: Run,
  findings: readonly LoggedFinding[]
) {
  const groups: Group[] = [];
  for (const category of CATEGORIES) {
    const these = findings.filter((f) => f.category === category);
    if (these.length > 0) {
      const grouped = yield* groupCategory(run, category, these);
      for (const [n, g] of groupsFrom(these, grouped).entries()) {
        groups.push({ ...g, category, key: `${category}-${n + 1}` });
      }
    }
  }
  return groups;
});

/** What each model says of a group; kept as each answers, a model that fails left out. */
const checkGroup = Effect.fnUntraced(function* (run: Run, group: Group) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(run.out, "checks", `${group.key}.json`);
  const checks: Record<string, Checked> = (yield* fs.exists(file))
    ? { ...(yield* readJson(Schema.Record(Schema.String, Checked), file)) }
    : {};
  for (const model of run.options.models.filter((m) => !checks[m])) {
    const asked = yield* run.models
      .ask({
        ...checkAnswer,
        cwd: run.checkout,
        effort: run.options.effort,
        model,
        prompt: yield* prompt("triage-check", {
          findings: group.findings.map(findingLine).join("\n"),
          title: group.title,
        }),
      })
      .pipe(
        Effect.map((a) => a.value),
        // One model failing leaves the group with the others' word, said as it happens.
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(
            Console.log(`${group.key}: ${model} failed: ${error.message}`),
            null
          )
        )
      );
    if (asked) {
      checks[model] = asked;
      yield* writeJson(file, checks);
    }
  }
  return {
    ...group,
    checks,
    evidence: evidenceOf(group.findings),
  } satisfies CheckedGroup;
});

/** The drafts the checks leave, and a line for each group they did not. */
export const draftsOf = (
  checked: readonly CheckedGroup[],
  known: ReadonlySet<string>
) => {
  const drafts: Draft[] = [];
  const dropped: string[] = [];
  for (const group of checked) {
    const verdict = verdictOf(group, known);
    if (verdict.kind === "none") {
      dropped.push(`- ${group.title} (${group.category}): ${verdict.why}`);
      continue;
    }
    drafts.push({
      category: group.category,
      ...(verdict.kind === "new" ? { check: verdict.check } : {}),
      evidence: group.evidence,
      findings: group.findings,
      ...(verdict.kind === "evidence" ? { gap: verdict.gap } : {}),
      id: group.key,
      title: verdict.kind === "new" ? verdict.check.title : group.title,
    });
  }
  return { drafts, dropped };
};

/** The first two crops of a draft that are there, copied beside the run for the deck to show. */
const picturesOf = Effect.fnUntraced(function* (out: string, draft: Draft) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const pictures: { caption: string; src: string }[] = [];
  for (const [n, f] of draft.findings.entries()) {
    if (pictures.length < 2 && f.crop && (yield* fs.exists(f.crop))) {
      const copy = path.join(
        out,
        "crops",
        `${draft.id}-${n + 1}${path.extname(f.crop)}`
      );
      yield* fs.makeDirectory(path.dirname(copy), { recursive: true });
      yield* fs.copyFile(f.crop, copy);
      pictures.push({
        caption: `${f.title} (${designOf(f)})`,
        src: data.fromData(copy),
      });
    }
  }
  return pictures;
});

/** `pnpm evals triage <name>`: the findings grouped, checked and drafted, and the deck. */
export const triage = Effect.fn("triage")(function* (options: TriageOptions) {
  const { checkout, data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const run: Run = {
    checkout,
    models: yield* Models,
    options,
    out: path.join(triageDir(data.root), options.name),
  };
  const lastFile = path.join(triageDir(data.root), "last.json");
  const since =
    options.all || !(yield* fs.exists(lastFile))
      ? undefined
      : (yield* readJson(Last, lastFile)).at;
  const { findings, unreadable } = yield* readLogs(since);
  yield* Console.log(
    `triage ${options.name}: ${findings.length} findings${since ? ` since ${since}` : ""}${unreadable > 0 ? `, ${unreadable} lines unreadable` : ""}`
  );
  if (findings.length === 0) {
    return yield* Console.log(
      "Nothing to triage: keep findings on (Settings › Preferences) and design with reviews on."
    );
  }
  yield* writeJson(path.join(run.out, "findings.json"), findings);

  const groups = yield* groupAll(run, findings);
  const recurring = groups.filter((g) =>
    recurs(evidenceOf(g.findings), options)
  );
  yield* Console.log(
    `${groups.length} problems, ${recurring.length} recurring (${options.minDesigns}+ designs or ${options.minModels}+ models)`
  );
  const checked = yield* Effect.forEach(
    recurring,
    (group) => checkGroup(run, group),
    { concurrency: options.concurrency }
  );
  const known = new Set((yield* loadGaps()).map((g) => g.id));
  const { drafts, dropped } = draftsOf(checked, known);
  yield* writeJson(path.join(run.out, "drafts.json"), drafts);

  const cards: Card[] = [];
  for (const draft of drafts) {
    cards.push(cardOf(draft, yield* picturesOf(run.out, draft)));
  }
  const deck: Deck = {
    cards,
    intro: `What review models found in ${findings.length} findings, grouped into recurring problems and checked by ${options.models.join(" and ")}. Keep a draft to add it to evals/gaps/ (then \`pnpm evals triage ${options.name} --apply\`), or drop it.${dropped.length > 0 ? `\n\nNot drafted:\n${dropped.join("\n")}` : ""}`,
    title: `Triage ${options.name}: ${drafts.length} gaps to keep or drop`,
  };
  yield* writeJson(
    path.join(data.root, "decisions", `triage-${options.name}.json`),
    deck
  );
  yield* Console.log(
    `${drafts.length} drafts. Decide: pnpm evals decide triage-${options.name}`
  );
});

const Answers = Schema.Record(
  Schema.String,
  Schema.Struct({
    choice: Schema.optional(Schema.String),
    comment: Schema.optional(Schema.String),
    label: Schema.String,
  })
);
type Answer = (typeof Answers.Type)[string];

/** The crops a new gap's findings were seen in, beside the gap's other pictures. */
const copyCrops = Effect.fnUntraced(function* (id: string, draft: Draft) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  for (const [n, f] of draft.findings.entries()) {
    if (f.crop && (yield* fs.exists(f.crop))) {
      const to = path.join(
        data.root,
        "gaps",
        id,
        `finding-${n + 1}${path.extname(f.crop)}`
      );
      yield* fs.makeDirectory(path.dirname(to), { recursive: true });
      yield* fs.copyFile(f.crop, to);
    }
  }
});

/** A kept draft written: a line of evidence in the gap it names, or a new gap's file. */
const applyDraft = Effect.fnUntraced(function* (options: {
  readonly answer: Answer;
  readonly draft: Draft;
  readonly gaps: readonly LoadedGap[];
  readonly name: string;
  readonly next: (kind: Checked["kind"]) => string;
}) {
  const { answer, draft, gaps, name, next } = options;
  const { gaps: gapsDir } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const gap = draft.gap ? gaps.find((g) => g.id === draft.gap) : undefined;
  if (gap) {
    const line = `- \`triage ${name}\`: seen again, ${evidenceLine(draft.evidence, draft.findings.length)}${answer.comment ? `. ${answer.comment}` : ""}`;
    yield* fs.writeFileString(
      gap.file,
      withEvidence(yield* fs.readFileString(gap.file), line)
    );
    return `evidence added to ${gap.id}`;
  }
  if (!draft.check) {
    return "nothing to write";
  }
  const id = next(draft.check.kind);
  const file = path.join(gapsDir, `${id}-${slugOf(draft.check.title)}.md`);
  yield* fs.writeFileString(
    file,
    gapFile({
      check: draft.check,
      evidence: draft.evidence,
      findings: draft.findings,
      found: new Date().toISOString().slice(0, 10),
      id,
      run: name,
    })
  );
  yield* copyCrops(id, draft);
  return path.basename(file);
});

/** `pnpm evals triage <name> --apply`: what the person kept, written into `evals/gaps/`. */
export const applyTriage = Effect.fn("applyTriage")(function* (name: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const out = path.join(triageDir(data.root), name);
  const drafts = yield* readJson(Drafts, path.join(out, "drafts.json"));
  const answersFile = path.join(
    data.root,
    "decisions",
    `triage-${name}.answers.json`
  );
  if (!(yield* fs.exists(answersFile))) {
    return yield* new EvalsError({
      message: `no answers yet: pnpm evals decide triage-${name}`,
    });
  }
  const answers = yield* readJson(Answers, answersFile);
  const gaps = yield* loadGaps();
  const next = nextIds(gaps);
  for (const draft of drafts) {
    const answer = answers[draft.id];
    const done =
      answer?.choice === "keep"
        ? yield* applyDraft({ answer, draft, gaps, name, next })
        : `not kept${answer?.label === OWN_ANSWER ? ` (${answer.comment ?? ""})` : ""}`;
    yield* Console.log(`${draft.id}: ${done}`);
  }
  // The next triage starts after the findings this one read.
  const read = yield* readJson(
    Schema.Array(LoggedFinding),
    path.join(out, "findings.json")
  );
  const last = read
    .map((f) => f.at)
    .sort()
    .at(-1);
  if (last) {
    yield* writeJson(path.join(triageDir(data.root), "last.json"), {
      at: last,
    });
  }
});
