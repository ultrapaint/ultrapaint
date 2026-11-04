/**
 * The review loop of a round (ADR 0060, phase 1 of `docs/plans/PLAN-review-loop.md`): reviewers
 * look at what the designer made, and their findings go back into the same thread as the next
 * prompt, for the designer to fix or decline each. Two timings are measured against a round
 * without it:
 *
 * - `end`: when the designer's turn ends, the page is cut into its sections, every reviewer
 *   reviews every section, and the findings go back; again, up to the passes, until a pass finds
 *   nothing.
 * - `each-section`: the designer builds one section per turn and names it on its last line
 *   (`Section done: <node> <name>`); that node is reviewed, up to the passes, before the designer
 *   is asked for the next. After `All sections done`, the whole page is reviewed once as in `end`.
 *
 * The reviewers review within what the designer was asked (`ReviewRequest`); what only a design
 * system component would fix comes back as a system note, shown to the designer apart and not
 * answered.
 *
 * The loop reaches the designer and the page through `ReviewIO`, so it runs on a scripted thread
 * in the tests. It writes `review.json` beside the run's `run.json`.
 */
import path from "node:path";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Clock, Effect } from "effect";
import type { EvalsError } from "./errors.ts";
import { prompt, writeJson } from "./layout.ts";
import {
  type MergedFinding,
  mergeSection,
  type ReviewRequest,
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
  readonly effort: string;
  /** The model that cuts the page into sections and groups the reviewers' findings. */
  readonly judgeModel: string;
  /** The designer's turns before the page is reviewed as it stands (`MAX_TURNS`). */
  readonly maxTurns?: number;
  readonly mode: ReviewMode;
  /** Reviews of one section (or of the page) at most, each followed by the designer's answer. */
  readonly passes: number;
  /** The models that review, as `recall --models` takes them. */
  readonly reviewers: readonly string[];
}

/** How the loop reaches the designer, the page and the skill. */
export interface ReviewIO<R = never> {
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
            return `${n}. **${f.title}** (${f.where}): ${f.problem} Fix: ${f.fix}`;
          }),
      ].join("\n")
    )
    .join("\n\n");
};

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
  readonly reviews: readonly SectionReview[];
  readonly sections: readonly {
    readonly name: string;
    /** From the run's directory. */
    readonly picture: string;
  }[];
  readonly spent: Spent;
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

  /** Reviews these sections, sends what was found, and records the pass; false when it ended. */
  const reviewPass = (
    sections: readonly SectionToReview[],
    pass: { readonly kind: "page" | "section"; readonly node?: string },
    number: number,
    what: string
  ) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      const reviewed = yield* reviewSections(
        sections,
        options.reviewers,
        settings
      ).pipe(
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
        // A reviewer that fails ends the loop, not the run: the design is kept as it stands.
        Effect.catchTag("EvalsError", (error) =>
          Effect.sync(() => {
            problems.push(`reviewing pass ${number}: ${error.message}`);
          })
        )
      );
      if (reviewed === undefined) {
        return false;
      }
      const { merges, reviews } = reviewed;
      const merged = merges.flatMap((m) => m.merged);
      const systemNotes = notesOf(reviews);
      const spent: Spent = {
        ...spentOf([...reviews, ...merges.map((m) => m.spent)]),
        seconds: ((yield* Clock.currentTimeMillis) - started) / 1000,
      };
      const base = {
        kind: pass.kind,
        merged,
        ...(pass.node !== undefined && { node: pass.node }),
        pass: number,
        reviews,
        sections: sections.map((s) => ({
          name: s.name,
          picture: fromRun(s.picture),
        })),
        spent,
        systemNotes,
      };
      yield* Effect.log(
        `review ${pass.kind === "page" ? "of the page" : `of ${pass.node}`}, pass ${number}: ${merged.length} problems from ${reviews.reduce((n, r) => n + r.findings.length, 0)} findings, ${systemNotes.length} system notes`
      );
      if (merged.length === 0) {
        passes.push(base);
        return false;
      }
      const turn = yield* io.thread.send(
        yield* prompt("review-findings", {
          findings: findingsText(merged),
          notes: notesText(systemNotes),
          what,
        })
      );
      turns.push(turn);
      answerTurns.push(turn);
      const reply = saidIn(turn.items);
      passes.push({
        ...base,
        answered: answersOf(reply),
        reply,
        turn: sizeOf(turn),
      });
      if (turn.problem) {
        problems.push(`answering pass ${number}: ${turn.problem}`);
        return false;
      }
      return true;
    });

  /** The whole page, reviewed up to `upTo` passes. */
  const pagePasses = (upTo: number) =>
    Effect.gen(function* () {
      for (let pass = 1; pass <= upTo; pass += 1) {
        const sections = yield* io.pageSections(
          path.join(dir, "review", `page-${pass}`)
        );
        if (sections.length === 0) {
          problems.push(`pass ${pass}: the page has no sections to review`);
          return;
        }
        if (
          !(yield* reviewPass(
            sections,
            { kind: "page" },
            pass,
            "the sections of your page"
          ))
        ) {
          return;
        }
      }
    });

  /** The section the designer just built, reviewed up to the passes. */
  const sectionPasses = (
    marker: { readonly name: string; readonly node: string },
    built: number
  ) =>
    Effect.gen(function* () {
      for (let pass = 1; pass <= options.passes; pass += 1) {
        const section = yield* io.nodeSection(
          marker.node,
          marker.name,
          path.join(
            dir,
            "review",
            `section-${built}-${slugOf(marker.name) || "node"}`,
            `pass-${pass}`
          )
        );
        if (section === undefined) {
          problems.push(
            `section ${built} (${marker.node} ${marker.name}): its node could not be drawn`
          );
          return;
        }
        const goOn = yield* reviewPass(
          [section],
          { kind: "section", node: marker.node },
          pass,
          `the section you just built, ${marker.name}`
        );
        if (!goOn || turns.length >= maxTurns) {
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
    yield* pagePasses(options.passes);
  } else {
    yield* sectionLoop;
    if (!turns.at(-1)?.problem) {
      yield* pagePasses(1);
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
