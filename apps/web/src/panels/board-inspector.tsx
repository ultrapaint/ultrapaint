/**
 * The right panel on a board view (ADR 0045, B7): the inspector of the item open and of what is
 * picked on its boards, in the place of Design, Code and Comments. The shell's (Phase 4): it says
 * what is open and what is picked; a token's, a cell's and an app component's fields come with
 * their boards.
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import { OVERVIEW } from "../boards/library-boards.ts";
import { useItemName } from "../canvas/board-canvas.tsx";
import { HideRightPanel } from "../components/title-bar.tsx";
import { type BoardPlace, pickOf, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";

/** What the item open is, under its name. */
const useKind = (open: BoardPlace) => {
  const app = useComponents((s) =>
    s.catalogue.some((c) => c.name === open.item && c.importFrom === APP_FROM)
  );
  if (open.view === "system") {
    return open.item.startsWith("guide-") ? "Guideline" : "Foundation";
  }
  if (open.item === OVERVIEW) {
    return "Every component";
  }
  return app ? "App component" : "System component";
};

/** What a click on the item's boards picks, said before anything is. */
const hintOf = (open: BoardPlace) => {
  if (open.view === "system") {
    return "Pick a token on the board to see it here.";
  }
  return open.item === OVERVIEW
    ? "Click a component to open its board."
    : "Pick a cell of the board to see it here.";
};

/** A picked node's id says what it stands for: `token:color-primary` is the token. */
const pickedName = (nodeId: string) => {
  const at = nodeId.indexOf(":");
  return { kind: nodeId.slice(0, at), name: nodeId.slice(at + 1) };
};

export const BoardInspector = ({ open }: { open: BoardPlace }) => {
  const pick = useBoard(pickOf);
  const kind = useKind(open);
  const name = useItemName(open);
  const picked = pick ? pickedName(pick.nodeId) : null;
  const title = picked?.name ?? name;
  const subtitle = picked ? `${picked.kind} of ${name}` : kind;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{title}</span>
          <span className="truncate font-body text-muted-foreground">
            {subtitle}
          </span>
        </div>
        <HideRightPanel />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-body text-muted-foreground">
        {picked ? null : hintOf(open)}
      </div>
    </div>
  );
};
