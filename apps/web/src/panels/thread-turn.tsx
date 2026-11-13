/**
 * A design chat's turn as the chat draws it (ADR 0095): the person's prompt, one card for what the
 * agent did (the page it changed, the run's progress, the review, its steps folded), and the
 * agent's last message under it. Every step stays one click away; "Show every step" in the
 * chat's menu draws the transcript as the agent reported it instead.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { ChevronRight, Crosshair, LocateFixed, ScanEye } from "lucide-react";
import { type ReactNode, useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import { Markdown } from "../components/markdown.tsx";
import { endLine, runSteps, scoreRange } from "../lib/design-run.ts";
import { reveal } from "../lib/reveal.ts";
import { toggleFollowing } from "../lib/thread-actions.ts";
import {
  nowDoing,
  stepTitle,
  type Turn,
  type TurnParts,
  turnParts,
} from "../lib/thread-turns.ts";
import { formatDuration, stopNote } from "../lib/thread-work.ts";
import { useAgents } from "../state/agents.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { ScopePicture } from "./chat-list.tsx";
import { Rounds, RunContextValue, StepRow } from "./thread-review.tsx";
import { Item } from "./thread-transcript.tsx";
import { WorkingIndicator } from "./thread-work.tsx";

/** A row of the card, its sections parted by hairlines. */
const Section = ({ children }: { children: ReactNode }) => (
  <div className="border-t first:border-t-0">{children}</div>
);

/** A row that opens what is under it: its line, then a chevron at the right that turns. */
const Fold = ({
  children,
  label,
  lead,
  trail,
}: {
  children: ReactNode;
  label: ReactNode;
  lead?: ReactNode;
  trail?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="group/fold flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left outline-none transition-colors duration-100 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-3.5 [&_svg]:shrink-0">
        {lead}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trail}
        <ChevronRight className="text-muted-foreground transition-transform duration-150 group-data-panel-open/fold:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
};

/** The pages a turn's changed files are, in the order the agent changed them. */
const useChangedPages = (changed: readonly string[]) => {
  const pages = useProject((s) => s.pages);
  return useMemo(
    () =>
      changed.flatMap((file) => {
        const page = pages.find((p) => p.file === file);
        return page ? [page] : [];
      }),
    [changed, pages]
  );
};

/**
 * The page the turn works on: its picture, its name, what is happening to it, and Follow while
 * the agent works or Show once it is done. A turn that changed no page and works on none has none.
 */
const PageRow = ({
  parts,
  running,
  thread,
}: {
  parts: TurnParts;
  running: boolean;
  thread: Thread;
}) => {
  const changedPages = useChangedPages(parts.changed);
  const scopePage = useProject((s) =>
    s.pages.find((p) => p.file === thread.scope?.file)
  );
  const following = useAgents((s) => s.following === thread.id);
  const [first] = changedPages;
  const page = running ? (scopePage ?? first) : first;
  if (!page) {
    return null;
  }
  const more = running ? 0 : changedPages.length - 1;
  const files = parts.changed.length;
  return (
    <Section>
      <div className="flex items-center gap-2.5 py-2.5 pr-2 pl-3">
        <ScopePicture className="h-10 w-14" thread={thread} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-body-medium">
            {page.name}
            {more > 0 ? (
              <span className="text-muted-foreground"> and {more} more</span>
            ) : null}
          </span>
          {running ? (
            <span className="font-body-small text-muted-foreground">
              Being edited
            </span>
          ) : (
            <button
              className="self-start rounded-sm font-body-small text-muted-foreground underline decoration-muted-foreground/40 underline-offset-3 outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                const [file] = parts.changed;
                showLeftPanel(file ? { changes: file } : "changes");
              }}
              type="button"
            >
              {files === 1 ? "1 file changed" : `${files} files changed`}
            </button>
          )}
        </div>
        {running ? (
          <Button
            aria-pressed={following}
            className={cn(following && "bg-accent")}
            onClick={() => toggleFollowing(thread.id)}
            size="sm"
            variant="ghost"
          >
            <Crosshair data-icon="inline-start" />
            {following ? "Following" : "Follow"}
          </Button>
        ) : (
          <Button
            onClick={() => reveal({ page: page.id })}
            size="sm"
            variant="ghost"
          >
            <LocateFixed data-icon="inline-start" />
            Show
          </Button>
        )}
      </div>
    </Section>
  );
};

/** Outline, Build and Review while the run goes; folded into the review's line once it ended. */
const RunSteps = ({
  parts,
  stopped,
}: {
  parts: TurnParts;
  stopped: boolean;
}) => {
  const { planned } = useContext(RunContextValue);
  if (!parts.plan) {
    return null;
  }
  const steps = runSteps(parts.plan, parts.rounds, planned, stopped);
  return (
    <Section>
      <ol className="flex flex-col gap-1 px-3 py-2.5">
        {steps.map((step) => (
          <StepRow
            key={step.title}
            step={
              // The card says where the build is once: the section with its count.
              step.title === "Build" && step.now
                ? {
                    ...step,
                    detail: `${step.now} · ${step.detail}`,
                    now: undefined,
                  }
                : step
            }
          />
        ))}
      </ol>
    </Section>
  );
};

/** The review: how it ended (or where it is), its scores, its rounds under it. */
const ReviewSection = ({ parts }: { parts: TurnParts }) => {
  const last = parts.rounds.at(-1);
  if (!last) {
    return null;
  }
  const line = last.end
    ? endLine(last, parts.rounds.length).replace(` · ${scoreRange(last)}`, "")
    : `Round ${last.round} of up to ${last.maxRounds}`;
  const scores = last.end ? scoreRange(last) : null;
  return (
    <Section>
      <Fold
        label={<span className="font-body-medium">{line}</span>}
        lead={<ScanEye className="text-muted-foreground" />}
        trail={
          scores ? (
            <span className="font-body-small tabular-nums">{scores}</span>
          ) : null
        }
      >
        <Rounds rounds={parts.rounds} />
        {last.end && last.end.unmet.length > 0 ? (
          <p className="mt-2 font-body-small text-muted-foreground">
            Still short: {last.end.unmet.join("; ")}
          </p>
        ) : null}
      </Fold>
    </Section>
  );
};

/** The agent's steps, one line each, its words between them muted. */
const StepList = ({ parts }: { parts: TurnParts }) => (
  <ol className="flex flex-col font-body-small">
    {parts.steps.map((step) =>
      step.kind === "tool" ? (
        <li className="flex min-h-6 items-center gap-2" key={step.id}>
          <span
            aria-hidden
            className={cn(
              "mx-1 size-1.5 shrink-0 rounded-full",
              step.status === "failed"
                ? "bg-destructive"
                : "bg-muted-foreground"
            )}
          />
          <span className="min-w-0 truncate">{stepTitle(step, false)}</span>
          {step.status === "failed" ? (
            <span className="shrink-0 text-destructive">Failed</span>
          ) : null}
        </li>
      ) : (
        <li
          className="select-text py-1 pl-5.5 text-muted-foreground [&_li]:font-body-small [&_p]:my-0 [&_p]:font-body-small"
          key={step.id}
        >
          <Markdown>{step.text}</Markdown>
        </li>
      )
    )}
  </ol>
);

/**
 * The card's last row: while the agent works, what it is doing and for how long; once it is done,
 * how long it worked and its steps, folded.
 */
const Activity = ({
  parts,
  running,
  since,
  turn,
}: {
  parts: TurnParts;
  running: boolean;
  since: number | undefined;
  turn: Turn;
}) => {
  const tools = parts.steps.filter((s) => s.kind === "tool").length;
  if (running) {
    return (
      <Section>
        <div className="px-3">
          <WorkingIndicator label={nowDoing(turn)} since={since} />
        </div>
      </Section>
    );
  }
  if (parts.steps.length === 0) {
    return null;
  }
  const took =
    since !== undefined && parts.endedAt !== undefined
      ? `Worked ${formatDuration(parts.endedAt - since)}`
      : "Worked";
  const count = tools === 1 ? "1 step" : `${tools} steps`;
  const label = tools > 0 ? `${took} · ${count}` : took;
  return (
    <Section>
      <Fold
        label={
          <span className="font-body-small text-muted-foreground">{label}</span>
        }
      >
        <StepList parts={parts} />
      </Fold>
    </Section>
  );
};

/** A turn: the prompt, the card, what stays in the transcript as it is, the agent's answer. */
export const TurnView = ({
  last,
  running,
  thread,
  turn,
}: {
  /** The thread's last turn, the one the agent may be working on. */
  last: boolean;
  running: boolean;
  thread: Thread;
  turn: Turn;
}) => {
  const working = last && running;
  const parts = useMemo(() => turnParts(turn, !working), [turn, working]);
  const { stopped: stoppedRuns } = useContext(RunContextValue);
  const since = turn.prompt?.at;
  const stopped = parts.stopped ? stopNote(parts.stopped.stopReason) : null;
  const runStopped = parts.plan ? stoppedRuns.has(parts.plan.id) : false;
  const card = (
    <>
      <PageRow parts={parts} running={working} thread={thread} />
      {/* Progress while the run goes, or where it stopped; once over, the review's line says it. */}
      {working || runStopped ? (
        <RunSteps parts={parts} stopped={runStopped} />
      ) : null}
      <ReviewSection parts={parts} />
      <Activity parts={parts} running={working} since={since} turn={turn} />
    </>
  );
  const hasCard =
    working || parts.steps.length > 0 || parts.plan || parts.rounds.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {turn.prompt ? (
        <Item item={turn.prompt} streaming={false} threadId={thread.id} />
      ) : null}
      {hasCard ? (
        <section
          aria-label="What the agent did"
          className="overflow-hidden rounded-lg border"
        >
          {card}
        </section>
      ) : null}
      {parts.inline.map((item) => (
        <Item
          item={item}
          key={item.id}
          streaming={false}
          threadId={thread.id}
        />
      ))}
      {parts.answer ? (
        <Item item={parts.answer} streaming={false} threadId={thread.id} />
      ) : null}
      {stopped && !working ? (
        <p className="font-body-small text-muted-foreground">{stopped}</p>
      ) : null}
    </div>
  );
};
