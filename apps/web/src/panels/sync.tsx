/**
 * The Design system panel's Sync view (ADR 0025): the case the project is in, and the steps that
 * bring the design system and the code together, in order. The setup's steps (ADR 0023) are
 * drawn as they always were; the sync's own — the settings, DESIGN.md at the root and its tokens,
 * describing what changed, Figma's tokens and frames, a new application — around them.
 */
import { SETUP_STEPS } from "@ultrapaint/contracts/design-system-setup";
import { stylesheetOf } from "@ultrapaint/contracts/setup";
import type { SyncPlan, SyncStep } from "@ultrapaint/contracts/sync";
import { plural } from "@ultrapaint/shared/text";
import { cn } from "cn";
import {
  Check,
  ChevronLeft,
  FileText,
  FileUp,
  RefreshCw,
  Settings2,
  Wand2,
} from "lucide-react";
import type * as React from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { api } from "../state/connection.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { reportError, useProject } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import { StepCard } from "./design-system-setup.tsx";
import { CodeTokensStep } from "./sync-code.tsx";
import { ScaffoldButton } from "./sync-scaffold.tsx";
import { TokensStep } from "./sync-tokens.tsx";

/** The source a step's tokens are compared from. */
const TOKEN_STEP_SOURCES = {
  "design-tokens": "designMd",
  "figma-tokens": "figma",
} as const;

const STATE_LABELS: Record<SyncStep["state"], string> = {
  active: "Under way",
  attention: "Next",
  done: "Done",
  todo: "Later",
};

/** A step of the sync's own, laid out as the setup's steps are. */
const SyncCard = ({
  children,
  index,
  step,
}: {
  children?: React.ReactNode;
  index: number;
  step: SyncStep;
}) => (
  <li
    className={cn(
      "flex gap-2.5 border-b px-3 py-3",
      step.state === "todo" && "opacity-60"
    )}
  >
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border font-code",
        step.state === "done" &&
          "border-transparent bg-primary text-primary-foreground",
        (step.state === "attention" || step.state === "active") &&
          "border-primary text-primary",
        step.state === "todo" && "text-muted-foreground"
      )}
    >
      {step.state === "done" ? <Check className="size-3" /> : index + 1}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-heading-xsmall">{step.title}</span>
        <Badge
          className={cn(
            "ml-auto",
            step.state === "attention" && "bg-primary/15 text-primary"
          )}
          variant={step.state === "attention" ? "default" : "outline"}
        >
          {step.optional && step.state !== "done"
            ? "Optional"
            : STATE_LABELS[step.state]}
        </Badge>
      </div>
      <p className="whitespace-pre-line font-body text-muted-foreground">
        {step.detail}
      </p>
      {children}
    </div>
  </li>
);

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
      confirmLabel: "Apply",
      description: `Detection proposes:\n${lines.join("\n")}`,
      title: "Point ultrapaint at your code?",
    });
    if (!ok) {
      return;
    }
    const problems = await save(next);
    if (problems.length === 0) {
      toast.success("Settings applied: the editor reads your code again.");
    } else {
      toast.error(problems.join(" "));
    }
  } catch (error) {
    reportError(error);
  }
};

const openSettings = () =>
  useProject.getState().openSettings(true, "repository");

const SettingsStep = ({ index, step }: { index: number; step: SyncStep }) => (
  <SyncCard index={index} step={step}>
    <div className="flex flex-wrap gap-1.5">
      <Button onClick={applyDetected} size="sm">
        <Wand2 />
        Detect and apply
      </Button>
      <Button onClick={openSettings} size="sm" variant="outline">
        <Settings2 />
        Settings
      </Button>
    </div>
  </SyncCard>
);

/** Brings the designs from before up to date, in one undo step (ADRs 0040, 0041). */
const bringUpToDate = async () => {
  try {
    const { components, documents, drawn } = await api().request(
      "migration.run",
      undefined
    );
    toast.success(
      [
        drawn > 0
          ? `${plural(drawn, "instance")} in ${plural(documents, "document")} drawn as now`
          : null,
        components > 0
          ? `${plural(components, "component")} in components/`
          : null,
      ]
        .filter(Boolean)
        .join(", ") || "Nothing was left to bring up to date."
    );
  } catch (error) {
    reportError(error);
  }
  useSync.getState().load();
};

const SystemComponentsStep = ({
  index,
  step,
}: {
  index: number;
  step: SyncStep;
}) => (
  <SyncCard index={index} step={step}>
    <div className="flex flex-wrap gap-1.5">
      <Button onClick={bringUpToDate} size="sm">
        <Wand2 />
        Bring them up to date
      </Button>
    </div>
  </SyncCard>
);

const DocumentStep = ({ index, step }: { index: number; step: SyncStep }) => (
  <SyncCard index={index} step={step}>
    {step.state === "done" ? null : (
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={placeDocument} size="sm">
          <FileText />
          {step.title.startsWith("Move") ? "Move it" : "Write it"}
        </Button>
      </div>
    )}
  </SyncCard>
);

const DescribeStep = ({ index, step }: { index: number; step: SyncStep }) => (
  <SyncCard index={index} step={step}>
    {step.state === "done" ? null : (
      <div className="flex flex-wrap gap-1.5">
        <Button
          onClick={() => startTask({ _tag: "Sync", source: "describe" })}
          size="sm"
        >
          <Wand2 />
          Describe with an agent
        </Button>
      </div>
    )}
  </SyncCard>
);

const FramesStep = ({
  index,
  plan,
  step,
}: {
  index: number;
  plan: SyncPlan;
  step: SyncStep;
}) => {
  const { figma } = plan.facts;
  return (
    <SyncCard index={index} step={step}>
      <div className="flex flex-wrap gap-1.5">
        {figma ? (
          <Button
            onClick={() => startTask({ _tag: "ImportFigma", file: figma.id })}
            size="sm"
          >
            <Wand2 />
            Map and write the pages
          </Button>
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
        later={waiting !== -1 && waiting < index}
        open={firstOpen === -1 || setupIndex <= firstOpen}
        position={index}
        step={setupStep}
      />
    );
  }
  if (step.kind === "settings") {
    return <SettingsStep index={index} step={step} />;
  }
  if (step.kind === "system") {
    return <SystemComponentsStep index={index} step={step} />;
  }
  if (step.kind === "describe") {
    return <DescribeStep index={index} step={step} />;
  }
  if (step.kind === "design-md") {
    return <DocumentStep index={index} step={step} />;
  }
  if (step.kind === "import-frames") {
    return <FramesStep index={index} plan={plan} step={step} />;
  }
  if (step.kind === "figma-tokens" || step.kind === "design-tokens") {
    return (
      <SyncCard index={index} step={step}>
        <TokensStep plan={plan} source={TOKEN_STEP_SOURCES[step.kind]} />
      </SyncCard>
    );
  }
  if (step.kind === "code-tokens") {
    return (
      <SyncCard index={index} step={step}>
        <CodeTokensStep plan={plan} />
      </SyncCard>
    );
  }
  return (
    <SyncCard index={index} step={step}>
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
    return <PanelEmpty>Reading the project…</PanelEmpty>;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-1 border-b px-1.5 py-1.5">
        {onBack ? (
          <IconButton onClick={onBack} tooltip="Tokens">
            <ChevronLeft />
          </IconButton>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col px-1.5">
          <span className="font-heading-xsmall">Sync</span>
          <span className="font-body text-muted-foreground">
            {plan.summary}
          </span>
        </div>
        <IconButton
          disabled={reading}
          onClick={() => useSync.getState().load()}
          tooltip="Read the project again"
        >
          {reading ? <Spinner /> : <RefreshCw />}
        </IconButton>
      </div>
      {plan.facts.figma ? null : (
        <div className="flex items-center gap-2 border-b px-3 py-2 font-body">
          <span className="min-w-0 flex-1 text-muted-foreground">
            Have a Figma file? Its variables and styles become your tokens.
          </span>
          <Button onClick={pickFigmaFile} size="sm" variant="outline">
            <FileUp />
            Import…
          </Button>
        </div>
      )}
      <ol className="min-h-0 flex-1 overflow-auto">
        {plan.steps.map((step, index) => (
          <PlanStep index={index} key={step.kind} plan={plan} step={step} />
        ))}
      </ol>
    </div>
  );
};
