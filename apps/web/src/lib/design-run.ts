/**
 * A design run as the chat shows it (ADR 0063): from the person's prompt to the design approved,
 * its steps (Outline, Build, Review) read from what the transcript already holds: the agent's plan,
 * whose entries a design thread is told to name "Outline" and "Build <section>", and the review
 * rounds the editor adds. Pure, so the card is the same whoever draws it.
 */
import type { ThreadItem } from "@ultrapaint/contracts/threads";

type PlanItem = Extract<ThreadItem, { kind: "plan" }>;
export type ReviewItem = Extract<ThreadItem, { kind: "review" }>;
type PlanStatus = "pending" | "in_progress" | "completed";
/** A step's state; a review that ended without approval or its goal is `stopped`. */
type StepStatus = PlanStatus | "stopped";

const OUTLINE_RE = /^outline\b[:\s-]*/i;
const BUILD_RE = /^build\b[:\s-]*/i;

/** A step of the run card. */
export interface RunStep {
  /** What it has come to: "4 sections", "3 of 4", "Round 2 of up to 6". */
  readonly detail: string;
  /** What it works on now, under the step: the section being built. */
  readonly now?: string | undefined;
  readonly status: StepStatus;
  readonly title: "Build" | "Outline" | "Review";
}

const stepStatus = (statuses: readonly PlanStatus[]): StepStatus => {
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) {
    return "completed";
  }
  return statuses.some((s) => s !== "pending") ? "in_progress" : "pending";
};

/** Whether a plan is a design run's: its entries say Outline or Build. */
export const isRunPlan = (plan: PlanItem): boolean =>
  plan.entries.some(
    (e) => BUILD_RE.test(e.content) || OUTLINE_RE.test(e.content)
  );

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The run's review so far, in a few words, and whether it is over. */
export const reviewStep = (
  rounds: readonly ReviewItem[],
  /** "Standard · 3 review models": the level when the review hasn't started. */
  planned: string
): RunStep => {
  const last = rounds.at(-1);
  if (last === undefined) {
    return { detail: planned, status: "pending", title: "Review" };
  }
  if (last.end) {
    const met = last.end.reason === "approved" || last.end.reason === "goal";
    return {
      detail: endLine(last, last.round),
      status: met ? "completed" : "stopped",
      title: "Review",
    };
  }
  return {
    detail: `Round ${last.round} of up to ${last.maxRounds}`,
    status: "in_progress",
    title: "Review",
  };
};

/**
 * The run card's steps, from the run's plan and its review rounds. A run whose last turn was
 * stopped before its sections were all built says where it stopped.
 */
export const runSteps = (
  plan: PlanItem,
  rounds: readonly ReviewItem[],
  planned: string,
  stopped = false
): readonly RunStep[] => {
  const outline = plan.entries.filter((e) => OUTLINE_RE.test(e.content));
  const build = plan.entries.filter((e) => BUILD_RE.test(e.content));
  const steps: RunStep[] = [];
  if (outline.length > 0) {
    steps.push({
      detail:
        build.length > 0 ? plural(build.length, "section", "sections") : "",
      status: stepStatus(outline.map((e) => e.status)),
      title: "Outline",
    });
  }
  if (build.length > 0) {
    const done = build.filter((e) => e.status === "completed").length;
    const at = build.findIndex((e) => e.status === "in_progress");
    const current = build[at];
    const next = build.find((e) => e.status !== "completed");
    const status = stepStatus(build.map((e) => e.status));
    if (stopped && next) {
      steps.push({
        detail: `Stopped at ${done} of ${build.length}`,
        now: `Stopped before ${next.content.replace(BUILD_RE, "")}. What was built is on the canvas.`,
        status: "stopped",
        title: "Build",
      });
    } else {
      // The section under way, counted from 1: "3 of 4" while the third is built.
      steps.push({
        detail: `${current ? at + 1 : done} of ${build.length}`,
        now: current?.content.replace(BUILD_RE, ""),
        status,
        title: "Build",
      });
    }
  }
  steps.push(reviewStep(rounds, planned));
  return steps;
};

/**
 * The run plans whose run's last turn the person stopped: from the plan up to the person's next
 * prompt, the last turn's end says `cancelled`.
 */
export const stoppedRuns = (
  items: readonly ThreadItem[]
): ReadonlySet<string> => {
  const stopped = new Set<string>();
  let plan: string | null = null;
  for (const item of items) {
    if (item.kind === "user" && item.review === undefined) {
      plan = null;
    } else if (item.kind === "plan" && isRunPlan(item)) {
      plan = item.id;
    } else if (item.kind === "turn_end" && plan !== null) {
      if (item.stopReason === "cancelled") {
        stopped.add(plan);
      } else {
        stopped.delete(plan);
      }
    }
  }
  return stopped;
};

/** "90–94", "92": the scores of a round's reviewers that scored. */
export const scoreRange = (round: ReviewItem): string | null => {
  const scores = round.reviewers.flatMap((r) =>
    r.score === undefined ? [] : [r.score]
  );
  if (scores.length === 0) {
    return null;
  }
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  return low === high ? String(low) : `${low}–${high}`;
};

const approvedBy = (round: ReviewItem) => {
  const n = round.reviewers.length;
  if (n === 1) {
    return `Approved by ${round.reviewers[0]?.name}`;
  }
  return n === 2 ? "Approved by both" : `Approved by all ${n}`;
};

/** How the review ended, in a line: "Approved by all 3 · 90–94 · 3 rounds". */
export const endLine = (round: ReviewItem, count: number): string => {
  const { end } = round;
  const rounds = plural(count, "round", "rounds");
  const scores = scoreRange(round);
  const kept =
    end?.best !== undefined && end.best !== round.round
      ? ` · round ${end.best} kept`
      : "";
  switch (end?.reason) {
    case "approved":
      return [approvedBy(round), scores, rounds].filter(Boolean).join(" · ");
    case "goal":
      return ["Goal met", scores, rounds].filter(Boolean).join(" · ");
    case "max-rounds":
      return `Stopped after ${rounds}, the most a review runs${kept}`;
    case "plateau":
      return `Stopped: the last rounds gained under 2 points${kept}`;
    case "budget":
      return `Stopped at the budget${kept}`;
    case "no-scores":
      return "No review model could score it";
    case "stopped":
      return "Review stopped";
    case "failed":
      return end.problem
        ? `Review couldn’t start: ${end.problem}`
        : "Review couldn’t start";
    default:
      return rounds;
  }
};

/**
 * The review rounds of the run each plan belongs to: those after it, up to the person's next
 * prompt (a prompt carrying a round's findings is the review's, not the person's).
 */
export const roundsByPlan = (
  items: readonly ThreadItem[]
): ReadonlyMap<string, readonly ReviewItem[]> => {
  const byPlan = new Map<string, ReviewItem[]>();
  let plan: string | null = null;
  for (const item of items) {
    if (item.kind === "user" && item.review === undefined) {
      plan = null;
    } else if (item.kind === "plan" && isRunPlan(item)) {
      // The agent's plan is one item, updated in place; a new one starts a new card.
      if (plan === null || plan !== item.id) {
        plan = item.id;
        byPlan.set(plan, byPlan.get(plan) ?? []);
      }
    } else if (item.kind === "review" && plan !== null) {
      byPlan.get(plan)?.push(item);
    }
  }
  return byPlan;
};
