import type { Page } from "@ultrapaint/contracts/pages";
import { X } from "lucide-react";
import { viewportSize } from "../lib/shortcuts.ts";
import { useAgents } from "../state/agents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const dismiss = () => useAgents.getState().clearChanged();

const goToPage = async (page: Page) => {
  const editor = useEditor.getState;
  if (editor().space !== page.space || !editor().frames[page.id]) {
    await editor().openSpace(page.space, page.route);
  }
  useAgents.getState().clearChanged([page.file]);
  if (editor().workspace === "prototype") {
    editor().navigate(page.route);
    return;
  }
  editor().selectPage(page.id);
  editor().zoomToSelection(viewportSize());
};

const goToChanges = () => {
  useEditor.getState().setLeftTab("changes");
  dismiss();
};

/**
 * Badge above the bottom strip when an agent turn changed files. Nothing moves on its own: a click
 * goes to the next changed page, and once none is left, to the Changes panel.
 */
export const AgentChanges = () => {
  const changed = useAgents((s) => s.changed);
  const pages = useProject((s) => s.pages);
  if (changed.length === 0) {
    return null;
  }
  const changedPages = pages.filter((p) => changed.includes(p.file));
  const [first] = changedPages;

  let label: string;
  if (first && changedPages.length === 1) {
    label = `Agent updated ${first.name}`;
  } else if (first) {
    label = `Agent updated ${changedPages.length} pages`;
  } else {
    label = `Agent changed ${changed.length} ${changed.length === 1 ? "file" : "files"}`;
  }
  const onClick = () => (first ? goToPage(first) : goToChanges());

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
