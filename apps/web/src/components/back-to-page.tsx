/**
 * The way from a board view back to the page canvas as it was left (ADR 0045), at the top of the
 * panel a board view is navigated from: named for the page left, or its canvas when it was on none.
 */
import { ArrowLeft } from "lucide-react";
import { leaveBoard } from "../state/board.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const back = () => leaveBoard();

export const BackToPage = () => {
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  const name = useProject(
    (s) =>
      s.pages.find((p) => p.id === activePage)?.name ??
      s.canvases.find((c) => c.id === canvas)?.name ??
      "the canvas"
  );
  return (
    <button
      className="flex h-9 w-full shrink-0 items-center gap-2 border-b px-3 text-left font-body text-muted-foreground hover:text-foreground"
      onClick={back}
      type="button"
    >
      <ArrowLeft className="size-3.5 shrink-0" />
      <span className="truncate">Back to {name}</span>
    </button>
  );
};
