/**
 * The review loop's rules (ADR 0063), pure: where a design's review run starts in its transcript
 * and which rounds are its, a reviewer's answer read and scored, who stands in for a reviewer that
 * didn't answer, when a round's reviewers hand the page to every review model, why a review
 * ended, and which findings the designer declined. The service (`review-loop.ts`) does the rest.
 */
import {
  type Approval,
  Category,
  Finding,
  formatReviewModel,
  type ReviewerRound,
  type ReviewModel,
  type Round,
  type Score,
  SignOff,
  type StopReason,
  sectionScore,
  pageScore as toPageScore,
  type Verdict,
} from "@ultrapaint/contracts/review";
import type {
  ReviewEnd,
  RoundFinding,
  RoundReviewer,
  ThreadItem,
} from "@ultrapaint/contracts/threads";
import { Effect, Option, Schema } from "effect";

/** One round of a review as the transcript keeps it. */
export type ReviewItem = Extract<ThreadItem, { readonly kind: "review" }>;

/** How long a review model has to answer before the next one in turn takes the round. */
export const REVIEW_TIMEOUT = "5 minutes";

/** What a review model that didn't answer in time is shown with. */
export const TIMED_OUT = "It didn't answer in 5 minutes.";

/** What a review model whose answer wasn't the asked JSON is shown with. */
export const UNREADABLE = "Its answer couldn't be read.";

/** Whether a file the turn changed is a page of the designs. */
export const isPageFile = (file: string) => file.endsWith(".page.json");

/** A review run in the transcript: from the person's last prompt, with the rounds since. */
export interface ReviewRun {
  /**
   * The round the last prompt carried the findings of, while its designer's turn is the last:
   * the round it answers.
   */
  readonly answering: ReviewItem | undefined;
  /** The person's last prompt, the request the reviewers keep to; empty before any. */
  readonly request: string;
  /** The run's rounds, oldest first. */
  readonly rounds: readonly ReviewItem[];
}

/**
 * The run the transcript is in: it starts at the person's last prompt (a user item that carries
 * no findings), and its rounds are the review items after it.
 */
export const runOf = (items: readonly ThreadItem[]): ReviewRun => {
  const start = items.findLastIndex((i) => i.kind === "user" && !i.review);
  const since = start === -1 ? items : items.slice(start + 1);
  const person = items[start];
  const rounds = since.flatMap((i) => (i.kind === "review" ? [i] : []));
  const at = items.findLastIndex((i) => i.kind === "user");
  const last = items[at];
  // Answered once a round came after it.
  const answered =
    last?.kind === "user" &&
    last.review !== undefined &&
    !items.slice(at + 1).some((i) => i.kind === "review")
      ? rounds.find((r) => r.id === last.review)
      : undefined;
  return {
    answering: answered,
    request: person?.kind === "user" ? person.text : "",
    rounds,
  };
};

/** The rounds who reviewed in turn so far: a closing round is everyone's, not a turn. */
export const turnsOf = (rounds: readonly ReviewItem[]) =>
  rounds.filter((r) => r.closing !== true).length;

/**
 * A round as contracts' `verdictOf` reads it, from the transcript: each reviewer's overall, or
 * no score. The categories are not kept there; a goal's floors are read from the round just run.
 */
export const roundOf = (item: ReviewItem): Round => ({
  costUsd: 0,
  reviewers: Object.fromEntries(
    item.reviewers.map((r) => [
      r.key,
      {
        score:
          r.score === undefined
            ? { kind: "none", reason: r.reason ?? "no score" }
            : { categories: {}, kind: "scored", overall: r.score },
        signedOff: r.approved === true,
      },
    ])
  ),
});

// ---- a reviewer's answer ----

/** A finding as a model writes it: the rule may be left out when the skill has none. */
const AnsweredFinding = Schema.Struct({
  ...Finding.fields,
  rule: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
});

/** What a review model says of one page. */
export const PageAnswer = Schema.Struct({
  findings: Schema.Array(AnsweredFinding),
  /** The page's file or URL, as it was named in the prompt. */
  page: Schema.optional(Schema.String),
  /** The categories the page has beyond the ones every screen has. */
  reached: Schema.Array(Category).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  signOff: SignOff,
});
export type PageAnswer = typeof PageAnswer.Type;

/** A review model's whole answer: one per page, or, for a single page, its answer alone. */
const ReviewerAnswer = Schema.Union([
  Schema.Struct({ pages: Schema.Array(PageAnswer) }),
  PageAnswer,
]);
const decodeAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(ReviewerAnswer)
);

const FENCED_JSON = /```(?:json)?\s*\n([\s\S]*?)```/g;

/** The answer in what a review model said: its last fenced JSON block, or all of it. */
export const answerOf = (
  said: string
): Option.Option<readonly PageAnswer[]> => {
  const blocks = [...said.matchAll(FENCED_JSON)].map((m) => m[1] ?? "");
  const candidates = [...blocks.reverse(), said.trim()];
  for (const candidate of candidates) {
    const decoded = decodeAnswer(candidate);
    if (Option.isSome(decoded)) {
      const answer = decoded.value;
      return Option.some("pages" in answer ? answer.pages : [answer]);
    }
  }
  return Option.none();
};

/** A page under review: its file and, where it has one, its URL. */
export interface ReviewedPage {
  readonly file: string;
  readonly route?: string | undefined;
}

/** The answers given to each page, by name where the model named it, else in order. */
export const answersByPage = (
  pages: readonly ReviewedPage[],
  answers: readonly PageAnswer[]
): readonly (PageAnswer | undefined)[] => {
  const named = (page: ReviewedPage, answer: PageAnswer) =>
    answer.page !== undefined &&
    (answer.page === page.file ||
      answer.page === page.route ||
      page.file.endsWith(answer.page));
  const left = [...answers];
  const byName = pages.map((page) => {
    const i = left.findIndex((a) => named(page, a));
    return i === -1 ? undefined : left.splice(i, 1)[0];
  });
  // A page not named takes the next answer that names no page of the review.
  const unnamed = left.filter((a) => !pages.some((p) => named(p, a)));
  return byName.map((a) => a ?? unnamed.shift());
};

/** Approved: it signed off, or found nothing and said nothing is left. */
export const approves = (answer: PageAnswer) =>
  answer.signOff.done ||
  (answer.findings.length === 0 && answer.signOff.left.trim() === "");

/** A review model's score of the pages and whether it approved every one. */
export const reviewerScore = (
  pages: readonly ReviewedPage[],
  answers: readonly (PageAnswer | undefined)[]
): { readonly approved: boolean; readonly score: Score } => {
  const sections = pages.map((page, i) => {
    const answer = answers[i];
    const score: Score =
      answer === undefined
        ? { kind: "none", reason: "it said nothing of this page" }
        : sectionScore(answer.findings, answer.reached);
    return { name: page.route ?? page.file, score };
  });
  const score = toPageScore(sections);
  return {
    approved:
      answers.length === pages.length &&
      answers.every((a) => a !== undefined && approves(a)),
    score:
      score.kind === "none"
        ? { kind: "none", reason: score.reason }
        : {
            categories: score.categories,
            kind: "scored",
            overall: score.overall,
          },
  };
};

// ---- who reviews ----

/**
 * The review model that takes the round of one that didn't answer: the next in turn after it
 * that isn't in the round already, or none.
 */
export const standInFor = (
  models: readonly ReviewModel[],
  failed: ReviewModel,
  inRound: ReadonlySet<string>
): ReviewModel | undefined => {
  const at = models.findIndex(
    (m) => formatReviewModel(m) === formatReviewModel(failed)
  );
  for (let step = 1; step <= models.length; step += 1) {
    const next = models[(at + step) % models.length];
    if (next !== undefined && !inRound.has(formatReviewModel(next))) {
      return next;
    }
  }
  return undefined;
};

/**
 * Whether a round's own reviewers are satisfied (the goal met or approved, or nothing found)
 * while every review model is to approve and not all of them looked: then every model looks at
 * the page as it stands, before the designer is asked anything (as the lab's loop does).
 */
export const handsToAll = (options: {
  readonly approval: Approval;
  readonly closing: boolean;
  readonly found: number;
  readonly models: number;
  readonly verdict: Verdict;
  readonly who: number;
}) => {
  const { verdict } = options;
  const satisfied = verdict.stop
    ? verdict.reason === "goal" || verdict.reason === "signed-off"
    : options.found === 0;
  return (
    satisfied &&
    !options.closing &&
    options.approval === "all" &&
    options.who < options.models
  );
};

/** Why the review ended, as the transcript says it. */
export const endReasonOf = (reason: StopReason): ReviewEnd =>
  reason === "signed-off" ? "approved" : reason;

// ---- the designer's answer ----

const LIST_MARK = /^[-*>]\s+|^\d+[.)]\s+/;
const EMPHASIS = /[*`_]/g;
const DECLINED = /^declined\s*:?\s*(.*)$/gi;
const LEADING_NUMBER = /^#?(\d+)\b/g;
const LEADING_DASH = /^[\s:—–-]+/;

/** A line as the designer wrote it, without the markdown around it. */
const bare = (line: string) =>
  line.trim().replace(LIST_MARK, "").replaceAll(EMPHASIS, "").trim();

const normal = (text: string) =>
  text.replaceAll(EMPHASIS, "").trim().toLowerCase();

/**
 * The findings the designer declined, by their index, each with its reason: one line each,
 * `Declined: <title> — <reason>` (a number for the title is taken too). A line naming no finding
 * is left out.
 */
export const declinedOf = (
  said: string,
  findings: readonly Pick<RoundFinding, "title">[]
): ReadonlyMap<number, string> => {
  const titles = findings.map((f, i) => ({ i, title: normal(f.title) }));
  const declined = new Map<number, string>();
  for (const line of said.split("\n").map(bare)) {
    const [matched] = line.matchAll(DECLINED);
    if (matched === undefined) {
      continue;
    }
    const rest = (matched[1] ?? "").trim();
    const lower = rest.toLowerCase();
    // The longest title it starts with: one title may begin another.
    const [byTitle] = titles
      .filter((f) => f.title !== "" && lower.startsWith(f.title))
      .sort((a, b) => b.title.length - a.title.length);
    const [number] = rest.matchAll(LEADING_NUMBER);
    const at =
      byTitle ??
      (number === undefined
        ? undefined
        : { i: Number(number[1]) - 1, title: number[0] });
    if (at !== undefined && at.i >= 0 && at.i < findings.length) {
      declined.set(
        at.i,
        rest.slice(at.title.length).replace(LEADING_DASH, "").trim()
      );
    }
  }
  return declined;
};

// ---- a round's bookkeeping ----

/** A finding, with who found it and on which page, as the round keeps it until it is answered. */
export interface Found {
  readonly finding: Finding;
  readonly page: string;
  readonly reviewer: string;
}

/** A finding as the transcript shows it. */
export const toRoundFinding = (f: Found): RoundFinding => ({
  category: f.finding.category,
  fix: f.finding.fix,
  problem: f.finding.problem,
  reviewer: f.reviewer,
  severity: f.finding.severity,
  title: f.finding.title,
  where: f.finding.where,
});

/** What a review model's answer gives the round: its score, its findings, what it still wants. */
export interface ReviewerResult {
  readonly found: readonly Found[];
  /** What it still wants before it approves, page by page, as the designer is told it. */
  readonly left: readonly string[];
  /** Its entry in the round, answered. */
  readonly patch: Partial<RoundReviewer>;
  readonly result: ReviewerRound;
}

/** A review model's answer, for the round: `name` is how the designer is told who said what. */
export const reviewerResult = (
  pages: readonly ReviewedPage[],
  answered: readonly PageAnswer[],
  who: { readonly key: string; readonly name: string }
): ReviewerResult => {
  const answers = answersByPage(pages, answered);
  const { approved, score } = reviewerScore(pages, answers);
  const found: Found[] = [];
  const left: string[] = [];
  pages.forEach((view, i) => {
    const answer = answers[i];
    const page = view.route ?? view.file;
    if (answer === undefined) {
      left.push(`${who.name} said nothing of ${view.route ?? view.file}.`);
      return;
    }
    for (const finding of answer.findings) {
      found.push({ finding, page, reviewer: who.key });
    }
    if (!approves(answer)) {
      left.push(
        `${who.name}: ${answer.signOff.left.trim() || "it hasn't approved it yet."}`
      );
    }
  });
  return {
    found,
    left,
    patch: {
      approved,
      findings: found.length,
      status: "done",
      ...(score.kind === "scored"
        ? { score: score.overall }
        : { reason: score.reason }),
    },
    result: { score, signedOff: approved },
  };
};

/** The round with the designer's answer: what it declined and why, and how many it fixed. */
export const answeredRound = (
  item: ReviewItem,
  declined: ReadonlyMap<number, string>
): ReviewItem => ({
  ...item,
  findings: item.findings.map((f, i) => {
    const reason = declined.get(i);
    return reason === undefined ? f : { ...f, declined: reason };
  }),
  fixed: item.findings.length - declined.size,
});

/** The round ended, the reviewers still looking stopped with it; one that ended stays as it is. */
export const endedRound = (
  item: ReviewItem,
  end: NonNullable<ReviewItem["end"]>,
  stopped: string
): ReviewItem =>
  item.end === undefined
    ? {
        ...item,
        end,
        reviewers: item.reviewers.map((r) =>
          r.status === "looking"
            ? { ...r, reason: stopped, status: "no-score" }
            : r
        ),
      }
    : item;

/** How a round that ends the review ends: why, the round kept and who was short. */
export const roundEndOf = (verdict: Verdict): NonNullable<ReviewItem["end"]> =>
  verdict.stop
    ? {
        best: verdict.best + 1,
        reason: endReasonOf(verdict.reason),
        unmet: [...verdict.unmet],
      }
    : { reason: "no-scores", unmet: [...verdict.unmet] };

/** What the designer said in the turn after the transcript's last prompt. */
export const saidSinceLastPrompt = (items: readonly ThreadItem[]) => {
  const prompt = items.findLastIndex((i) => i.kind === "user");
  return items
    .slice(prompt + 1)
    .flatMap((i) => (i.kind === "agent" ? [i.text] : []))
    .join("\n");
};
