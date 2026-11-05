/**
 * The review loop of a round (ADR 0060, phase 1 of `docs/plans/PLAN-review-loop.md`): reviewers
 * look at what the designer made, and their findings go back into the same thread as the next
 * prompt, for the designer to fix or decline each. Two timings are measured against a round
 * without it:
 *
 * - `end`: when the designer's turn ends, the page is cut into its sections, every reviewer
 *   reviews every section, and the findings go back; again, until the goal says to stop.
 * - `each-section`: the designer builds one section per turn and names it on its last line
 *   (`Section done: <node> <name>`); that node is reviewed until the goal says to stop, before
 *   the designer is asked for the next. After `All sections done`, the whole page is reviewed as
 *   in `end`.
 *
 * After each review, every reviewer of the council is scored 0–100 on its own findings, and the
 * goal decides (`verdictOf` in contracts' `review`): every reviewer reaches its target score, or,
 * with none asked, every reviewer signs off; a cap on rounds, no gain or the budget ends a loop
 * that isn't converging. A reviewer that gives no review has no score, and doesn't hold the loop.
 * A review that finds nothing ends it too: there is nothing left to send.
 *
 * The reviewers review within what the designer was asked (`ReviewRequest`); what only a design
 * system component would fix comes back as a system note, shown to the designer apart and not
 * answered.
 *
 * The loop reaches the designer and the page through `ReviewIO`, so it runs on a scripted thread
 * in the tests. It writes `review.json` beside the run's `run.json`.
 */
import path from "node:path";
import {
  CATEGORIES,
  type EachRound,
  type Goal,
  type LoggedFinding,
  MAX_ROUNDS,
  type ReviewerRound,
  type Round,
  reviewersOfRound,
  type SignOffBy,
  type StopReason,
  type Target,
  targetOf,
  type Verdict,
  verdictOf,
} from "@ultrapaint/contracts/review";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Clock, DateTime, Effect, FileSystem } from "effect";
import { EvalsError } from "./errors.ts";
import { prompt, writeJson } from "./layout.ts";
import {
  type MergedFinding,
  mergeSection,
  type ReviewRequest,
  reviewerRounds,
  reviewSections,
  type SectionReview,
  type SectionToReview,
  type Spent,
  type SystemNote,
  spentOf,
} from "./section-review.ts";
import { slugOf } from "./sections.ts";
import type { DesignThread, Turn } from "./session.ts";

export const REVIEW_MODES = ["end", "each-section"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const REVIEW_FILE = "review.json";

/** How many turns the designer has in `each-section` before its page is reviewed as it stands. */
export const MAX_TURNS = 40;

export interface ReviewOptions {
  /** Reviews (and groupings) at once. */
  readonly concurrency: number;
  /** Who of the council reviews each round while the designer works (contracts' `review`). */
  readonly eachRound: EachRound;
  readonly effort: string;
  /** When to stop reviewing a section, or the page (contracts' `review`). */
  readonly goal: Goal;
  /** The model that cuts the page into sections and groups the reviewers' findings. */
  readonly judgeModel: string;
  /** The designer's turns before the page is reviewed as it stands (`MAX_TURNS`). */
  readonly maxTurns?: number;
  readonly mode: ReviewMode;
  /** The council: the models that review, as `recall --models` takes them. */
  readonly reviewers: readonly string[];
  /** Who must reach the goal at the end: the whole council, or the round's own reviewers. */
  readonly signOff: SignOffBy;
}

/** Where the findings go when the findings log is on (opt-in), and what they are told with. */
export interface FindingsLog {
  /** The JSONL file the findings are appended to. */
  readonly file: string;
  readonly page: string;
  readonly project: string;
  /** The skill's version the reviewers read. */
  readonly skill: string;
}

/** How the loop reaches the designer, the page and the skill. */
export interface ReviewIO<R = never> {
  /** Where each pass's findings are logged; nowhere without it. */
  readonly log?: FindingsLog | undefined;
  /** The page's node, pictured as it is now under `dir`; none when it cannot be drawn. */
  readonly nodeSection: (
    node: string,
    name: string,
    dir: string
  ) => Effect.Effect<SectionToReview | undefined, EvalsError, R>;
  /** The page as it is now cut into its sections, their pictures under `dir`; none on failure. */
  readonly pageSections: (
    dir: string
  ) => Effect.Effect<readonly SectionToReview[], EvalsError, R>;
  /** What the designer was asked, which the reviewers keep to. */
  readonly request?: ReviewRequest | undefined;
  readonly thread: DesignThread;
  /** The skill's tree the reviewers read: the checkout's, as the designer was briefed with it. */
  readonly tree: string;
}

/** The goal as a round's flags give it: each part optional, the reviewers' and floors' as lists. */
export interface GoalFlags {
  readonly budgetUsd?: number | undefined;
  /** `accessibility=80,contrast=…`: the lowest score a category may have. */
  readonly floors?: string | undefined;
  readonly maxRounds?: number | undefined;
  /** `gpt-6.1-sol=none,cursor:grok-4.7-high=80`: a reviewer's own target, or `none` to advise. */
  readonly reviewerGoals?: string | undefined;
  /** The score every reviewer reaches; without it, each signs off. */
  readonly score?: number | undefined;
}

const pairsOf = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const at = p.lastIndexOf("=");
      return at < 0
        ? { key: p, value: "" }
        : { key: p.slice(0, at).trim(), value: p.slice(at + 1).trim() };
    });

const SCORE = /^\d{1,3}$/;

/** The goal of a round's flags; fails on a pair it can't read. */
export const goalFrom = Effect.fnUntraced(function* (flags: GoalFlags) {
  const reviewers: Record<string, number | null> = {};
  for (const { key, value } of pairsOf(flags.reviewerGoals)) {
    if (value === "none") {
      reviewers[key] = null;
    } else if (SCORE.test(value)) {
      reviewers[key] = Number(value);
    } else {
      return yield* new EvalsError({
        message: `--reviewer-goals: "${key}=${value}" is not <model>=<score> or <model>=none`,
      });
    }
  }
  const floors: Record<string, number> = {};
  for (const { key, value } of pairsOf(flags.floors)) {
    if (
      !((CATEGORIES as readonly string[]).includes(key) && SCORE.test(value))
    ) {
      return yield* new EvalsError({
        message: `--floors: "${key}=${value}" is not <category>=<score>, the categories being ${CATEGORIES.join(", ")}`,
      });
    }
    floors[key] = Number(value);
  }
  return {
    ...(flags.budgetUsd !== undefined && { budgetUsd: flags.budgetUsd }),
    ...(Object.keys(floors).length > 0 && { floors }),
    ...(flags.maxRounds !== undefined && { maxRounds: flags.maxRounds }),
    ...(Object.keys(reviewers).length > 0 && { reviewers }),
    ...(flags.score !== undefined && { score: flags.score }),
  } satisfies Goal;
});

/** What a turn's last line says it did, in `each-section`. */
export type Marker =
  | { readonly kind: "section"; readonly name: string; readonly node: string }
  | { readonly kind: "all-done" }
  | { readonly kind: "none" };

/** What the agent said in a turn. */
export const saidIn = (items: readonly ThreadItem[]) =>
  items
    .flatMap((i) => (i.kind === "agent" ? [i.text] : []))
    .join("\n\n")
    .trim();

const LIST_MARK = /^[-*>]\s+/;
const EMPHASIS = /[*`]/g;
/** A line as the agent wrote it, without the markdown around it (a node id keeps its `_`). */
const bare = (line: string) =>
  line.trim().replace(LIST_MARK, "").replaceAll(EMPHASIS, "").trim();

const SECTION_DONE = /^section done:\s*(\S+)\s*(.*)$/gi;
const ALL_DONE = /^all sections done\b/i;
const TRAILING_PUNCTUATION = /[.,;:]+$/;
const LEADING_DASH = /^[-–—:]\s*/;
const FIXED = /^fixed\s*:\s*(.*)$/gi;
const NUMBER = /\d+/g;
const DECLINED = /^declined\s*:?\s*#?(\d+)\s*[:—–-]?\s*(.*)$/gi;

/** The last `Section done: …` or `All sections done` the agent wrote in a turn. */
export const markerOf = (said: string): Marker => {
  for (const line of said.split("\n").map(bare).reverse()) {
    if (ALL_DONE.test(line)) {
      return { kind: "all-done" };
    }
    const [done] = line.matchAll(SECTION_DONE);
    if (done) {
      const node = (done[1] ?? "").replace(TRAILING_PUNCTUATION, "");
      const name = (done[2] ?? "").replace(LEADING_DASH, "").trim();
      return { kind: "section", name: name || node, node };
    }
  }
  return { kind: "none" };
};

/** Which findings the designer says it fixed and declined, by their numbers. */
export const answersOf = (said: string) => {
  const fixed = new Set<number>();
  const declined: { readonly number: number; readonly reason: string }[] = [];
  for (const line of said.split("\n").map(bare)) {
    const [fix] = line.matchAll(FIXED);
    if (fix) {
      for (const [n] of (fix[1] ?? "").matchAll(NUMBER)) {
        fixed.add(Number(n));
      }
      continue;
    }
    const [decline] = line.matchAll(DECLINED);
    if (decline) {
      declined.push({
        number: Number(decline[1]),
        reason: (decline[2] ?? "").trim(),
      });
    }
  }
  return { declined, fixed: [...fixed].sort((a, b) => a - b) };
};

/** The findings as the designer is told them: by section, numbered from 1 across the sections. */
export const findingsText = (merged: readonly MergedFinding[]) => {
  const sections = [...new Set(merged.map((f) => f.section))];
  let n = 0;
  return sections
    .map((section) =>
      [
        `### ${section}`,
        "",
        ...merged
          .filter((f) => f.section === section)
          .map((f) => {
            n += 1;
            return `${n}. **${f.title}** (${f.where}; ${f.category}, ${f.severity}): ${f.problem} Fix: ${f.fix}`;
          }),
      ].join("\n")
    )
    .join("\n\n");
};

/** A reviewer's result in a round, with the sections it couldn't score. */
export type ScoredReviewer = ReviewerRound & {
  readonly unscored: readonly string[];
};

/** What a reviewer is held to, as the designer is told it after its score. */
const aimOf = (target: Target, signedOff: boolean) => {
  if (target.kind === "score") {
    return ` (goal ${target.score})`;
  }
  if (target.kind === "advisory") {
    return " (advisory)";
  }
  return signedOff ? ", signed off" : ", not signed off yet";
};

/** What the designer did with the finding numbered `n`, as the findings log keeps it. */
const didWith = (
  answered: ReturnType<typeof answersOf> | undefined,
  n: number
): LoggedFinding["designer"] => {
  if (answered?.fixed.includes(n)) {
    return { did: "fixed" };
  }
  const declined = answered?.declined.find((d) => d.number === n);
  return declined
    ? { did: "declined", reason: declined.reason }
    : { did: "unanswered" };
};

/** Where each reviewer stands, as the designer is told it: its score, its target, what's left. */
export const scoresText = (
  goal: Goal,
  scores: Readonly<Record<string, ScoredReviewer>>,
  reviews: readonly SectionReview[]
) =>
  Object.entries(scores)
    .map(([reviewer, r]) => {
      if (r.score.kind === "none") {
        return `- ${reviewer}: no score (${r.score.reason})`;
      }
      const aim = aimOf(targetOf(goal, reviewer), r.signedOff);
      const left = reviews
        .filter(
          (v) => v.reviewer === reviewer && !v.signOff.done && v.signOff.left
        )
        .map((v) => `${v.section}: ${v.signOff.left}`);
      return `- ${reviewer}: ${r.score.overall}${aim}${left.length > 0 ? `. Left: ${left.join(" ")}` : ""}`;
    })
    .join("\n");

/** Why a loop stopped after its last pass, and which pass to keep. */
const stoppedOf = (verdict: Verdict, number: number) =>
  verdict.stop
    ? { best: verdict.best + 1, reason: verdict.reason, unmet: verdict.unmet }
    : { best: number, reason: "nothing-found" as const, unmet: verdict.unmet };

/** A pass in one line for the log: what it found and where each reviewer stands. */
const passLine = (
  pass: { readonly kind: "page" | "section"; readonly node?: string },
  number: number,
  merged: readonly MergedFinding[],
  reviews: readonly SectionReview[],
  notes: readonly unknown[],
  scores: Readonly<Record<string, ScoredReviewer>>
) =>
  `review ${pass.kind === "page" ? "of the page" : `of ${pass.node}`}, pass ${number}: ${merged.length} problems from ${reviews.reduce((n, r) => n + r.findings.length, 0)} findings, ${notes.length} system notes; ${Object.entries(
    scores
  )
    .map(
      ([m, r]) =>
        `${m} ${r.score.kind === "scored" ? r.score.overall : "no score"}${r.signedOff ? " ✓" : ""}`
    )
    .join(", ")}`;

/** A system note, with the section and the reviewer it came from. */
export interface PlacedNote extends SystemNote {
  readonly reviewer: string;
  readonly section: string;
}

/** The system notes of some reviews, each once per section and component. */
export const notesOf = (
  reviews: readonly SectionReview[]
): readonly PlacedNote[] => {
  const seen = new Set<string>();
  return reviews.flatMap((r) =>
    r.systemNotes.flatMap((n) => {
      const key = `${r.section}\n${n.component.toLowerCase()}\n${n.note}`;
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [{ ...n, reviewer: r.reviewer, section: r.section }];
    })
  );
};

/** The system notes as the designer is told them, after the findings: to read, not to answer. */
export const notesText = (notes: readonly PlacedNote[]) =>
  notes.length === 0
    ? ""
    : [
        "",
        "They also noted these for the design system's components. They are not yours to fix or answer, and they are not numbered:",
        "",
        ...notes.map((n) => `- ${n.section}, **${n.component}**: ${n.note}`),
        "",
      ].join("\n");

/** A turn's size: what the designer spent on it. */
export interface TurnSize {
  readonly seconds: number;
  readonly tokens: number;
  readonly toolCalls: number;
}

export const sizeOf = (turn: Turn): TurnSize => ({
  seconds: Math.round(turn.seconds),
  tokens: turn.items.reduce(
    (n, i) => n + (i.kind === "turn_end" ? (i.usage?.totalTokens ?? 0) : 0),
    0
  ),
  toolCalls: turn.items.filter((i) => i.kind === "tool").length,
});

/** One review of a section, or of the page, and the designer's answer to it. */
export interface ReviewPass {
  /** What the designer did with each finding, by its number in the prompt. */
  readonly answered?: ReturnType<typeof answersOf>;
  /** `section`: the node the designer named; `page`: the whole page. */
  readonly kind: "page" | "section";
  readonly merged: readonly MergedFinding[];
  readonly node?: string;
  readonly pass: number;
  /** What the designer said back; absent when nothing was found and nothing sent. */
  readonly reply?: string;
  /** Who of the council reviewed this pass. */
  readonly reviewers: readonly string[];
  readonly reviews: readonly SectionReview[];
  /** Each reviewer's score of what it reviewed, and whether it signed off. */
  readonly scores: Readonly<Record<string, ScoredReviewer>>;
  readonly sections: readonly {
    readonly name: string;
    /** From the run's directory. */
    readonly picture: string;
  }[];
  /** Whether this was the whole council signing off, after a round's own reviewers were satisfied. */
  readonly signOff?: boolean;
  readonly spent: Spent;
  /** Why the loop stopped after this pass, on its last pass. */
  readonly stopped?: {
    /** The pass to keep, by its number: the best one, not always the last. */
    readonly best: number;
    readonly reason: StopReason | "nothing-found";
    /** Who was still short of the goal. */
    readonly unmet: readonly string[];
  };
  /** What only a design-system component would fix: shown to the designer, not answered. */
  readonly systemNotes: readonly PlacedNote[];
  readonly turn?: TurnSize;
}

/** Turns of one kind, added up. */
export interface TurnsTotal {
  readonly seconds: number;
  readonly tokens: number;
  readonly turns: number;
}

export interface ReviewRecord {
  readonly options: Omit<ReviewOptions, "concurrency">;
  readonly passes: readonly ReviewPass[];
  /** Why the loop stopped before it was done, when it did. */
  readonly problems: readonly string[];
  readonly totals: {
    /** The designer's turns that answered findings. */
    readonly answers: TurnsTotal;
    /** The designer's own turns: building, and going on to the next section. */
    readonly design: TurnsTotal;
    /** The reviewers, the sections cut out and the groupings. */
    readonly review: Spent;
    /** Everything: the designer's turns and the review work. */
    readonly withReview: { readonly seconds: number; readonly tokens: number };
    /** The designer's own turns alone, as a round without reviews would spend. */
    readonly withoutReview: {
      readonly seconds: number;
      readonly tokens: number;
    };
  };
}

const totalOf = (turns: readonly Turn[]): TurnsTotal => {
  const sizes = turns.map(sizeOf);
  return {
    seconds: sizes.reduce((n, s) => n + s.seconds, 0),
    tokens: sizes.reduce((n, s) => n + s.tokens, 0),
    turns: turns.length,
  };
};

/**
 * Runs the loop after the designer's first turn, and writes `review.json` in `dir`. Returns every
 * turn of the thread in order, the first one included.
 */
export const reviewLoop = Effect.fn("reviewLoop")(function* <R>(
  first: Turn,
  io: ReviewIO<R>,
  options: ReviewOptions,
  /** The run's directory: the pictures go under `review/`. */
  dir: string
) {
  const turns: Turn[] = [first];
  const designTurns: Turn[] = [first];
  const answerTurns: Turn[] = [];
  const passes: ReviewPass[] = [];
  const problems: string[] = [];
  const settings = { ...options, request: io.request, tree: io.tree };
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const fromRun = (file: string) => path.relative(dir, file);

  /** Appends a pass's findings to the findings log, with what the designer did with each. */
  const logPass = (
    pass: ReviewPass,
    answered: ReturnType<typeof answersOf> | undefined
  ) =>
    Effect.gen(function* () {
      const { log } = io;
      if (log === undefined || pass.merged.length === 0) {
        return;
      }
      const fs = yield* FileSystem.FileSystem;
      const at = DateTime.formatIso(yield* DateTime.now);
      const pictures = new Map(pass.sections.map((s) => [s.name, s.picture]));
      const lines = pass.merged.map((f, i) => {
        const [reviewer = "", ...agreedBy] = f.reviewers;
        const picture = pictures.get(f.section);
        const entry: LoggedFinding = {
          agreedBy,
          at,
          category: f.category,
          ...(picture !== undefined && { crop: path.join(dir, picture) }),
          designer: didWith(answered, i + 1),
          fix: f.fix,
          page: log.page,
          problem: f.problem,
          project: log.project,
          reviewer,
          round: pass.pass,
          rule: f.rule,
          section: f.section,
          severity: f.severity,
          skill: log.skill,
          title: f.title,
          where: f.where,
        };
        return JSON.stringify(entry);
      });
      yield* fs.makeDirectory(path.dirname(log.file), { recursive: true });
      yield* fs.writeFileString(log.file, `${lines.join("\n")}\n`, {
        flag: "a",
      });
    }).pipe(
      // The log is for triage later: a write that fails costs the run nothing.
      Effect.catch((error) =>
        Effect.logWarning(`findings log not written: ${String(error)}`)
      )
    );

  /**
   * Whether a round's own reviewers are satisfied (the goal met, or nothing left to find) while the
   * whole council is to sign off and hasn't yet.
   */
  const handsToCouncil = (
    verdict: Verdict,
    found: number,
    closing: boolean,
    who: readonly string[]
  ) => {
    const satisfied = verdict.stop
      ? verdict.reason === "goal" || verdict.reason === "signed-off"
      : found === 0;
    return (
      satisfied &&
      !closing &&
      options.signOff === "all" &&
      who.length < options.reviewers.length
    );
  };

  /**
   * Reviews these sections by `who` and scores each reviewer; then, unless the goal says to stop,
   * sends what was found. Records the pass. `go-on` when the designer answered; `satisfied` when
   * part of the council is and the whole council is to sign off; `ended` otherwise.
   */
  const reviewPass = (
    sections: readonly SectionToReview[],
    pass: { readonly kind: "page" | "section"; readonly node?: string },
    rounds: Round[],
    what: string,
    who: readonly string[],
    closing: boolean
  ) =>
    Effect.gen(function* () {
      const number = rounds.length + 1;
      const started = yield* Clock.currentTimeMillis;
      const reviewed = yield* reviewSections(sections, who, settings).pipe(
        Effect.flatMap((found) =>
          Effect.map(
            Effect.forEach(
              sections,
              (section) => mergeSection(section, found, settings),
              { concurrency: options.concurrency }
            ),
            (grouped) => ({ merges: grouped, reviews: found })
          )
        ),
        // Grouping that fails ends the loop, not the run: the design is kept as it stands.
        Effect.catchTag("EvalsError", (error) =>
          Effect.sync(() => {
            problems.push(`reviewing pass ${number}: ${error.message}`);
          })
        )
      );
      if (reviewed === undefined) {
        return "ended" as const;
      }
      const { merges, reviews } = reviewed;
      const merged = merges.flatMap((m) => m.merged);
      const systemNotes = notesOf(reviews);
      const spent: Spent = {
        ...spentOf([...reviews, ...merges.map((m) => m.spent)]),
        seconds: ((yield* Clock.currentTimeMillis) - started) / 1000,
      };
      const scores = reviewerRounds(who, reviews);
      rounds.push({ costUsd: spent.costUsd, reviewers: scores });
      const verdict = verdictOf(options.goal, rounds);
      const base = {
        kind: pass.kind,
        merged,
        ...(pass.node !== undefined && { node: pass.node }),
        pass: number,
        reviewers: who,
        reviews,
        scores,
        ...(closing && { signOff: true }),
        sections: sections.map((s) => ({
          name: s.name,
          picture: fromRun(s.picture),
        })),
        spent,
        systemNotes,
      };
      yield* Effect.log(
        passLine(pass, number, merged, reviews, systemNotes, scores)
      );
      if (handsToCouncil(verdict, merged.length, closing, who)) {
        // The round's own reviewers are satisfied: the whole council signs off before it ends.
        passes.push(base);
        yield* logPass(base, undefined);
        return "satisfied" as const;
      }
      if (verdict.stop || merged.length === 0) {
        const last: ReviewPass = {
          ...base,
          stopped: stoppedOf(verdict, number),
        };
        passes.push(last);
        yield* logPass(last, undefined);
        return "ended" as const;
      }
      const turn = yield* io.thread.send(
        yield* prompt("review-findings", {
          findings: findingsText(merged),
          notes: notesText(systemNotes),
          scores: scoresText(options.goal, scores, reviews),
          what,
        })
      );
      turns.push(turn);
      answerTurns.push(turn);
      const reply = saidIn(turn.items);
      const answered = answersOf(reply);
      const done: ReviewPass = {
        ...base,
        answered,
        reply,
        turn: sizeOf(turn),
      };
      passes.push(done);
      yield* logPass(done, answered);
      if (turn.problem) {
        problems.push(`answering pass ${number}: ${turn.problem}`);
        return "ended" as const;
      }
      return "go-on" as const;
    });

  /** The rounds a loop may run before the goal's cap stops it, as a guard on the loop itself. */
  const cap = options.goal.maxRounds ?? MAX_ROUNDS;

  /** The whole page, reviewed until the goal says to stop. */
  const pagePasses = Effect.gen(function* () {
    const rounds: Round[] = [];
    let index = 0;
    while (rounds.length < cap) {
      const sections = yield* io.pageSections(
        path.join(dir, "review", `page-${rounds.length + 1}`)
      );
      if (sections.length === 0) {
        problems.push(
          `pass ${rounds.length + 1}: the page has no sections to review`
        );
        return;
      }
      const who = reviewersOfRound(options.reviewers, options.eachRound, index);
      index += 1;
      const what = "the sections of your page";
      const outcome = yield* reviewPass(
        sections,
        { kind: "page" },
        rounds,
        what,
        who,
        false
      );
      // Satisfied, the round's reviewers hand the same page, unchanged, to the whole council.
      const closed =
        outcome === "satisfied"
          ? yield* reviewPass(
              sections,
              { kind: "page" },
              rounds,
              what,
              options.reviewers,
              true
            )
          : outcome;
      if (closed !== "go-on") {
        return;
      }
    }
  });

  /** The section the designer just built, reviewed until the goal says to stop. */
  const sectionPasses = (
    marker: { readonly name: string; readonly node: string },
    built: number
  ) =>
    Effect.gen(function* () {
      const rounds: Round[] = [];
      while (rounds.length < cap) {
        const section = yield* io.nodeSection(
          marker.node,
          marker.name,
          path.join(
            dir,
            "review",
            `section-${built}-${slugOf(marker.name) || "node"}`,
            `pass-${rounds.length + 1}`
          )
        );
        if (section === undefined) {
          problems.push(
            `section ${built} (${marker.node} ${marker.name}): its node could not be drawn`
          );
          return;
        }
        // A section is signed off by the page's review at the end, not on its own.
        const outcome = yield* reviewPass(
          [section],
          { kind: "section", node: marker.node },
          rounds,
          `the section you just built, ${marker.name}`,
          reviewersOfRound(options.reviewers, options.eachRound, rounds.length),
          true
        );
        if (outcome !== "go-on" || turns.length >= maxTurns) {
          return;
        }
      }
    });

  const sectionLoop = Effect.gen(function* () {
    let last = first;
    let built = 0;
    while (!last.problem) {
      const marker = markerOf(saidIn(last.items));
      if (marker.kind === "all-done") {
        return;
      }
      if (turns.length >= maxTurns) {
        problems.push(
          `${maxTurns} turns and the page is not done: reviewed as it stands`
        );
        return;
      }
      if (marker.kind === "section") {
        built += 1;
        yield* sectionPasses(marker, built);
        if (turns.at(-1)?.problem) {
          return;
        }
      }
      last = yield* io.thread.send(yield* prompt("review-next-section", {}));
      turns.push(last);
      designTurns.push(last);
    }
    if (last !== first) {
      problems.push(`building: ${last.problem}`);
    }
  });

  if (first.problem) {
    problems.push(`designing: ${first.problem}`);
  } else if (options.mode === "end") {
    yield* pagePasses;
  } else {
    yield* sectionLoop;
    if (!turns.at(-1)?.problem) {
      yield* pagePasses;
    }
  }

  const design = totalOf(designTurns);
  const answers = totalOf(answerTurns);
  const review = spentOf(passes.map((p) => p.spent));
  const { concurrency: _, ...recorded } = options;
  const record: ReviewRecord = {
    options: recorded,
    passes,
    problems,
    totals: {
      answers,
      design,
      review,
      withoutReview: { seconds: design.seconds, tokens: design.tokens },
      withReview: {
        seconds: Math.round(design.seconds + answers.seconds + review.seconds),
        tokens: design.tokens + answers.tokens + review.tokens,
      },
    },
  };
  yield* writeJson(path.join(dir, REVIEW_FILE), record);
  yield* Effect.log(
    `review loop: ${turns.length} turns, ${passes.length} passes, ${passes.reduce((n, p) => n + p.merged.length, 0)} problems sent${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`
  );
  return { record, turns };
});
