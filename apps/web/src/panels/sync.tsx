/**
 * The Design system panel's Sync view (ADR 0025): the case the project is in, and the steps that
 * bring the design system and the code together, in order. The setup's steps (ADR 0023) are
 * drawn as they always were; the sync's own — the settings, DESIGN.md at the root and its tokens,
 * describing what changed, Figma's tokens and frames, a new application — around them.
 */
import { SETUP_STEPS } from "@ultrapaint/contracts/design-system-setup";
import { stylesheetOf } from "@ultrapaint/contracts/setup";
import type { SyncPlan, SyncStep } from "@ultrapaint/contracts/sync";
import { ChevronLeft, FileText, FileUp, RefreshCw, Wand2 } from "lucide-react";
import type * as React from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { placeDocument } from "../lib/place-document.ts";
import { detect, save } from "../lib/settings-actions.ts";
import { startTask } from "../lib/start-thread.ts";
import { useAgents } from "../state/agents.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { reportError, useProject } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import {
  StepBadge,
  StepCard,
  StepFrame,
  type StepTone,
  useStepVariant,
} from "./design-system-setup.tsx";
import { CodeTokensStep } from "./sync-code.tsx";
import { ScaffoldButton } from "./sync-scaffold.tsx";
import { TokensStep } from "./sync-tokens.tsx";

/** The source a step's tokens are compared from. */
const TOKEN_STEP_SOURCES = {
  "design-tokens": "designMd",
  "figma-tokens": "figma",
} as const;

/** How a step of the sync's own is drawn: where it stands, as a step of the setup is. */
const TONES: Record<SyncStep["state"], StepTone> = {
  active: "working",
  attention: "current",
  done: "done",
  todo: "later",
};

/** A step of the sync's own, laid out as the setup's steps are. */
const SyncCard = ({
  children,
  index,
  last,
  step,
}: {
  children?: React.ReactNode;
  index: number;
  last: boolean;
  step: SyncStep;
}) => {
  const tone = TONES[step.state];
  const optional = step.optional && step.state !== "done";
  let label: string | null = null;
  if (step.state === "active") {
    label = "Under way";
  } else if (optional) {
    label = "Optional";
  }
  return (
    <StepFrame
      badge={<StepBadge label={label} tone={tone} />}
      index={index}
      last={last}
      title={step.title}
      tone={tone}
    >
      <p className="whitespace-pre-line text-pretty font-small text-muted-foreground">
        {step.detail}
      </p>
      {children}
    </StepFrame>
  );
};

/**
 * Detection run again and its proposal shown before anything is applied: where the stylesheets
 * and the application are. The designs directory stays.
 */
const applyDetected = async () => {
  const { settings } = useProject.getState();
  if (!settings) {
    return;
  }
  try {
    const detection = await detect(settings.repoPath, {
      keepDesignsDir: true,
    });
    const next = detection.onto(settings);
    const stylesheets = next.hostCss.map((spec) =>
      stylesheetOf(next.designsDir, spec)
    );
    const lines = [
      `Stylesheets: ${stylesheets.join(", ") || "none found"}`,
      `Application: ${next.resolveFrom ?? settings.designsDir}`,
    ];
    const ok = await confirmDialog({
      confirmLabel: "Apply settings",
      description: lines.join("\n"),
      title: "Use what detection found?",
    });
    if (!ok) {
      return;
    }
    const problems = await save(next);
    if (problems.length === 0) {
      toast.success("Settings applied", {
        description: "The editor reads your code again.",
      });
    } else {
      toast.error(problems.join(" "));
    }
  } catch (error) {
    reportError(error);
  }
};

const openSettings = () =>
  useProject.getState().openSettings(true, "repository");

interface StepProps {
  index: number;
  last: boolean;
  step: SyncStep;
}

/** The main action of a step: the primary on the step to take now. */
const MainButton = (props: React.ComponentProps<typeof Button>) => (
  <Button size="sm" variant={useStepVariant()} {...props} />
);

const SettingsStep = (props: StepProps) => (
  <SyncCard {...props}>
    <div className="flex flex-wrap gap-1.5">
      <MainButton onClick={applyDetected}>
        <Wand2 />
        Detect and apply
      </MainButton>
      <Button onClick={openSettings} size="sm" variant="ghost">
        Open settings
      </Button>
    </div>
  </SyncCard>
);

const DocumentStep = (props: StepProps) => (
  <SyncCard {...props}>
    {props.step.state === "done" ? null : (
      <div className="flex flex-wrap gap-1.5">
        <MainButton onClick={placeDocument}>
          <FileText />
          {props.step.title.startsWith("Move")
            ? "Move DESIGN.md"
            : "Write DESIGN.md"}
        </MainButton>
      </div>
    )}
  </SyncCard>
);

const DescribeStep = (props: StepProps) => (
  <SyncCard {...props}>
    {props.step.state === "done" ? null : (
      <div className="flex flex-wrap gap-1.5">
        <MainButton
          onClick={() => startTask({ _tag: "Sync", source: "describe" })}
        >
          <Wand2 />
          Describe with an agent
        </MainButton>
      </div>
    )}
  </SyncCard>
);

const FramesStep = ({ plan, ...props }: StepProps & { plan: SyncPlan }) => {
  const { figma } = plan.facts;
  return (
    <SyncCard {...props}>
      <div className="flex flex-wrap gap-1.5">
        {figma ? (
          <MainButton
            onClick={() => startTask({ _tag: "ImportFigma", file: figma.id })}
          >
            <Wand2 />
            Map and write the pages
          </MainButton>
        ) : null}
        <Button onClick={pickFigmaFile} size="sm" variant="outline">
          <FileUp />
          {figma ? "Import a newer file…" : "Import a Figma file…"}
        </Button>
      </div>
    </SyncCard>
  );
};

/** One step of the plan: the setup's own card for a setup step, the sync's for the rest. */
const PlanStep = ({
  index,
  plan,
  step,
}: {
  index: number;
  plan: SyncPlan;
  step: SyncStep;
}) => {
  const setup = useDesignSystemSetup((s) => s.setup);
  const last = index === plan.steps.length - 1;
  const setupIndex = SETUP_STEPS.findIndex((s) => s.id === step.kind);
  if (setupIndex !== -1) {
    const setupStep = setup?.steps[setupIndex];
    if (!(setup && setupStep)) {
      return null;
    }
    const firstOpen = setup.steps.findIndex((s) => s.status !== "done");
    // A step of the sync's own before it is waiting (Figma's tokens, the settings).
    const waiting = plan.steps.findIndex(
      (s) => s.state === "attention" || s.state === "active"
    );
    return (
      <StepCard
        index={setupIndex}
        last={last}
        later={waiting !== -1 && waiting < index}
        open={firstOpen === -1 || setupIndex <= firstOpen}
        position={index}
        step={setupStep}
      />
    );
  }
  const props = { index, last, step };
  if (step.kind === "settings") {
    return <SettingsStep {...props} />;
  }
  if (step.kind === "describe") {
    return <DescribeStep {...props} />;
  }
  if (step.kind === "design-md") {
    return <DocumentStep {...props} />;
  }
  if (step.kind === "import-frames") {
    return <FramesStep {...props} plan={plan} />;
  }
  if (step.kind === "figma-tokens" || step.kind === "design-tokens") {
    return (
      <SyncCard {...props}>
        <TokensStep plan={plan} source={TOKEN_STEP_SOURCES[step.kind]} />
      </SyncCard>
    );
  }
  if (step.kind === "code-tokens") {
    return (
      <SyncCard {...props}>
        <CodeTokensStep plan={plan} />
      </SyncCard>
    );
  }
  return (
    <SyncCard {...props}>
      <ScaffoldButton />
    </SyncCard>
  );
};

export const SyncView = ({
  onBack,
}: {
  /** Back to the tokens, when there are any to go back to. */
  onBack?: () => void;
}) => {
  const plan = useSync((s) => s.plan);
  const reading = useSync((s) => s.reading);
  const setupLoaded = useDesignSystemSetup((s) => s.loaded);

  useEffect(() => {
    useSync.getState().load();
    if (!useDesignSystemSetup.getState().loaded) {
      useDesignSystemSetup.getState().load();
    }
    // The setup's badges follow their steps' threads.
    if (useAgents.getState().threads.length === 0) {
      useAgents.getState().load();
    }
  }, []);

  if (!(plan && setupLoaded)) {
    return (
      <PanelEmpty icon={<Spinner />} title="Reading the project…">
        The design system, the code and DESIGN.md are compared.
      </PanelEmpty>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col border-b pb-3">
        <div className="flex h-11 items-center gap-1 px-3">
          {onBack ? (
            <IconButton className="-ml-1.5" onClick={onBack} tooltip="Tokens">
              <ChevronLeft />
            </IconButton>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-heading-xsmall">Sync</h2>
          <IconButton
            className="-mr-1.5"
            disabled={reading}
            onClick={() => useSync.getState().load()}
            tooltip="Read the project again"
          >
            {reading ? <Spinner /> : <RefreshCw />}
          </IconButton>
        </div>
        <p className="text-pretty px-3 font-small text-muted-foreground">
          {plan.summary}
        </p>
        {plan.facts.figma ? null : (
          <div className="mx-2 mt-3 flex items-center gap-2 rounded-lg bg-muted py-2 pr-2 pl-3">
            <span className="min-w-0 flex-1 text-pretty font-small text-muted-foreground">
              A Figma file’s variables and styles can become your tokens.
            </span>
            <Button onClick={pickFigmaFile} size="sm" variant="outline">
              <FileUp />
              Import…
            </Button>
          </div>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-auto py-1">
        {plan.steps.map((step, index) => (
          <PlanStep index={index} key={step.kind} plan={plan} step={step} />
        ))}
      </ol>
    </div>
  );
};
