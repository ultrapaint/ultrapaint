import type { Screen } from "@ultrapaint/contracts/screens";
import { X } from "lucide-react";
import { viewportSize } from "../lib/shortcuts.ts";
import { useAgents } from "../state/agents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const dismiss = () => useAgents.getState().clearChanged();

const goToScreen = async (screen: Screen) => {
  const editor = useEditor.getState;
  if (editor().flow !== screen.flow || !editor().frames[screen.id]) {
    await editor().openFlow(screen.flow);
  }
  useAgents.getState().clearChanged([screen.file]);
  if (editor().workspace === "prototype") {
    editor().setActiveScreen(screen.id);
    return;
  }
  editor().selectScreen(screen.id);
  editor().zoomToSelection(viewportSize());
};

const goToChanges = () => {
  useEditor.getState().setLeftTab("changes");
  dismiss();
};

/**
 * Badge above the bottom strip when an agent turn changed files. Nothing moves on its own: a click
 * goes to the next changed screen, and once none is left, to the Changes panel.
 */
export const AgentChanges = () => {
  const changed = useAgents((s) => s.changed);
  const screens = useProject((s) => s.screens);
  if (changed.length === 0) {
    return null;
  }
  const changedScreens = screens.filter((s) => changed.includes(s.file));
  const [first] = changedScreens;

  let label: string;
  if (first && changedScreens.length === 1) {
    label = `Agent updated ${first.name}`;
  } else if (first) {
    label = `Agent updated ${changedScreens.length} screens`;
  } else {
    label = `Agent changed ${changed.length} ${changed.length === 1 ? "file" : "files"}`;
  }
  const onClick = () => (first ? goToScreen(first) : goToChanges());

  return (
    <div className="pointer-events-auto flex h-7 items-center rounded-full border bg-sidebar text-sidebar-foreground text-xs shadow-black/30 shadow-lg">
      <button
        className="flex h-full items-center gap-2 rounded-l-full pr-2 pl-3 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onClick}
        title={first ? `Show ${first.name}` : "Show the changes"}
        type="button"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-brand" />
        {label}
      </button>
      <button
        aria-label="Dismiss"
        className="flex h-full items-center rounded-r-full pr-2 pl-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5"
        onClick={dismiss}
        type="button"
      >
        <X />
      </button>
    </div>
  );
};
