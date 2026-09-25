/**
 * Dragging things across the canvas: an element to another place in its page, into another
 * page or out onto the canvas as an item of its own; an item around the canvas or into a page;
 * a component from the palette into a page or onto the canvas. One controller for all of them,
 * because they share the question that matters — where would this land — and the line that
 * answers it.
 *
 * Alt copies instead of moving, as it does in every design tool.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { ImportSpec } from "@ultrapaint/contracts/edit";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import type { Rect, TreeNode } from "@ultrapaint/contracts/preview";
import { toast } from "sonner";
import { create } from "zustand";
import { runEdit } from "../lib/shortcuts.ts";
import { api } from "../state/connection.ts";
import { isItemId, useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { findNode, findPath } from "../state/tree.ts";
import { bridgeFor } from "./bridge.ts";
import {
  ancestorFrom,
  childrenAt,
  indexAt,
  locationAt,
  outlineOf,
  renderedFrom,
} from "./outline.ts";

/** Type of the data a component dragged from the palette carries. */
export const PALETTE_MIME = "application/ultrapaint-component";

/** A component of the palette, as its drag carries it. */
export interface PaletteComponent {
  importFrom: string;
  name: string;
  snippet: string;
}

export type Dragged =
  | {
      kind: "element";
      name: string;
      nodeId: string;
      pageId: string;
      /** Where the element was, in its frame, when the drag began. */
      rect: Rect;
      source: SourceLocation;
    }
  | {
      /** Where the item was when the drag began. */
      frame: FrameLayout;
      itemId: string;
      kind: "item";
      /** The element the item renders, which is what goes into a page. */
      root: SourceLocation | null;
    }
  | { kind: "component" };

/** Where a drop would land, with what to draw for it; coordinates are the canvas's own. */
export type Drop =
  | {
      /** The container, outlined when the element would become its only child. */
      box: Rect | null;
      index: number;
      into: SourceLocation;
      kind: "into";
      /** The line between the siblings it would land between. */
      line: Rect | null;
      pageId: string;
    }
  | { kind: "canvas" };

interface DragStore {
  copy: boolean;
  dragged: Dragged | null;
  drop: Drop | null;
  /** Where the pointer holds what it drags, from that thing's top left corner. */
  grab: { x: number; y: number };
  /** Pointer position on the canvas. */
  pointer: { x: number; y: number };
}

export const useDrag = create<DragStore>(() => ({
  copy: false,
  dragged: null,
  drop: null,
  grab: { x: 0, y: 0 },
  pointer: { x: 0, y: 0 },
}));

/** Tags that cannot hold children. */
const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
  "svg",
  "path",
  "textarea",
  "select",
]);

// ---- Geometry ----

/** A pointer event's position in the canvas's own coordinates. */
export const canvasPoint = (clientX: number, clientY: number) => {
  const el = document.querySelector("[data-canvas]");
  const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const { x, y, zoom } = useEditor.getState().view;
  return {
    x: (clientX - r.left - x) / zoom,
    y: (clientY - r.top - y) / zoom,
  };
};

/** The frame under a canvas point: items lie over pages. */
const frameAt = (x: number, y: number, except?: string): string | null => {
  const { frames, items } = useEditor.getState();
  const inside = ([id, f]: [string, FrameLayout]) =>
    id !== except &&
    x >= f.x &&
    y >= f.y &&
    x <= f.x + f.width &&
    y <= f.y + f.height;
  const entries = Object.entries(frames);
  const item = entries.filter(([id]) => items[id]).findLast(inside);
  if (item) {
    return item[0];
  }
  return entries.find((e) => !items[e[0]] && inside(e))?.[0] ?? null;
};

// ---- The tree, as JSX ----

/** Whether the rects run left to right rather than top to bottom. */
const isRow = (rects: Rect[]) => {
  const [a, b] = rects;
  if (!(a && b)) {
    return false;
  }
  return b.x >= a.x + a.width * 0.5 && Math.abs(b.y - a.y) < a.height * 0.5;
};

/** Whether `inner` is `outer` or lies inside it. */
const within = (tree: TreeNode | undefined, inner: string, outer: string) =>
  findPath(tree, inner)?.some((n) => n.id === outer) ?? false;

/** Where an element is written: its file's outline and its place in it. */
const placeOf = async (source: SourceLocation) => {
  const outline = await outlineOf(source.file);
  const index = outline ? indexAt(outline, source) : -1;
  const entry = outline?.elements[index];
  return outline && entry ? { entry, index, outline } : null;
};

/** Whether an element can be picked up at all: it is written inside another one to leave. */
export const isMovable = async (pageId: string, nodeId: string) => {
  const node = findNode(useEditor.getState().trees[pageId], nodeId);
  if (!(node?.editable && node.source)) {
    return false;
  }
  const place = await placeOf(node.source);
  return !!place?.entry.direct;
};

/** The file a frame renders: the page's or the item's. */
const fileOfFrame = (frameId: string) =>
  useEditor.getState().items[frameId]?.file ??
  useProject.getState().pages.find((p) => p.id === frameId)?.file ??
  null;

// ---- Where a drop lands ----

const offset = (r: Rect, f: FrameLayout): Rect => ({
  height: r.height,
  width: r.width,
  x: r.x + f.x,
  y: r.y + f.y,
});

/** The line in front of `rect`, or after it, across the axis the siblings run along. */
const lineAt = (r: Rect, row: boolean, after: boolean): Rect =>
  row
    ? { height: r.height, width: 0, x: after ? r.x + r.width : r.x, y: r.y }
    : { height: 0, width: r.width, x: r.x, y: after ? r.y + r.height : r.y };

/** What a frame's drop can reach, worked out once per lookup. */
interface Reach {
  /** Where the dragged element is written, when it is an element. */
  dragged: { file: string; index: number; scope: string } | null;
  frameFile: string | null;
}

/**
 * Only JSX written in the page (or the item) itself takes a drop, and JSX written next to the
 * dragged element. What a component of the file renders from its own definition does not:
 * dropping there would change every instance of it, the dragged one included.
 */
const reaches = (reach: Reach, file: string, scope: string) =>
  (file === reach.frameFile && scope === "default") ||
  (reach.dragged?.file === file && reach.dragged.scope === scope);

/**
 * Where something dropped at this point of a frame would go: inside the innermost container
 * under it, or beside the innermost element, whichever the pointer is nearer to meaning.
 */
const placementIn = async (
  frameId: string,
  px: number,
  py: number,
  dragged: Dragged
): Promise<Drop | null> => {
  const s = useEditor.getState();
  const frame = s.frames[frameId];
  const tree = s.trees[frameId];
  if (!(frame && tree)) {
    return null;
  }
  const own = dragged.kind === "element" ? await placeOf(dragged.source) : null;
  const reach: Reach = {
    dragged:
      dragged.kind === "element" && own
        ? {
            file: dragged.source.file,
            index: own.index,
            scope: own.entry.scope,
          }
        : null,
    frameFile: fileOfFrame(frameId),
  };
  const chain = await bridgeFor(frameId).hitTest(px - frame.x, py - frame.y);
  const draggedId =
    dragged.kind === "element" && dragged.pageId === frameId
      ? dragged.nodeId
      : null;
  // The chain holds what a click reaches; everything around it on the way up can take a drop.
  const innermost = chain.at(-1);
  const candidates = innermost
    ? (findPath(tree, innermost) ?? []).toReversed()
    : [];
  for (const node of candidates) {
    if (
      !(node.editable && node.source) ||
      (draggedId && within(tree, node.id, draggedId))
    ) {
      continue;
    }
    // Innermost first, one at a time: the first that takes the drop is the answer.
    // biome-ignore lint/performance/noAwaitInLoops: each step depends on the one before.
    const drop = await dropAround(
      { frame, frameId, reach, tree },
      node as TreeNode & { source: SourceLocation },
      px,
      py
    );
    if (drop) {
      return drop;
    }
  }
  return null;
};

interface FrameContext {
  frame: FrameLayout;
  frameId: string;
  reach: Reach;
  tree: TreeNode;
}

/** The rect of a node measured in its frame, in the canvas's coordinates. */
const rectIn = (
  rects: Record<string, Rect>,
  frame: FrameLayout,
  node: TreeNode | null
): Rect | null => {
  const m = node ? rects[node.id] : undefined;
  return m ? offset(m, frame) : null;
};

/**
 * Positions among the element children of an element, leaving out the dragged one: that is how
 * a move counts them, the element being gone from its old place by the time it lands.
 */
const without = (indices: number[], reach: Reach, file: string) =>
  reach.dragged?.file === file
    ? indices.filter((i) => i !== reach.dragged?.index)
    : indices;

/** Where something dropped inside `node` goes: before the first child the pointer is above. */
const dropInside = (
  frameId: string,
  into: SourceLocation,
  own: Rect,
  childRects: (Rect | null)[],
  px: number,
  py: number
): Drop => {
  const inner = childRects.filter((x): x is Rect => !!x);
  const row = isRow(inner);
  let index = childRects.length;
  for (const [i, cr] of childRects.entries()) {
    const mid = cr && (row ? cr.x + cr.width / 2 : cr.y + cr.height / 2);
    if (mid !== null && (row ? px : py) < mid) {
      index = i;
      break;
    }
  }
  const before = childRects[index];
  const last = inner.at(-1);
  let line: Rect | null = null;
  if (before) {
    line = lineAt(before, row, false);
  } else if (last) {
    line = lineAt(last, row, true);
  }
  return {
    box: inner.length === 0 ? own : null,
    index,
    into,
    kind: "into",
    line,
    pageId: frameId,
  };
};

/**
 * Near the edges of an element along the way its siblings run, a drop goes beside it; in the
 * middle of a container, inside it.
 */
const dropAround = async (
  ctx: FrameContext,
  node: TreeNode & { source: SourceLocation },
  px: number,
  py: number
): Promise<Drop | null> => {
  const { frame, frameId, reach, tree } = ctx;
  const place = await placeOf(node.source);
  if (!(place && reaches(reach, node.source.file, place.entry.scope))) {
    return null;
  }
  const { entry, index, outline } = place;
  const { file } = node.source;
  const path = findPath(tree, node.id) ?? [];
  const parentLoc =
    entry.parent === null ? null : locationAt(outline, file, entry.parent);
  const parentNode = parentLoc ? ancestorFrom(path, parentLoc) : null;
  const siblings =
    entry.parent === null || !entry.direct
      ? []
      : without(childrenAt(outline, entry.parent), reach, file);
  const children = without(childrenAt(outline, index), reach, file);
  const rendered = (under: TreeNode | null, i: number) => {
    const loc = locationAt(outline, file, i);
    return under && loc ? renderedFrom(under, loc) : null;
  };
  const siblingNodes = siblings.map((i) =>
    i === index ? node : rendered(parentNode, i)
  );
  const childNodes = children.map((i) => rendered(node, i));
  const rects = await bridgeFor(frameId).measure(
    [node, ...siblingNodes, ...childNodes].flatMap((n) => (n ? [n.id] : []))
  );
  const r = rectIn(rects, frame, node);
  if (!r) {
    return null;
  }
  const row = isRow(
    siblingNodes
      .map((n) => rectIn(rects, frame, n))
      .filter((x): x is Rect => !!x)
  );
  // Along the siblings' axis, how far into the element the pointer is.
  const t = row ? (px - r.x) / r.width : (py - r.y) / r.height;
  const container =
    node.kind === "element"
      ? !VOID.has(node.name.toLowerCase())
      : children.length > 0;
  const edge = container ? 0.25 : 0.5;
  const at = siblings.indexOf(index);
  if (parentLoc && at >= 0 && (t < edge || t > 1 - edge || !container)) {
    const after = t >= 0.5;
    return {
      box: null,
      index: at + (after ? 1 : 0),
      into: parentLoc,
      kind: "into",
      line: lineAt(r, row, after),
      pageId: frameId,
    };
  }
  if (!container) {
    return null;
  }
  return dropInside(
    frameId,
    node.source,
    r,
    childNodes.map((n) => rectIn(rects, frame, n)),
    px,
    py
  );
};

// ---- The drag itself ----

let pending = false;
let queued: { clientX: number; clientY: number; alt: boolean } | null = null;

/** Starts a drag. The element or item keeps its place until the drop. */
export const beginDrag = (
  dragged: Dragged,
  clientX: number,
  clientY: number,
  alt: boolean
) => {
  const p = canvasPoint(clientX, clientY);
  let grab = { x: 0, y: 0 };
  const s = useEditor.getState();
  if (dragged.kind === "element") {
    const frame = s.frames[dragged.pageId];
    grab = frame
      ? {
          x: p.x - (frame.x + dragged.rect.x),
          y: p.y - (frame.y + dragged.rect.y),
        }
      : grab;
  } else if (dragged.kind === "item") {
    grab = { x: p.x - dragged.frame.x, y: p.y - dragged.frame.y };
  }
  useDrag.setState({ copy: alt, dragged, drop: null, grab, pointer: p });
  s.setHover(null);
};

/** Follows the pointer. Lookups in the preview are asynchronous; only the latest one counts. */
export const moveDrag = (clientX: number, clientY: number, alt: boolean) => {
  const { dragged, grab } = useDrag.getState();
  if (!dragged) {
    return;
  }
  const p = canvasPoint(clientX, clientY);
  useDrag.setState({ copy: alt, pointer: p });
  if (dragged.kind === "item") {
    useEditor
      .getState()
      .setFrame(
        dragged.itemId,
        { ...dragged.frame, x: p.x - grab.x, y: p.y - grab.y },
        false
      );
  }
  if (pending) {
    queued = { alt, clientX, clientY };
    return;
  }
  pending = true;
  resolveDrop(p.x, p.y, dragged)
    .then((drop) => {
      if (useDrag.getState().dragged === dragged) {
        useDrag.setState({ drop });
      }
    })
    .catch(() => undefined)
    .finally(() => {
      pending = false;
      const next = queued;
      queued = null;
      if (next) {
        moveDrag(next.clientX, next.clientY, next.alt);
      }
    });
};

const resolveDrop = async (
  x: number,
  y: number,
  dragged: Dragged
): Promise<Drop | null> => {
  const except = dragged.kind === "item" ? dragged.itemId : undefined;
  const frameId = frameAt(x, y, except);
  if (!frameId) {
    // An item dragged over nothing is only being moved; anything else becomes an item.
    return dragged.kind === "item" ? null : { kind: "canvas" };
  }
  // An item goes into pages, not into other items.
  if (dragged.kind === "item" && isItemId(frameId)) {
    return null;
  }
  return await placementIn(frameId, x, y, dragged);
};

export const cancelDrag = () => {
  const { dragged } = useDrag.getState();
  if (dragged?.kind === "item") {
    useEditor.getState().setFrame(dragged.itemId, dragged.frame, false);
  }
  useDrag.setState({ dragged: null, drop: null });
};

/** Carries the drop out. Resolves once the edit has been asked for. */
export const endDrag = async (component?: PaletteComponent) => {
  const { copy, dragged, drop, grab, pointer } = useDrag.getState();
  useDrag.setState({ dragged: null, drop: null });
  if (!dragged) {
    return;
  }
  const s = useEditor.getState();
  const { space } = s;
  try {
    if (dragged.kind === "item") {
      await dropItem(dragged, drop, copy);
      return;
    }
    if (drop?.kind === "into") {
      if (dragged.kind === "element") {
        await transfer(dragged, drop, copy);
      } else if (component) {
        await runEdit({
          imports: importsOf(component),
          index: drop.index,
          into: drop.into,
          jsx: component.snippet,
          kind: "insert",
        });
      }
      return;
    }
    if (drop?.kind !== "canvas" || space === null) {
      return;
    }
    const at = { x: pointer.x - grab.x, y: pointer.y - grab.y };
    if (dragged.kind === "element") {
      const frame: FrameLayout = {
        height: Math.max(40, Math.round(dragged.rect.height)),
        preset: "custom",
        width: Math.max(40, Math.round(dragged.rect.width)),
        ...roundPoint(at),
      };
      const r = await api().request("canvas.extractItem", {
        copy,
        frame,
        source: dragged.source,
        space,
      });
      placeItem(r.item, frame);
      warn(r.warnings);
      if (!copy) {
        s.select(null);
      }
    } else if (component) {
      const frame: FrameLayout = {
        height: 200,
        preset: "custom",
        width: 360,
        ...roundPoint(pointer),
      };
      const r = await api().request("canvas.createItem", {
        frame,
        imports: importsOf(component),
        jsx: component.snippet,
        name: component.name,
        space,
      });
      placeItem(r.item, frame);
    }
  } catch (error) {
    reportError(error);
  }
};

const roundPoint = (p: { x: number; y: number }) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
});

const importsOf = (c: PaletteComponent): ImportSpec[] => [
  { from: c.importFrom, name: c.name },
];

export const placeItem = (
  item: Parameters<ReturnType<typeof useEditor.getState>["addItem"]>[0],
  frame: FrameLayout
) => {
  const s = useEditor.getState();
  s.addItem(item, frame);
  s.selectPage(item.id);
};

const warn = (warnings: readonly string[]) => {
  if (warnings.length > 0) {
    toast.warning(warnings.join("\n"));
  }
};

/**
 * A drop's index leaves the dragged element out, as a move counts. A copy leaves it in place,
 * so it counts again when it stands before the landing spot.
 */
const indexWithOriginal = async (
  source: SourceLocation,
  drop: Extract<Drop, { kind: "into" }>
) => {
  const outline = await outlineOf(source.file);
  if (!outline) {
    return drop.index;
  }
  const siblings = childrenAt(outline, indexAt(outline, drop.into));
  const at = siblings.indexOf(indexAt(outline, source));
  return at >= 0 && at < drop.index ? drop.index + 1 : drop.index;
};

const transfer = async (
  dragged: Extract<Dragged, { kind: "element" }>,
  drop: Extract<Drop, { kind: "into" }>,
  copy: boolean
) => {
  const s = useEditor.getState();
  const index =
    copy && dragged.source.file === drop.into.file
      ? await indexWithOriginal(dragged.source, drop)
      : drop.index;
  const r =
    !copy && dragged.source.file === drop.into.file
      ? await runEdit({
          index: drop.index,
          into: drop.into,
          kind: "move",
          target: dragged.source,
        })
      : await api()
          .request("edit.transfer", {
            copy,
            index,
            into: drop.into,
            target: dragged.source,
          })
          .catch((error: unknown) => {
            reportError(error);
            return null;
          });
  if (!r) {
    return;
  }
  warn(r.warnings);
  // The element now lives where it landed; the next tree from that frame names its node.
  if (r.location) {
    s.select({ nodeId: "", pageId: drop.pageId, source: r.location });
  }
};

const dropItem = async (
  dragged: Extract<Dragged, { kind: "item" }>,
  drop: Drop | null,
  copy: boolean
) => {
  const s = useEditor.getState();
  if (drop?.kind !== "into") {
    const f = s.frames[dragged.itemId];
    if (f) {
      s.setFrame(dragged.itemId, { ...f, ...roundPoint(f) });
    }
    return;
  }
  // Into a page: the item goes back where it came from on the canvas, and what it renders
  // goes into the page. Moving then takes the item away, in the same undo step.
  s.setFrame(dragged.itemId, dragged.frame, false);
  if (!(dragged.root && s.space !== null)) {
    return;
  }
  const r = await api().request("canvas.placeItem", {
    copy,
    id: dragged.itemId,
    index: drop.index,
    into: drop.into,
    root: dragged.root,
    space: s.space,
  });
  warn(r.warnings);
  if (!copy) {
    s.removeItem(dragged.itemId);
  }
  if (r.location) {
    s.select({ nodeId: "", pageId: drop.pageId, source: r.location });
  }
};
