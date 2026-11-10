/**
 * Undo and Redo, in the tools' row. Each names the step it would take in its tooltip. One whose
 * history was dropped (a file changed outside the editor) says why instead, for as long as it has
 * nothing to step to: it can then be pointed at and focused, and does nothing.
 */
import { Redo2, Undo2 } from "lucide-react";
import { IconButton } from "../components/icon-button.tsx";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import { undoOrRedo } from "../lib/shortcuts.ts";
import { useProject } from "../state/project.ts";

type Step = "undo" | "redo";

const STEPS = {
  redo: { icon: <Redo2 />, name: "Redo", run: () => undoOrRedo(true) },
  undo: { icon: <Undo2 />, name: "Undo", run: () => undoOrRedo(false) },
} as const;

const StepButton = ({ step }: { step: Step }) => {
  const state = useProject((s) => s.undo);
  const { icon, name, run } = STEPS[step];
  const can = step === "undo" ? state.canUndo : state.canRedo;
  const label = step === "undo" ? state.undoLabel : state.redoLabel;
  const dropped =
    !can && state.invalidated?.history === step
      ? `Nothing to ${step}: ${state.invalidated.reason}`
      : undefined;
  return (
    <IconButton
      aria-description={dropped}
      // Dimmed as a disabled button is, which this one is not to the browser while it says why.
      className="size-8 rounded-lg aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
      disabled={!can}
      focusableWhenDisabled={dropped !== undefined}
      label={label ? `${name} ${label}` : name}
      onClick={run}
      side="top"
      tooltip={
        dropped ? (
          <span className="wrap-anywhere min-w-0">{dropped}</span>
        ) : (
          <>
            {name}
            {label ? ` · ${label}` : ""} <CommandKeys id={step} />
          </>
        )
      }
    >
      {icon}
    </IconButton>
  );
};

export const UndoRedo = () => (
  <>
    <StepButton step="undo" />
    <StepButton step="redo" />
  </>
);
