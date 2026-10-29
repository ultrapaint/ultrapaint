/**
 * The selection as the canvas, the inspector, the element toolbar and the layers read it. A
 * selection is of nodes of a page, and every view of the page shows it (ADR 0036): one rule says
 * whether a node is selected wherever it is drawn. It was made in one view, which it remembers
 * (`selection.frame`): that view's breakpoint is the one its fields are shown and edited at, and
 * its toolbar hangs there. A node's fields are read as the frame it is named in draws them, at the
 * breakpoint that frame's width falls in.
 *
 * Several selected share a frame: Shift-click in another view of the page adds the node and
 * takes the selection there, and the node acted on from another view takes it there too.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  type Breakpoint,
  breakpointAt,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { useShallow } from "zustand/react/shallow";
import { currentBreakpoints, useBreakpoints } from "./design-system.ts";
import {
  drawnRootOf,
  editedAtOf,
  isNodeFrame,
  isViewFrame,
  nodeIn,
  pageOfFrame,
  rootOfFrame,
  useDocuments,
} from "./documents.ts";
import { type EditorState, type Selection, useEditor } from "./editor.ts";

/** What is selected, as the editor holds it. */
type Picked = Pick<EditorState, "also" | "selection">;

const NONE: readonly string[] = [];

/**
 * Whether a selection made in `made` shows in `frame`: the same page, in any of its views. The
 * one rule of what is selected where.
 */
export const showsIn = (made: string, frame: string) =>
  pageOfFrame(made) === pageOfFrame(frame);

/**
 * The nodes selected as a frame shows them, the one the inspector shows first: those of the
 * selection when it is of the frame's page, made in whichever of its views; none otherwise.
 */
export const selectedIn = (
  frame: string,
  { also, selection }: Picked = useEditor.getState()
): readonly string[] =>
  selection && showsIn(selection.frame, frame)
    ? [selection.nodeId, ...also.map((a) => a.nodeId)]
    : NONE;

/** Whether a node a frame draws is selected, in this view of its page or another. */
export const isSelected = (
  frame: string,
  nodeId: string,
  { also, selection }: Picked = useEditor.getState()
): boolean =>
  selection !== null &&
  showsIn(selection.frame, frame) &&
  (selection.nodeId === nodeId || also.some((a) => a.nodeId === nodeId));

/** `selectedIn` for a component: the same list while the frame's selection stays the same. */
export const useSelectedIn = (frame: string): readonly string[] =>
  useEditor(useShallow((s) => selectedIn(frame, s)));

/** `isSelected` for a component. */
export const useIsSelected = (frame: string, nodeId: string): boolean =>
  useEditor((s) => isSelected(frame, nodeId, s));

/**
 * The selection taken to another view of its page, every node of it; null when `frame` shows
 * another page. A node acted on from a view takes the selection there.
 */
export const pickedIn = (frame: string, picked: Picked): Picked | null => {
  const { also, selection } = picked;
  if (!(selection && showsIn(selection.frame, frame))) {
    return null;
  }
  return selection.frame === frame
    ? picked
    : {
        also: also.map((a) => ({ ...a, frame })),
        selection: { ...selection, frame },
      };
};

/**
 * The frame a node named by its page's frame is looked at in: the view of that page the
 * selection is in, if it is in one, else the frame named. The layers panel names pages, not views.
 */
export const editedFrameOf = (
  selection: Selection | null,
  frame: string
): string =>
  selection &&
  isViewFrame(selection.frame) &&
  pageOfFrame(selection.frame) === frame
    ? selection.frame
    : frame;

// ---- The breakpoint a frame is drawn at ----

/** What a frame's breakpoint is read from: the frames, the documents and the breakpoints. */
interface Seen {
  readonly breakpoints: readonly Breakpoint[];
  readonly canvas: string | null;
  readonly docs: ReturnType<typeof useDocuments.getState>["docs"];
  readonly frames: EditorState["frames"];
}

const seenNow = (): Seen => ({
  breakpoints: currentBreakpoints(),
  canvas: useEditor.getState().canvas,
  docs: useDocuments.getState().docs,
  frames: useEditor.getState().frames,
});

/** The width a node on the canvas is drawn at: its own fixed width; the smallest screen's else. */
const fixedWidth = (root: DesignNode | null): number | undefined =>
  typeof root?.width === "number" ? root.width : undefined;

const nameAt = (
  breakpoints: readonly Breakpoint[],
  width: number | undefined
): string | null =>
  width === undefined ? null : (breakpointAt(breakpoints, width)?.name ?? null);

/**
 * The breakpoint a frame is drawn at (ADR 0036), by name; null at the base. A page's frame and
 * each view are drawn at their width, a node on the canvas at its own fixed width, and a frame
 * whose width is not known, or a node on the canvas sized by its content, at the base.
 */
export const frameBreakpoint = (
  frame: string,
  seen: Seen = seenNow()
): string | null =>
  // A component edited in place at one of its variants is shown and edited at that variant.
  editedAtOf(frame) ??
  nameAt(
    seen.breakpoints,
    isNodeFrame(frame)
      ? fixedWidth(drawnRootOf(seen.docs, seen.canvas, frame))
      : seen.frames[frame]?.width
  );

/** `frameBreakpoint` for a component; null without a frame. */
export const useFrameBreakpoint = (frame: string | null): string | null => {
  const breakpoints = useBreakpoints();
  const canvas = useEditor((s) => s.canvas);
  const pageWidth = useEditor((s) =>
    frame === null || isNodeFrame(frame) ? undefined : s.frames[frame]?.width
  );
  const nodeWidth = useDocuments((s) =>
    frame !== null && isNodeFrame(frame)
      ? fixedWidth(drawnRootOf(s.docs, canvas, frame))
      : undefined
  );
  const variant = useDocuments((s) =>
    s.edited !== null && s.edited.frame === frame ? s.edited.at : null
  );
  return variant ?? nameAt(breakpoints, pageWidth ?? nodeWidth);
};

// ---- Nodes as their view draws them ----

/** A node as a frame draws it: its fields at the frame's breakpoint. */
export const asDrawnIn = (node: DesignNode, frame: string): DesignNode =>
  resolveAtBreakpoint(node, currentBreakpoints(), frameBreakpoint(frame));

/**
 * A node as the frame it is looked at in draws it (`editedFrameOf`), for what is drawn of it
 * outside the canvas: a layers row's eye and lock.
 */
export const useDrawnIn = (node: DesignNode, frame: string): DesignNode => {
  const breakpoints = useBreakpoints();
  const at = useFrameBreakpoint(
    useEditor((s) => editedFrameOf(s.selection, frame))
  );
  return resolveAtBreakpoint(node, breakpoints, at);
};

/** The nodes named that are still there, as the frame they are named in draws them. */
const drawnAt = (
  targets: readonly Selection[],
  docs: Seen["docs"],
  canvas: string | null,
  breakpoints: readonly Breakpoint[],
  at: string | null
): DesignNode[] =>
  targets.flatMap((t) => {
    const node = nodeIn(docs, canvas, t.frame, t.nodeId);
    return node ? [resolveAtBreakpoint(node, breakpoints, at)] : [];
  });

/**
 * The nodes named, as their frame draws them: a selection's, all of one frame. The element
 * toolbar shows their values, which are those of its view.
 */
export const drawnNodes = (
  targets: readonly Selection[],
  seen: Seen = seenNow()
): DesignNode[] => {
  const [first] = targets;
  return first
    ? drawnAt(
        targets,
        seen.docs,
        seen.canvas,
        seen.breakpoints,
        frameBreakpoint(first.frame, seen)
      )
    : [];
};

/** `drawnNodes` for a component: the same list while the nodes stay the same. */
export const useDrawnNodes = (
  targets: readonly Selection[]
): readonly DesignNode[] => {
  const breakpoints = useBreakpoints();
  const canvas = useEditor((s) => s.canvas);
  const at = useFrameBreakpoint(targets[0]?.frame ?? null);
  return useDocuments(
    useShallow((s) => drawnAt(targets, s.docs, canvas, breakpoints, at))
  );
};

// ---- What the inspector is about ----

/** The nodes the inspector is about, in the frame it shows them as. */
export interface Inspected {
  /** The view the selection was made in: the breakpoint its fields are shown and edited at. */
  readonly frame: string;
  /** The one it shows first. */
  readonly node: DesignNode;
  readonly nodes: readonly DesignNode[];
}

type Inspecting = Pick<EditorState, "also" | "selectedPage" | "selection">;

/** The view a selection was made in, or the page selected as a whole; null when neither. */
const inspectedFrame = (s: Inspecting) => s.selection?.frame ?? s.selectedPage;

const inspectedNodes = (
  s: Inspecting,
  docs: Seen["docs"],
  canvas: string | null,
  breakpoints: readonly Breakpoint[],
  at: string | null
): DesignNode[] => {
  if (s.selection) {
    return drawnAt([s.selection, ...s.also], docs, canvas, breakpoints, at);
  }
  const root = s.selectedPage
    ? rootOfFrame(docs, canvas, s.selectedPage)
    : null;
  return root ? [resolveAtBreakpoint(root, breakpoints, at)] : [];
};

const inspectedOf = (
  frame: string | null,
  nodes: readonly DesignNode[]
): Inspected | null => {
  const [node] = nodes;
  return node && frame !== null ? { frame, node, nodes } : null;
};

/**
 * What the inspector is about: every node selected, the one it shows first leading, or the root
 * of the page selected as a whole; as the view the selection was made in draws them.
 */
export const inspected = (seen: Seen = seenNow()): Inspected | null => {
  const s = useEditor.getState();
  const frame = inspectedFrame(s);
  const at = frame === null ? null : frameBreakpoint(frame, seen);
  return inspectedOf(
    frame,
    inspectedNodes(s, seen.docs, seen.canvas, seen.breakpoints, at)
  );
};

/** `inspected` for a component. */
export const useInspected = (): Inspected | null => {
  const picked = useEditor(
    useShallow((s) => ({
      also: s.also,
      selectedPage: s.selectedPage,
      selection: s.selection,
    }))
  );
  const canvas = useEditor((s) => s.canvas);
  const breakpoints = useBreakpoints();
  const frame = inspectedFrame(picked);
  const at = useFrameBreakpoint(frame);
  const nodes = useDocuments(
    useShallow((s) => inspectedNodes(picked, s.docs, canvas, breakpoints, at))
  );
  return inspectedOf(frame, nodes);
};
