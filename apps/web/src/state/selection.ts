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
  nodeIn,
  pathIn,
  rootOfFrame,
  useDocuments,
} from "./documents.ts";
import { type EditorState, type Selection, useEditor } from "./editor.ts";
import { frameRefOf, ownFrameOf, widthOf } from "./frame-ref.ts";
import { followFrame } from "./location.ts";
import { surfaceNow } from "./surface.ts";

/** What is selected, as the editor holds it. */
type Picked = Pick<EditorState, "also" | "selection">;

const NONE: readonly string[] = [];

/**
 * Whether a selection made in `made` shows in `frame`: the same page, in any of its views. The
 * one rule of what is selected where.
 */
const showsIn = (made: string, frame: string) =>
  ownFrameOf(made) === ownFrameOf(frame);

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
): string => {
  const ref = selection ? frameRefOf(selection.frame) : null;
  return ref?.kind === "view" && ref.page === frame && selection
    ? selection.frame
    : frame;
};

// ---- Changing it ----

/**
 * Nothing shows a selection in the prototype, and the main area takes one only in frames of its
 * own that can hold one: a board view only in an app component's tree, on its board (ADR 0045).
 */
const hidesSelection = (frame: string) =>
  useEditor.getState().workspace === "prototype" ||
  !surfaceNow().takesSelection(frame);

/**
 * Selects a node, or nothing; the editor follows the frame it is in to its page, and on a board
 * the tree it is in is edited in place there.
 */
export const select = (selection: Selection | null) => {
  if (selection && hidesSelection(selection.frame)) {
    return;
  }
  useEditor.setState({ also: [], selection });
  if (selection) {
    followFrame(selection.frame);
    surfaceNow().selectedIn(selection.frame);
  }
};

/**
 * Several nodes of one frame at once, the first of them the one the inspector shows: those the
 * first's frame shows, taken there.
 */
export const selectMany = (selections: readonly Selection[]) => {
  const [first, ...rest] = selections;
  if (!first || hidesSelection(first.frame)) {
    select(null);
    return;
  }
  select(first);
  const frame = useEditor.getState().selection?.frame ?? first.frame;
  useEditor.setState({
    also: rest
      .filter((s) => showsIn(first.frame, s.frame))
      .map((s) => ({ ...s, frame })),
  });
};

/**
 * A page selected as a whole, which is its root selected (ADR 0075), in the frame given: a view's
 * frame selects it at that view's breakpoint. Nothing when the page cannot be read, or for none.
 */
export const selectPage = (frame: string | null) => {
  if (frame === null) {
    select(null);
    return;
  }
  const { canvas } = useEditor.getState();
  const root = rootOfFrame(useDocuments.getState().docs, canvas, frame);
  if (root?.type === "page") {
    select({ frame, nodeId: root.id });
  }
};

/**
 * The page whose root is selected, by its own frame: the page selected as a whole. Null when the
 * selection is of anything else.
 */
export const selectedPageOf = (
  selection: Selection | null,
  docs: Seen["docs"],
  canvas: string | null
): string | null => {
  if (!selection) {
    return null;
  }
  const root = rootOfFrame(docs, canvas, selection.frame);
  return root?.type === "page" && root.id === selection.nodeId
    ? ownFrameOf(selection.frame)
    : null;
};

/** `selectedPageOf` as the stores are now. */
export const selectedPageNow = (): string | null =>
  selectedPageOf(
    useEditor.getState().selection,
    useDocuments.getState().docs,
    useEditor.getState().canvas
  );

/** `selectedPageOf` for a component. */
export const useSelectedPage = (): string | null => {
  const selection = useEditor((s) => s.selection);
  const canvas = useEditor((s) => s.canvas);
  return useDocuments((s) => selectedPageOf(selection, s.docs, canvas));
};

/** Adds a node to the selection, or takes it out when it is in it: Shift-click. */
export const toggleSelected = (target: Selection) => {
  if (hidesSelection(target.frame)) {
    return;
  }
  // Another view of the page shows the selection: the node is added there, and the rest with it.
  const picked = pickedIn(target.frame, useEditor.getState());
  if (!picked?.selection) {
    select(target);
    return;
  }
  const { also, selection } = picked;
  const same = (a: Selection) => a.nodeId === target.nodeId;
  if (same(selection)) {
    // The last one added before it takes its place.
    const next = also.at(-1) ?? null;
    useEditor.setState({ also: also.slice(0, -1), selection: next });
    return;
  }
  useEditor.setState({
    also: also.some(same) ? also.filter((a) => !same(a)) : [...also, selection],
    selection: also.some(same) ? selection : target,
  });
};

/**
 * Selects a node for a right-click. One that is already selected keeps the selection, in the view
 * it is clicked in: the menu then acts on all of it, as a menu does in Figma, at that view's
 * breakpoint.
 */
export const selectForMenu = (target: Selection) => {
  const editor = useEditor.getState();
  if (!isSelected(target.frame, target.nodeId, editor)) {
    select(target);
    return;
  }
  const picked = pickedIn(target.frame, editor);
  if (picked?.selection && picked.selection !== editor.selection) {
    useEditor.setState(picked);
  }
};

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
    widthOf(frameRefOf(frame), {
      box: seen.frames[frame],
      root: drawnRootOf(seen.docs, seen.canvas, frame),
    })
  );

/**
 * `frameBreakpoint` for a component; null without a frame. Its width read in two parts, each from
 * its own store: the layout's box, and what a node on the canvas is.
 */
export const useFrameBreakpoint = (frame: string | null): string | null => {
  const breakpoints = useBreakpoints();
  const canvas = useEditor((s) => s.canvas);
  const pageWidth = useEditor((s) =>
    frame === null
      ? undefined
      : widthOf(frameRefOf(frame), { box: s.frames[frame], root: null })
  );
  const nodeWidth = useDocuments((s) =>
    frame === null
      ? undefined
      : widthOf(frameRefOf(frame), {
          box: undefined,
          root: drawnRootOf(s.docs, canvas, frame),
        })
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
 * The nodes named, as their frame draws them: a selection's, all of one frame, and the same list
 * while the nodes stay the same. The element toolbar shows their values, which are those of its
 * view.
 */
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

type Inspecting = Pick<EditorState, "also" | "selection">;

/** The view a selection was made in; null when nothing is selected. */
const inspectedFrame = (s: Inspecting) => s.selection?.frame ?? null;

const inspectedNodes = (
  s: Inspecting,
  docs: Seen["docs"],
  canvas: string | null,
  breakpoints: readonly Breakpoint[],
  at: string | null
): DesignNode[] =>
  s.selection
    ? drawnAt([s.selection, ...s.also], docs, canvas, breakpoints, at)
    : [];

const inspectedOf = (
  frame: string | null,
  nodes: readonly DesignNode[]
): Inspected | null => {
  const [node] = nodes;
  return node && frame !== null ? { frame, node, nodes } : null;
};

/**
 * What the inspector is about: every node selected, the one it shows first leading (a page's
 * root for the page selected as a whole), as the view the selection was made in draws them.
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

/**
 * Whether the nodes selected are siblings, as wrapping them together needs: each inside the same
 * node, none a frame's root or gone.
 */
const selectedAreSiblings = (
  { also, selection }: Picked,
  docs: Seen["docs"],
  canvas: string | null
): boolean => {
  const targets = selection ? [selection, ...also] : [];
  const parents = new Set(
    targets.map((t) => pathIn(docs, canvas, t.frame, t.nodeId)?.at(-2)?.id)
  );
  const [parent] = parents;
  return parents.size === 1 && parent !== undefined;
};

/**
 * `selectedAreSiblings` for a component: it follows the selection and the documents, where a
 * node moved to another parent changes the answer.
 */
export const useSelectedAreSiblings = (): boolean => {
  const picked = useEditor(
    useShallow((s) => ({ also: s.also, selection: s.selection }))
  );
  const canvas = useEditor((s) => s.canvas);
  return useDocuments((s) => selectedAreSiblings(picked, s.docs, canvas));
};
