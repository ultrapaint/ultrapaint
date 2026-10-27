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
import { cn } from "cn";
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
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Segmented } from "../components/segmented.tsx";
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

/** What a step's badge says: where it is, and for an agent's step, what its thread is doing. */
const useStepState = (step: SetupStep, open: boolean) => {
  const thread = useAgents((s) =>
    step.threadId ? s.threads.find((t) => t.id === step.threadId) : undefined
  );
  if (step.status === "done") {
    return { label: "Done", tone: "done" as const };
  }
  if (step.status === "review") {
    return { label: "To review", tone: "attention" as const };
  }
  if (step.status === "stopped") {
    return { label: "Stopped", tone: "muted" as const };
  }
  if (step.status === "active") {
    if (thread?.status === "running" || thread?.status === "starting") {
      return { label: "Working", tone: "working" as const };
    }
    return thread?.summary?.waiting
      ? { label: "Waiting for you", tone: "attention" as const }
      : { label: "Under way", tone: "working" as const };
  }
  return open
    ? { label: "Next", tone: "next" as const }
    : { label: "Later", tone: "muted" as const };
};

const StepMarker = ({
  index,
  status,
}: {
  index: number;
  status: SetupStep["status"];
}) => (
  <span
    className={cn(
      "flex size-5 shrink-0 items-center justify-center rounded-full border font-code",
      status === "done" &&
        "border-transparent bg-primary text-primary-foreground",
      (status === "active" || status === "review") &&
        "border-primary text-primary",
      status === "stopped" && "border-dashed text-muted-foreground",
      status === "todo" && "text-muted-foreground"
    )}
  >
    {status === "done" ? <Check className="size-3" /> : index + 1}
  </span>
);

type Tone = ReturnType<typeof useStepState>["tone"];

const badgeVariant = (tone: Tone) => {
  if (tone === "done") {
    return "secondary";
  }
  return tone === "muted" || tone === "next" ? "outline" : "default";
};

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
        <span className="font-body text-muted-foreground">
          {recommended.mode === chosen
            ? "Recommended: "
            : "The inventory recommends the other way: "}
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
  const definition = SETUP_STEPS[index];
  const next = SETUP_STEPS[index + 1];
  const started = step.status !== "todo";
  const setup = () => useDesignSystemSetup.getState();
  if (!definition) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {step.status === "todo" && current ? (
        <Button
          disabled={busy}
          onClick={() =>
            setup().start(step.id, step.id === "define" ? mode : undefined)
          }
          size="sm"
        >
          {busy ? <Spinner /> : <Play />}
          {definition.agent ? "Start with an agent" : "Run"}
        </Button>
      ) : null}
      {step.threadId && started ? (
        <Button
          onClick={() => openStepThread(step.threadId ?? "")}
          size="sm"
          variant="outline"
        >
          <MessageSquare />
          Thread
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
          variant={step.status === "review" ? "default" : "outline"}
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
          {shown ? "Hide what it found" : "Show what it found"}
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
    <span className="font-body text-muted-foreground">
      {step.mode === "adopt"
        ? "Adopting the theme as the design system."
        : "Proposing a design system from what the code uses."}
      {finished ? " Its tokens are in the Tokens view." : ""}
    </span>
  );
};

export const StepCard = ({
  index,
  later = false,
  open,
  position,
  step,
}: {
  index: number;
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
    <li
      className={cn(
        "flex gap-2.5 border-b px-3 py-3",
        !(open || started) && "opacity-60"
      )}
    >
      <StepMarker index={position ?? index} status={step.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-heading-xsmall">{definition.title}</span>
          <Badge
            className={cn(
              "ml-auto",
              state.tone === "working" && "bg-agent/15 text-agent",
              state.tone === "attention" && "bg-primary/15 text-primary"
            )}
            variant={badgeVariant(state.tone)}
          >
            {state.tone === "working" ? <Spinner /> : null}
            {state.label}
          </Badge>
        </div>
        {started && step.summary ? (
          <p className="whitespace-pre-line font-body">{step.summary}</p>
        ) : (
          <p className="font-body text-muted-foreground">
            {definition.description}
          </p>
        )}
        {step.id === "define" && !started && current ? (
          <ModeChoice chosen={chosen} onChange={setMode} />
        ) : null}
        {step.id === "define" && started ? <DefineNote step={step} /> : null}
        <StepActions
          current={current}
          index={index}
          mode={chosen}
          step={step}
        />
        {started ? <StepResult step={step} /> : null}
      </div>
    </li>
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
    <div className="flex shrink-0 items-center gap-2.5 border-b bg-muted/30 py-2 pr-2 pl-3">
      <StepMarker index={index} status={step.status} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-body text-muted-foreground">
          Design system setup
        </span>
        <span className="truncate font-semibold">
          {title} · {state.label}
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
      <span className="font-heading-xsmall">{title} starts when you send</span>
      <span className="font-body text-muted-foreground">
        <code className="font-code">{command}</code> is the step's task; add to
        it if you like. The agent asks you here when a decision is yours, and
        the step waits for you in the setup when it is done.
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
