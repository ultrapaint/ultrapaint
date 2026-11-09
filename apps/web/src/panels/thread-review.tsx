/**
 * A design run in the chat (ADR 0063): the run card that follows Outline, Build and Review, and
 * each review round with who looked, what they scored, and what the designer did with it.
 */
import type { RoundReviewer, ThreadItem } from "@ultrapaint/contracts/threads";
import {
  Check,
  ChevronRight,
  Circle,
  CircleSlash,
  ScanEye,
  Square,
} from "lucide-react";
import type * as React from "react";
import { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import {
  endLine,
  type ReviewItem,
  type RunStep,
  runSteps,
} from "../lib/design-run.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";

type PlanItem = Extract<ThreadItem, { kind: "plan" }>;

/** What the thread knows of its runs: each run plan's rounds, and the review planned. */
export interface RunContext {
  /** The thread works: Go on waits for it. */
  readonly busy: boolean;
  /** "Standard · 3 review models", or "Off". */
  readonly planned: string;
  readonly rounds: ReadonlyMap<string, readonly ReviewItem[]>;
  /** The run plans whose last turn the person stopped. */
  readonly stopped: ReadonlySet<string>;
  readonly threadId: string;
}

export const RunContextValue = createContext<RunContext>({
  busy: false,
  planned: "",
  rounds: new Map(),
  stopped: new Set(),
  threadId: "",
});

/** Whether a round sits in a run card, which shows it, rather than on its own. */
export const inRunCard = (context: RunContext, item: ReviewItem) =>
  [...context.rounds.values()].some((rounds) => rounds.includes(item));

const STEP_WORDS: Record<RunStep["status"], string> = {
  completed: "Done",
  in_progress: "Under way",
  pending: "To come",
  stopped: "Stopped",
};

const StepMark = ({ status }: { status: RunStep["status"] }) => {
  let mark = (
    <Circle aria-hidden className="size-3.5 text-muted-foreground/60" />
  );
  if (status === "completed") {
    mark = <Check aria-hidden className="size-3.5 text-muted-foreground" />;
  } else if (status === "stopped") {
    // As a turn that stopped says it (the transcript's turn end).
    mark = (
      <span aria-hidden className="flex size-3.5 items-center justify-center">
        <Square className="size-2.5 fill-warning text-warning" />
      </span>
    );
  } else if (status === "in_progress") {
    mark = (
      <span aria-hidden className="flex size-3.5 items-center justify-center">
        <span className="size-1.5 rounded-full bg-foreground" />
      </span>
    );
  }
  return (
    <>
      {mark}
      <span className="sr-only">{STEP_WORDS[status]}:</span>
    </>
  );
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One review model's line in a round: its name, then its score, "Looking" or "No score". */
const ReviewerLine = ({ reviewer }: { reviewer: RoundReviewer }) => (
  <div className="flex flex-col">
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-body-medium">
        {reviewer.name}
      </span>
      {reviewer.status === "looking" ? (
        <span className="flex items-center gap-1.5 font-body-small text-muted-foreground">
          <Spinner className="size-3" />
          Looking
        </span>
      ) : null}
      {reviewer.status === "no-score" ? (
        <span className="flex items-center gap-1.5 font-body-small text-muted-foreground">
          <CircleSlash aria-hidden className="size-3.5" />
          No score
        </span>
      ) : null}
      {reviewer.status === "done" ? (
        <span className="flex items-center gap-1.5 font-body-small text-muted-foreground">
          {reviewer.approved ? (
            <>
              <Check aria-hidden className="size-3.5" />
              Approved
            </>
          ) : (
            plural(reviewer.findings, "finding")
          )}
          {reviewer.score === undefined ? null : (
            <span className="min-w-6 text-right font-body-medium text-foreground tabular-nums">
              <span className="sr-only">, score </span>
              {reviewer.score}
              <span className="sr-only"> out of 100</span>
            </span>
          )}
        </span>
      ) : null}
    </div>
    {reviewer.status === "no-score" && reviewer.reason ? (
      <span className="font-body-small text-muted-foreground">
        {reviewer.reason}
      </span>
    ) : null}
  </div>
);

/** A round's body: who looked, and what the designer fixed and declined with its reasons. */
const RoundBody = ({ item }: { item: ReviewItem }) => {
  const declined = item.findings.filter((f) => f.declined !== undefined);
  const answered = [
    item.fixed !== undefined && item.fixed > 0 ? `${item.fixed} fixed` : null,
    declined.length > 0 ? `${declined.length} declined` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {item.reviewers.length > 0 ? (
        <div className="flex flex-col gap-1">
          {item.reviewers.map((r) => (
            <ReviewerLine key={r.key} reviewer={r} />
          ))}
        </div>
      ) : null}
      {item.fixed === undefined ? null : (
        <p className="font-body-small text-muted-foreground">
          {answered || "Nothing to fix"}
        </p>
      )}
      {declined.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {declined.map((f) => (
            <li className="flex flex-col" key={`${f.reviewer}:${f.title}`}>
              <span className="font-body-medium">{f.title}</span>
              <span className="font-body-small text-muted-foreground">
                Declined: {f.declined}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

const roundTitle = (item: ReviewItem) =>
  `Round ${item.round}${item.closing ? " · all review models" : ""}`;

/** The rounds under the card's Review step, each its title and body. */
const Rounds = ({ rounds }: { rounds: readonly ReviewItem[] }) => (
  <ol className="mt-1.5 flex flex-col gap-2.5 border-l pl-3">
    {rounds.map((item) => (
      <li className="flex flex-col gap-1" key={item.id}>
        <span className="font-body-small text-muted-foreground">
          {roundTitle(item)}
        </span>
        <RoundBody item={item} />
      </li>
    ))}
  </ol>
);

/** One step of the card: its mark, title and how far it came, what it works on under it. */
const StepRow = ({
  children,
  step,
}: {
  children?: React.ReactNode;
  step: RunStep;
}) => (
  <li className="flex flex-col">
    <span className="flex items-start gap-2">
      <span className="flex h-5 shrink-0 items-center">
        <StepMark status={step.status} />
      </span>
      <span
        className={cn(
          "font-body-medium",
          step.status === "pending" && "text-muted-foreground"
        )}
      >
        {step.title}
      </span>
      {step.detail ? (
        <span className="min-w-0 pt-px font-body-small text-muted-foreground">
          {step.detail}
        </span>
      ) : null}
    </span>
    {step.now ? (
      <span className="pl-5.5 font-body-small text-muted-foreground">
        {step.now}
      </span>
    ) : null}
    {children ? <div className="pl-5.5">{children}</div> : null}
  </li>
);

/**
 * The run's steps in one quiet card, each with how far it has come, the review's rounds under
 * Review. Once the review has ended the card folds to how it ended; the steps open under it.
 * A run the person stopped before it was built offers to go on.
 */
export const RunCard = ({ plan }: { plan: PlanItem }) => {
  const { busy, planned, rounds, stopped, threadId } =
    useContext(RunContextValue);
  const runRounds = rounds.get(plan.id) ?? [];
  const steps = runSteps(plan, runRounds, planned, stopped.has(plan.id));
  const last = runRounds.at(-1);
  const review = steps.at(-1);
  const goOn = () =>
    api()
      .request("threads.prompt", {
        attachments: [],
        text: "Go on from where you stopped.",
        threadId,
      })
      .catch(reportError);
  // Folded, the card's head says how the review ended; its Review step then says how it ran.
  const shownSteps = last?.end
    ? steps.map((step) =>
        step.title === "Review" ? { ...step, detail: planned } : step
      )
    : steps;
  const list = (
    <ol className="flex flex-col gap-1">
      {shownSteps.map((step) => (
        <StepRow key={step.title} step={step}>
          {step.title === "Review" && runRounds.length > 0 && !last?.end ? (
            <Rounds rounds={runRounds} />
          ) : null}
          {step.title === "Build" && step.status === "stopped" && !busy ? (
            <Button
              className="mt-1.5 -ml-2"
              onClick={goOn}
              size="sm"
              variant="secondary"
            >
              Go on
            </Button>
          ) : null}
        </StepRow>
      ))}
    </ol>
  );
  if (!(last?.end && review)) {
    return <div className="rounded-lg border px-3 py-2.5">{list}</div>;
  }
  return (
    <Collapsible className="rounded-lg border px-3 py-2.5">
      <CollapsibleTrigger className="group/run flex w-full items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-5 shrink-0 items-center">
          <StepMark status={review.status} />
        </span>
        <span className="min-w-0 flex-1 font-body-medium">{review.detail}</span>
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/run:rotate-90"
        />
      </CollapsibleTrigger>
      {last.end.unmet.length > 0 ? (
        <p className="pl-5.5 font-body-small text-muted-foreground">
          Still short: {last.end.unmet.join("; ")}
        </p>
      ) : null}
      <CollapsibleContent className="mt-2 border-t pt-2">
        {list}
        <div className="mt-2 pl-5.5">
          <Rounds rounds={runRounds} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/**
 * A round of a review with no run card to sit in (the agent kept no plan of Outline and Build):
 * who looked and what they scored, what the designer did, and how the review ended.
 */
export const ReviewRound = ({ item }: { item: ReviewItem }) => (
  <section
    aria-label={`Review, round ${item.round}`}
    className="flex flex-col gap-2 rounded-lg border px-3 py-2.5"
  >
    <header className="flex items-center gap-2 font-body-small text-muted-foreground">
      <ScanEye aria-hidden className="size-3.5" />
      <span>{roundTitle(item)}</span>
    </header>
    <RoundBody item={item} />
    {item.end ? (
      <p
        className={cn(
          "border-t pt-2 font-body-small",
          item.end.reason === "failed" ? "text-destructive" : "text-foreground"
        )}
      >
        {endLine(item, item.round)}
        {item.end.unmet.length > 0 ? (
          <span className="block text-muted-foreground">
            Still short: {item.end.unmet.join("; ")}
          </span>
        ) : null}
      </p>
    ) : null}
  </section>
);
