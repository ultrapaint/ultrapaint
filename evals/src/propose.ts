/**
 * `propose`: what a designer with the skill would do with each problem of a round's rating deck,
 * so the person says only whether that call is right, not whether each problem is real. Each
 * section's problems go to one model with the section's pictures, its code and the checkout's
 * skill to open, and it answers per problem: fix it (the change and the rule) or leave it (why).
 *
 * The calls are kept in `runs/<round>/<section>/proposals@<model>.json`, so a second call asks
 * nobody, and the deck `rate-<round>` is written again with each card's call: its `proposal`, and
 * `recommend` set to `real` for a fix and `noise` for a leave. The answers stay what they were,
 * real or noise, so recall and verify read them as before; a card's call is not its question, so
 * the answers given before it had one stay too.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { type Card, Deck, writeDeck } from "./decide.ts";
import { EvalsError } from "./errors.ts";
import { listDir, prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";
import {
  Judgement,
  Review,
  rateDeckName,
  ratingId,
  Saved,
  Section,
  settleJudgements,
  Unmatched,
  writeSkillTree,
} from "./recall.ts";

export const CALLS = ["fix", "leave"] as const;

export const Calls = Schema.Struct({
  calls: Schema.Array(
    Schema.Struct({
      call: Schema.Literals(CALLS),
      /** The problem's number in the list it was given, from 1. */
      n: Schema.Number,
      rule: Schema.String,
      what: Schema.String,
    })
  ),
});
export type Calls = typeof Calls.Type;

const callsAnswer = {
  decode: Calls,
  schema: {
    additionalProperties: false,
    properties: {
      calls: {
        items: {
          additionalProperties: false,
          properties: {
            call: { enum: [...CALLS], type: "string" },
            n: { type: "integer" },
            rule: { type: "string" },
            what: { type: "string" },
          },
          required: ["n", "call", "what", "rule"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["calls"],
    type: "object",
  },
};

/** What the deck's intro adds once its cards have calls. */
const CALLS_INTRO =
  "Each card shows what I would do with the problem by the skill: fix it, and how, or leave it. Say whether that call is right: Right keeps it, Wrong takes the other one. A comment goes with either.";

/** A call as the card shows it, in the deck's markdown. */
export const proposalText = (call: Calls["calls"][number]) =>
  [
    `**${call.call === "fix" ? "I'd fix it." : "I'd leave it."}** ${call.what.trim()}`,
    call.rule.trim()
      ? `The skill: ${call.rule.trim()}`
      : "No rule of the skill settles it.",
  ].join("\n\n");

/** The deck with each card that has a call showing it, and the option it stands for. */
export const withCalls = (
  deck: Deck,
  calls: ReadonlyMap<string, Calls["calls"][number]>
): Deck => ({
  ...deck,
  cards: deck.cards.map((card): Card => {
    const call = calls.get(card.id);
    return call === undefined
      ? card
      : {
          ...card,
          proposal: proposalText(call),
          recommend: call.call === "fix" ? "real" : "noise",
        };
  }),
  intro: deck.intro?.includes(CALLS_INTRO)
    ? deck.intro
    : `${deck.intro ?? ""}\n\n${CALLS_INTRO}`.trim(),
});

const fileSafe = (model: string) => model.replaceAll(/[^\w.-]/g, "-");

/** A problem as a call is asked of it: its title and what is wrong. */
interface Problem {
  readonly problem: string;
  readonly title: string;
}

/** The calls on one section's problems, kept in `file`: asked once, read after. */
const callsOn = Effect.fn("callsOn")(function* (input: {
  readonly effort: string;
  readonly file: string;
  readonly model: string;
  readonly problems: readonly Problem[];
  readonly section: string;
  readonly skill: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  if (yield* fs.exists(input.file)) {
    return yield* readJson(Calls, input.file);
  }
  const section = yield* readJson(
    Section,
    path.join(data.sections, input.section, "section.json")
  );
  const asked = yield* models.ask({
    cwd: path.join(data.sections, input.section),
    dirs: [input.skill],
    effort: input.effort,
    images: section.pictures.map((p) => p.file),
    model: input.model,
    prompt: yield* prompt("propose-calls", {
      code: section.code.map((f) => `- \`${f}\``).join("\n"),
      name: section.name,
      pictures: section.pictures
        .map((p) => `- \`${p.file}\`: ${p.shows}`)
        .join("\n"),
      problems: input.problems
        .map((p, i) => `${i + 1}. **${p.title}**: ${p.problem}`)
        .join("\n"),
      skill: input.skill,
      where: section.where,
    }),
    ...callsAnswer,
  });
  yield* writeJson(input.file, asked.value);
  yield* Effect.log(
    `${input.section}: ${asked.value.calls.filter((c) => c.call === "fix").length} of ${input.problems.length} to fix`
  );
  return asked.value;
});

export const propose = Effect.fn("propose")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly round: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const out = path.join(data.runs, options.round);
  const deckName = rateDeckName(options.round);
  const deckFile = path.join(data.root, "decisions", `${deckName}.json`);
  if (!(yield* fs.exists(deckFile))) {
    return yield* new EvalsError({
      message: `${options.round} has no rating deck: run its recall with --rate first`,
    });
  }
  const deck = yield* readJson(Deck, deckFile);
  const inDeck = new Set(deck.cards.map((c) => c.id));
  const skill = yield* writeSkillTree(
    path.join(out, "propose-skill"),
    "built-in"
  );

  const sections: {
    readonly id: string;
    readonly problems: (typeof Unmatched.Type)["problems"];
  }[] = [];
  for (const id of yield* listDir(out)) {
    const file = path.join(out, id, "unmatched.json");
    // The round's own files sit beside its sections.
    if (
      !(
        (yield* fs.exists(path.join(data.sections, id, "section.json"))) &&
        (yield* fs.exists(file))
      )
    ) {
      continue;
    }
    const problems = (yield* readJson(
      Saved(Unmatched),
      file
    )).value.problems.filter((p) => inDeck.has(ratingId(id, p.title)));
    if (problems.length > 0) {
      sections.push({ id, problems });
    }
  }

  const found = yield* Effect.forEach(
    sections,
    ({ id, problems }) =>
      callsOn({
        ...options,
        file: path.join(out, id, `proposals@${fileSafe(options.model)}.json`),
        problems,
        section: id,
        skill,
      }).pipe(
        Effect.map((answer) =>
          problems.flatMap((p, i) => {
            const call = answer.calls.find((c) => c.n === i + 1);
            return call === undefined
              ? []
              : [[ratingId(id, p.title), call] as const];
          })
        ),
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(Effect.logWarning(`${id}: no calls: ${error.message}`), [])
        )
      ),
    { concurrency: options.concurrency }
  );
  const calls = new Map(found.flat());
  yield* writeDeck(deckName, withCalls(deck, calls));
  yield* Effect.log(
    `${calls.size} of ${deck.cards.length} cards have a call: pnpm evals decide ${deckName}`
  );
});

/** How many of a gap's findings a call is asked on: one per version of a round is plenty. */
const PER_GAP = 4;

/** A finding the judges matched with a gap, as a call is asked of it. */
interface GapFinding extends Problem {
  readonly gap: string;
}

/** The report: per gap, how many of its findings the calls would fix. */
export const gapCallsReport = (
  round: string,
  model: string,
  rows: readonly { readonly calls: readonly string[]; readonly gap: string }[]
) => {
  const fixes = (calls: readonly string[]) =>
    calls.filter((c) => c === "fix").length;
  const all = rows.flatMap((r) => r.calls);
  const fixedGaps = rows.filter((r) => fixes(r.calls) > 0).length;
  return [
    `# Calls on the gaps' findings: ${round}`,
    "",
    `${model} with the skill made the call, fix or leave, on findings the judges matched with a gap: problems the person found. A leave is a real problem the designer would let through. A gap is kept when the call fixes at least one of its findings.`,
    "",
    `Findings fixed: ${fixes(all)}/${all.length}. Gaps kept: ${fixedGaps}/${rows.length}.`,
    "",
    "| Gap | Findings fixed |",
    "| --- | --- |",
    ...rows.map((r) => `| ${r.gap} | ${fixes(r.calls)}/${r.calls.length} |`),
    "",
  ].join("\n");
};

/** One review's findings the judges matched with a gap, with the gap. */
const gapFindingsOfRun = Effect.fnUntraced(function* (dir: string) {
  const review = (yield* readJson(Saved(Review), path.join(dir, "review.json")))
    .value;
  const judgements: Judgement[] = [];
  for (const name of yield* listDir(dir)) {
    if (name.startsWith("judgement")) {
      judgements.push(
        (yield* readJson(Saved(Judgement), path.join(dir, name))).value
      );
    }
  }
  return (settleJudgements(judgements)?.gaps ?? [])
    .filter((gap) => gap.verdict !== "missed")
    .flatMap((gap) =>
      gap.findings.flatMap((n): GapFinding[] => {
        const f = review.findings[n - 1];
        return f === undefined
          ? []
          : [
              {
                gap: gap.id,
                problem: `${f.where}: ${f.problem}`,
                title: f.title,
              },
            ];
      })
    );
});

/** A section's findings matched with a gap across its reviews, `PER_GAP` at most a gap. */
const gapFindingsOf = Effect.fnUntraced(function* (sectionDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const runs: GapFinding[][] = [];
  for (const version of yield* listDir(sectionDir)) {
    const at = path.join(sectionDir, version);
    if ((yield* fs.stat(at)).type !== "Directory") {
      continue;
    }
    for (const run of yield* listDir(at)) {
      if (yield* fs.exists(path.join(at, run, "review.json"))) {
        runs.push(yield* gapFindingsOfRun(path.join(at, run)));
      }
    }
  }
  // A run at a time, so a gap's findings come from several versions, not the first one listed.
  const longest = Math.max(0, ...runs.map((r) => r.length));
  const all = Array.from({ length: longest }, (_, i) =>
    runs.flatMap((r) => r[i] ?? [])
  ).flat();
  const taken = new Map<string, number>();
  return all.filter((f) => {
    const n = taken.get(f.gap) ?? 0;
    taken.set(f.gap, n + 1);
    return n < PER_GAP;
  });
});

/**
 * The calls on the findings a round's judges matched with a gap: what the call step would let
 * through of what the person found. Kept in `runs/<round>/<section>/proposals-gaps@<model>.json`;
 * the report is `runs/<round>/propose-gaps.md`.
 */
export const proposeOnGaps = Effect.fn("proposeOnGaps")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly round: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const out = path.join(data.runs, options.round);
  const skill = yield* writeSkillTree(
    path.join(out, "propose-skill"),
    "built-in"
  );
  const sections: {
    readonly findings: readonly GapFinding[];
    readonly id: string;
  }[] = [];
  for (const id of yield* listDir(out)) {
    if (yield* fs.exists(path.join(data.sections, id, "section.json"))) {
      const findings = yield* gapFindingsOf(path.join(out, id));
      if (findings.length > 0) {
        sections.push({ findings, id });
      }
    }
  }

  const found = yield* Effect.forEach(
    sections,
    ({ findings, id }) =>
      callsOn({
        ...options,
        file: path.join(
          out,
          id,
          `proposals-gaps@${fileSafe(options.model)}.json`
        ),
        problems: findings,
        section: id,
        skill,
      }).pipe(
        Effect.map((answer) =>
          findings.flatMap((f, i) => {
            const call = answer.calls.find((c) => c.n === i + 1);
            return call === undefined ? [] : [{ call: call.call, gap: f.gap }];
          })
        ),
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(Effect.logWarning(`${id}: no calls: ${error.message}`), [])
        )
      ),
    { concurrency: options.concurrency }
  );
  const byGap = new Map<string, string[]>();
  for (const { call, gap } of found.flat()) {
    byGap.set(gap, [...(byGap.get(gap) ?? []), call]);
  }
  const report = path.join(out, "propose-gaps.md");
  yield* writeText(
    report,
    gapCallsReport(
      options.round,
      options.model,
      [...byGap]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([gap, calls]) => ({ calls, gap }))
    )
  );
  yield* Effect.log(`report: ${data.fromData(report)}`);
});
