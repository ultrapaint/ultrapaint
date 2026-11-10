/**
 * The design-system setup's steps (ADR 0023), drawn in the Sync view (ADR 0025): what each one
 * found or wrote, the thread an agent works on it in, and the gate at its end. A step stops for
 * the user before the next one; any step can be stopped, resumed or redone.
 */
import {
  type DefineMode,
  SETUP_STEPS,
  type SetupStep,
} from "@ultrapaint/contracts/design-system-setup";
import { commandOf } from "@ultrapaint/contracts/tasks";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ListChecks,
  MessageSquare,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { Segmented } from "../components/segmented.tsx";
import { threadView } from "../lib/thread-view.ts";
import { useAgents } from "../state/agents.ts";
import {
  openStepThread,
  showSetup,
  useDesignSystemSetup,
} from "../state/design-system-setup.ts";
import { BatchList, InventoryResult, MappingView } from "./setup-results.tsx";

const MODES: { label: string; value: DefineMode }[] = [
  { label: "Adopt the theme", value: "adopt" },
  { label: "Propose one", value: "propose" },
];

/**
 * Where a step stands, as its marker and its badge draw it: `current` is the step to take now,
 * `waiting` one an agent left for the user, `working` one an agent is on.
 */
export type StepTone =
  | "current"
  | "done"
  | "later"
  | "stopped"
  | "waiting"
  | "working";

/** A step's tone and the word its badge says, if any: what nothing else on the step shows. */
const useStepState = (
  step: SetupStep,
  open: boolean
): { label: string | null; tone: StepTone } => {
  const thread = useAgents((s) =>
    step.threadId ? s.threads.find((t) => t.id === step.threadId) : undefined
  );
  if (step.status === "done") {
    return { label: null, tone: "done" };
  }
  if (step.status === "review") {
    return { label: "To review", tone: "waiting" };
  }
  if (step.status === "stopped") {
    return { label: "Stopped", tone: "stopped" };
  }
  if (step.status === "active") {
    const { busy, waiting } = threadView(thread);
    if (busy) {
      return { label: "Working", tone: "working" };
    }
    return waiting
      ? { label: "Your turn", tone: "waiting" }
      : { label: "Under way", tone: "working" };
  }
  return open
    ? { label: null, tone: "current" }
    : { label: null, tone: "later" };
};

/** Whether the step drawn is the one to take now: its main action is then the primary one. */
const StepIsCurrent = createContext(false);

/** The variant of a step's main action: the primary on the step to take now, outline on others. */
export const useStepVariant = () =>
  useContext(StepIsCurrent) ? "default" : "outline";

/** A step's number in its circle, a check once done. */
const StepMarker = ({ index, tone }: { index: number; tone: StepTone }) => (
  <span
    className={cn(
      "flex size-5 shrink-0 items-center justify-center rounded-full font-body-small-medium",
      tone === "done" && "bg-primary text-primary-foreground",
      (tone === "current" || tone === "waiting" || tone === "working") &&
        "bg-foreground text-background",
      tone === "stopped" && "border border-dashed text-muted-foreground",
      tone === "later" && "border text-muted-foreground"
    )}
  >
    {tone === "done" ? <Check className="size-3" /> : index + 1}
  </span>
);

/** What a step's badge says, with a dot for an agent at work or the user's turn. */
export const StepBadge = ({
  label,
  tone,
}: {
  label: string | null;
  tone: StepTone;
}) =>
  label ? (
    <Badge className="shrink-0">
      {tone === "working" ? (
        <span className="size-1.5 rounded-full bg-agent" />
      ) : null}
      {tone === "waiting" ? (
        <span className="size-1.5 rounded-full bg-warning" />
      ) : null}
      {label}
    </Badge>
  ) : null;

/**
 * A step of a list of steps, on a line from one to the next: its marker, its title and badge,
 * then what it says and what can be done.
 */
export const StepFrame = ({
  badge,
  children,
  index,
  last,
  title,
  tone,
}: {
  badge?: React.ReactNode;
  children?: React.ReactNode;
  index: number;
  last: boolean;
  title: string;
  tone: StepTone;
}) => (
  <li className="relative flex gap-3 px-3 py-3">
    {last ? null : (
      <span
        aria-hidden
        className="absolute top-9 -bottom-2 left-[21.5px] w-px bg-border"
      />
    )}
    <StepMarker index={index} tone={tone} />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-h-5 items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-heading-xsmall",
            tone === "later" && "text-muted-foreground"
          )}
        >
          {title}
        </span>
        {badge}
      </div>
      <StepIsCurrent.Provider value={tone === "current" || tone === "waiting"}>
        {children}
      </StepIsCurrent.Provider>
    </div>
  </li>
);

/** Adopt or propose, chosen before Define starts, with what the inventory recommends. */
const ModeChoice = ({
  chosen,
  onChange,
}: {
  chosen: DefineMode;
  onChange: (mode: DefineMode) => void;
}) => {
  const recommended = useDesignSystemSetup((s) => s.inventory?.recommendation);
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented onChange={onChange} options={MODES} value={chosen} />
      {recommended ? (
        <span className="font-body-small text-muted-foreground">
          {recommended.mode === chosen
            ? "Recommended: "
            : "The inventory recommends the other: "}
          {recommended.reason}
        </span>
      ) : null}
    </div>
  );
};

/** Start, the thread, stop, resume, go on, redo: what the step's status allows. */
const StepActions = ({
  current,
  index,
  mode,
  step,
}: {
  current: boolean;
  index: number;
  mode: DefineMode;
  step: SetupStep;
}) => {
  const busy = useDesignSystemSetup((s) => s.busy === step.id);
  const main = useStepVariant();
  const definition = SETUP_STEPS[index];
  const next = SETUP_STEPS[index + 1];
  const started = step.status !== "todo";
  const setup = () => useDesignSystemSetup.getState();
  if (!definition) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5 empty:hidden">
      {step.status === "todo" && current ? (
        <Button
          disabled={busy}
          onClick={() =>
            setup().start(step.id, step.id === "define" ? mode : undefined)
          }
          size="sm"
          variant={main}
        >
          {busy ? <Spinner /> : <Play />}
          {definition.agent
            ? "Start with an agent"
            : `Run ${definition.title.toLowerCase()}`}
        </Button>
      ) : null}
      {step.threadId && started ? (
        <Button
          onClick={() => openStepThread(step.threadId ?? "")}
          size="sm"
          variant="outline"
        >
          <MessageSquare />
          Open chat
        </Button>
      ) : null}
      {step.status === "active" && definition.agent ? (
        <Button
          disabled={busy}
          onClick={() => setup().stop(step.id)}
          size="sm"
          variant="outline"
        >
          <Square />
          Stop
        </Button>
      ) : null}
      {step.status === "stopped" && definition.agent ? (
        <Button
          disabled={busy}
          onClick={() => setup().resume(step.id)}
          size="sm"
          variant="outline"
        >
          <Play />
          Resume
        </Button>
      ) : null}
      {started && step.status !== "done" ? (
        <Button
          disabled={busy}
          onClick={() => setup().complete(step.id)}
          size="sm"
          variant={step.status === "review" ? main : "outline"}
        >
          <ArrowRight />
          {next ? `Continue to ${next.title}` : "Finish"}
        </Button>
      ) : null}
      {started ? (
        <Button
          disabled={busy}
          onClick={() => setup().redo(step.id)}
          size="sm"
          variant="ghost"
        >
          <RotateCcw />
          Redo
        </Button>
      ) : null}
    </div>
  );
};

/**
 * What a step found, open while it waits at its gate and folded once the user has gone on, so the
 * step after it is in sight.
 */
const Folded = ({
  children,
  open,
}: {
  children: React.ReactNode;
  open: boolean;
}) => {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const shown = chosen ?? open;
  return (
    <div className="flex flex-col gap-2">
      {open ? null : (
        <Button
          className="self-start"
          onClick={() => setChosen(!shown)}
          size="sm"
          variant="ghost"
        >
          <ChevronDown className={cn(shown && "rotate-180")} />
          {shown ? "Hide results" : "Show results"}
        </Button>
      )}
      {shown ? children : null}
    </div>
  );
};

/** What a step that has started found or decided, folded once the user has gone on. */
const StepResult = ({ step }: { step: SetupStep }) => {
  const inventory = useDesignSystemSetup((s) => s.inventory);
  const audit = useDesignSystemSetup((s) => s.audit);
  const result = {
    define: null,
    inventory: inventory ? <InventoryResult inventory={inventory} /> : null,
    map: <MappingView />,
    migrate: <BatchList batches={step.batches ?? []} />,
    verify: audit ? <InventoryResult inventory={audit} /> : null,
  }[step.id];
  return result ? (
    <Folded open={step.status !== "done"}>{result}</Folded>
  ) : null;
};

/** How Define goes about it, and where its result is once it has one. */
const DefineNote = ({ step }: { step: SetupStep }) => {
  if (!step.mode) {
    return null;
  }
  const finished = step.status === "review" || step.status === "done";
  return (
    <span className="font-body-small text-muted-foreground">
      {step.mode === "adopt"
        ? "Adopting the theme as the design system."
        : "Proposing a design system from what the code uses."}
      {finished ? " Its tokens are in the Tokens view." : ""}
    </span>
  );
};

export const StepCard = ({
  index,
  last = false,
  later = false,
  open,
  position,
  step,
}: {
  index: number;
  /** The last of its list: no line runs on from it. */
  last?: boolean;
  /** Another step comes first, outside the setup: a step not started waits. */
  later?: boolean;
  /** Every step before it is done. */
  open: boolean;
  /** Where it is in the list it is drawn in, when that is not the setup's own order. */
  position?: number;
  step: SetupStep;
}) => {
  const definition = SETUP_STEPS[index];
  const inventory = useDesignSystemSetup((s) => s.inventory);
  const state = useStepState(step, open && !later);
  const [mode, setMode] = useState<DefineMode | null>(null);
  const chosen = mode ?? inventory?.recommendation.mode ?? "adopt";
  if (!definition) {
    return null;
  }
  const started = step.status !== "todo";
  const current = open && step.status !== "done";
  return (
    <StepFrame
      badge={<StepBadge label={state.label} tone={state.tone} />}
      index={position ?? index}
      last={last}
      title={definition.title}
      tone={state.tone}
    >
      {started && step.summary ? (
        <p className="whitespace-pre-line font-body-small">{step.summary}</p>
      ) : (
        <p className="font-body-small text-muted-foreground">
          {definition.description}
        </p>
      )}
      {step.id === "define" && !started && current ? (
        <ModeChoice chosen={chosen} onChange={setMode} />
      ) : null}
      {step.id === "define" && started ? <DefineNote step={step} /> : null}
      <StepActions current={current} index={index} mode={chosen} step={step} />
      {started ? <StepResult step={step} /> : null}
    </StepFrame>
  );
};

/**
 * Pinned under a thread that runs a step of the setup: which step, where it is, and the way back
 * to the steps, since the chat and the Design system panel share the rail.
 */
export const SetupStepBar = ({ threadId }: { threadId: string }) => {
  const loaded = useDesignSystemSetup((s) => s.loaded);
  const setup = useDesignSystemSetup((s) => s.setup);
  useEffect(() => {
    if (!loaded) {
      useDesignSystemSetup.getState().load();
    }
  }, [loaded]);
  const index = setup?.steps.findIndex(
    (s) => s.threadId === threadId && s.status !== "todo"
  );
  const step = index === undefined || index < 0 ? null : setup?.steps[index];
  if (!step || index === undefined) {
    return null;
  }
  return <StepBarFor index={index} step={step} />;
};

const StepBarFor = ({ index, step }: { index: number; step: SetupStep }) => {
  const state = useStepState(step, true);
  const title = SETUP_STEPS[index]?.title ?? step.id;
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b py-2 pr-2 pl-3">
      <StepMarker index={index} tone={state.tone} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-body-medium">{title}</span>
        <span className="truncate font-body-small text-muted-foreground">
          Design system setup{state.label ? ` · ${state.label}` : ""}
        </span>
      </div>
      <Button onClick={showSetup} size="sm" variant="outline">
        <ListChecks data-icon="inline-start" />
        Steps
      </Button>
    </div>
  );
};

/** What a step's thread shows before its first prompt, in place of the chat's starters. */
export const SetupStepIntro = ({ threadId }: { threadId: string }) => {
  const step = useDesignSystemSetup(
    (s) =>
      s.setup?.steps.find(
        (st) => st.threadId === threadId && st.status !== "todo"
      ) ?? null
  );
  if (!step) {
    return null;
  }
  const title = SETUP_STEPS.find((d) => d.id === step.id)?.title ?? step.id;
  const command = commandOf({ _tag: "SetupStep", step: step.id });
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="font-body-medium">{title} starts when you send</span>
      <span className="max-w-72 text-pretty font-body-small text-muted-foreground">
        <code className="font-code">{command}</code> is the step’s task; add to
        it if you like. The agent asks here when a decision is yours.
      </span>
      <Button
        onClick={() => openStepThread(threadId, `${command} `)}
        size="sm"
        variant="outline"
      >
        Write it in the composer
      </Button>
    </div>
  );
};
