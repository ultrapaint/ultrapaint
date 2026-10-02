import {
  FilePlus2,
  FileUp,
  Frame,
  type LucideIcon,
  Shapes,
  Sparkles,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { openSetup } from "../components/setup-dialog.tsx";
import { newCanvas } from "../lib/canvas-actions.ts";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { newPage } from "../lib/page-actions.ts";
import { useEditor, type Workspace } from "../state/editor.ts";
import { openLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

interface Action {
  icon: LucideIcon;
  label: string;
  run: () => unknown;
}

const askAgent: Action = {
  icon: Sparkles,
  label: "Ask an agent",
  run: () => openLeftPanel("chat"),
};
const addPage: Action = { icon: FilePlus2, label: "New page", run: newPage };
const importFigma: Action = {
  icon: FileUp,
  label: "Import a Figma file…",
  run: pickFigmaFile,
};
const openAssets: Action = {
  icon: Shapes,
  label: "Open assets",
  run: () => openLeftPanel("assets"),
};
const addCanvas: Action = {
  icon: Frame,
  label: "New canvas…",
  run: newCanvas,
};

/**
 * What an empty canvas says, and the ways from it to a first page. Each workspace leads with its
 * own way of working: Vibe with the agent, Design with a page drawn by hand. The first action is
 * the one the workspace is for.
 */
const contentFor = (
  workspace: Workspace,
  canvas: string | null
): { actions: readonly Action[]; text: string; title: string } => {
  if (canvas === null) {
    return {
      actions: [addCanvas, importFigma, askAgent],
      text: "A canvas holds the pages of one part of the app. Start one, bring in a Figma file, or have an agent draw it.",
      title: "No canvas yet",
    };
  }
  if (workspace === "design") {
    return {
      actions: [addPage, openAssets, importFigma, askAgent],
      text: "Add a page, or drag a component or an image onto the canvas.",
      title: "Nothing on this canvas yet",
    };
  }
  return {
    actions: [askAgent, addPage, importFigma],
    text: "Describe a page to an agent and it draws it here, or start one yourself.",
    title: "Nothing on this canvas yet",
  };
};

// The buttons sit on the canvas: a press on them is theirs, not the start of a pan or a marquee.
const keepFromCanvas = (e: ReactPointerEvent) => e.stopPropagation();

/**
 * Shown over a canvas with nothing on it, centred in the part the side panels leave to be seen.
 * The rest of it lets the pointer through, so the canvas still takes a drop or a pan around it.
 */
export const EmptyState = () => {
  const configured = useProject((s) => s.info.configured);
  const canvas = useEditor((s) => s.canvas);
  const workspace = useEditor((s) => s.workspace);
  const { actions, text, title } = contentFor(workspace, canvas);
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{
        paddingLeft: "var(--cover-left, 0px)",
        paddingRight: "var(--cover-right, 0px)",
      }}
    >
      {configured ? (
        <div
          className="pointer-events-auto flex max-w-xl flex-col items-center gap-4 p-6 text-center"
          onPointerDown={keepFromCanvas}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="font-medium">{title}</span>
            <span className="max-w-xs text-balance font-body text-muted-foreground">
              {text}
            </span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {actions.map(({ icon: Icon, label, run }, i) => (
              <Button
                key={label}
                onClick={() => run()}
                size="sm"
                variant={i === 0 ? "default" : "outline"}
              >
                <Icon />
                {label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <span className="pointer-events-auto flex items-center gap-2 text-muted-foreground">
          No repository set up yet.
          <Button onClick={openSetup} size="sm" variant="outline">
            Set up…
          </Button>
        </span>
      )}
    </div>
  );
};
