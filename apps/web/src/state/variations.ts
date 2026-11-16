/**
 * A thing's variations (ADR 0098) and choosing among them: the one state module the inspector's
 * Variations section, the canvas and the preview's controls go through.
 *
 * Opened, a thing's variations are laid out beside its page, and the thing in its page is the
 * **preview**: showing a variation there writes nothing, and **Use this** puts the preview in use
 * as one undo step. Done or Escape closes them, the one in use kept.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import {
  type ComponentFile,
  componentOfDoc,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  DocumentVariations,
  VariationSet,
  VariationSets,
  VariationTarget,
} from "@ultrapaint/contracts/variations";
import { childrenOf } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { appComponentOf } from "./components.ts";
import { api } from "./connection.ts";
import { docOfFrame } from "./documents.ts";
import { type Selection, useEditor } from "./editor.ts";
import { reportError } from "./project.ts";
import { select } from "./selection.ts";
import { follow } from "./server-data.ts";

/** A thing whose variations are open: where its preview is drawn, and which is shown there. */
export interface OpenVariations {
  readonly doc: string;
  /** The frame its page, or itself on the canvas, is drawn in. */
  readonly frame: string;
  readonly node: string;
  /**
   * The variation shown in the preview: the one in use until another is shown; null for the
   * thing as it is drawn, while none is in use.
   */
  readonly preview: string | null;
  /** What was selected when they opened, given back when they close. */
  readonly selected: Selection | null;
}

interface VariationsStore {
  /** The variations of every document of the canvas open, and of the components, by document. */
  readonly byDoc: Readonly<Record<string, VariationSets>>;
  readonly canvas: string | null;
  readonly open: OpenVariations | null;
}

export const useVariations = create<VariationsStore>(() => ({
  byDoc: {},
  canvas: null,
  open: null,
}));

const takeVariations = ({ doc, sets }: DocumentVariations) =>
  useVariations.setState((s) => {
    const { [doc]: _was, ...others } = s.byDoc;
    return {
      byDoc: Object.keys(sets).length > 0 ? { ...others, [doc]: sets } : others,
    };
  });

const variationsData = follow({
  apply: ({ documents }) =>
    useVariations.setState({
      byDoc: Object.fromEntries(documents.map((d) => [d.doc, d.sets])),
    }),
  key: () => useVariations.getState().canvas,
  news: ["variations"],
  on: { variations: takeVariations },
  read: (canvas: string) => api().request("variations.list", { canvas }),
});

/** Reads the variations of a canvas's documents: the canvas opened. */
export const loadVariations = async (canvas: string) => {
  useVariations.setState({ byDoc: {}, canvas, open: null });
  await variationsData.read().catch(reportError);
};

/** A thing's set, when it has variations other than its original. */
export const setOf = (
  state: Pick<VariationsStore, "byDoc">,
  doc: string,
  node: string
): VariationSet | undefined => state.byDoc[doc]?.[node];

/** The set of the thing whose variations are open. */
export const openSet = (state: VariationsStore): VariationSet | undefined =>
  state.open ? setOf(state, state.open.doc, state.open.node) : undefined;

/** The variation shown in the preview, by id; null while none are open. */
export const previewOf = (state: VariationsStore): string | null =>
  state.open?.preview ?? null;

/**
 * A thing with variations: a node, in the frame its preview is drawn in, and its document when
 * the frame does not show it (a component's main tree, drawn on its board).
 */
export interface Thing extends Selection {
  readonly doc?: string | undefined;
}

/** A thing's node, in its document: the one it names, or the one its frame shows. */
export const targetOf = (thing: Thing): VariationTarget => ({
  doc: thing.doc ?? docOfFrame(thing.frame, useEditor.getState().canvas),
  node: thing.nodeId,
});

/**
 * What a frame draws in place of the open thing: the variation shown, while it is not the one
 * in use, its root the thing's id; null when the frame draws its document as it is.
 */
export const drawnIn = (
  state: VariationsStore,
  frame: string
): DesignNode | null => {
  const { open } = state;
  const set = openSet(state);
  if (!(open && set) || open.frame !== frame || open.preview === set.inUse) {
    return null;
  }
  return set.variations.find((v) => v.id === open.preview)?.tree ?? null;
};

/** A tree with `part` in place of the node with its id; the same tree when it has none. */
export const drawnWith = (root: DesignNode, part: DesignNode): DesignNode => {
  if (root.id === part.id) {
    return part;
  }
  const children = childrenOf(root);
  if (children.length === 0) {
    return root;
  }
  const next = children.map((child) => drawnWith(child, part));
  return next.every((child, i) => child === children[i])
    ? root
    : ({ ...root, children: next } as DesignNode);
};

/**
 * Lays the thing's variations out beside its page, `preview` in the preview (the one in use
 * unless one is named). Nothing is selected meanwhile, so the right panel gives them the room.
 */
export const openVariations = (thing: Thing, preview?: string) => {
  const target = targetOf(thing);
  const set = setOf(useVariations.getState(), target.doc, target.node);
  if (!set) {
    return;
  }
  const { selection } = useEditor.getState();
  select(null);
  useVariations.setState({
    open: {
      ...target,
      frame: thing.frame,
      preview: preview ?? set.inUse,
      selected: selection,
    },
  });
};

/** Shows a variation in the preview (null: the thing as it is drawn); nothing is written. */
export const showVariation = (variation: string | null) =>
  useVariations.setState(({ open }) =>
    open ? { open: { ...open, preview: variation } } : {}
  );

/** The next variation in the preview (← -1, → +1), round from the last to the first. */
export const stepVariation = (by: 1 | -1) => {
  const state = useVariations.getState();
  const set = openSet(state);
  if (!(state.open && set)) {
    return;
  }
  // With none in use, the thing as it is drawn is one of the stops.
  const ids = [
    ...(set.inUse === null ? [null] : []),
    ...set.variations.map((v) => v.id),
  ];
  const at = ids.indexOf(state.open.preview);
  const next = ids[(at + by + ids.length) % ids.length];
  if (next !== undefined) {
    showVariation(next);
  }
};

/** The preview back to the one in use. */
export const resetPreview = () => {
  const set = openSet(useVariations.getState());
  if (set) {
    showVariation(set.inUse);
  }
};

/** Closes the variations, the one in use kept and what was selected selected again. */
export const closeVariations = () => {
  const { open } = useVariations.getState();
  useVariations.setState({ open: null });
  if (open?.selected) {
    select(open.selected);
  }
};

/**
 * Selecting something on the canvas closes the variations, the one in use kept (ADR 0098), so
 * ← and → walk the selection again. Returns the unsubscribe.
 */
export const closeOnSelecting = () =>
  useEditor.subscribe((now, before) => {
    if (
      now.selection !== null &&
      now.selection !== before.selection &&
      useVariations.getState().open !== null
    ) {
      useVariations.setState({ open: null });
    }
  });

/** Whether the preview shows another than the one in use. */
export const previewDiffers = (state: VariationsStore): boolean => {
  const set = openSet(state);
  const preview = state.open?.preview ?? null;
  // The thing as it is drawn is what is in use, whichever that is (an undo may put one back).
  return set !== undefined && preview !== null && preview !== set.inUse;
};

/**
 * Use this: the preview put in use, as one undo step; the variations close and the thing stays
 * selected.
 */
export const putPreviewInUse = async () => {
  const state = useVariations.getState();
  const { open } = state;
  if (!open) {
    return;
  }
  if (previewDiffers(state) && open.preview !== null) {
    takeVariations(
      await api().request("variations.use", {
        doc: open.doc,
        node: open.node,
        variation: open.preview,
      })
    );
  }
  closeVariations();
  select({ frame: open.frame, nodeId: open.node });
};

/** The one in use copied as a new variation, put in use to be edited by hand. */
export const newVariation = async (thing: Thing) =>
  takeVariations(await api().request("variations.add", targetOf(thing)));

export const renameVariation = async (
  thing: Thing,
  variation: string,
  name: string
) =>
  takeVariations(
    await api().request("variations.rename", {
      ...targetOf(thing),
      name,
      variation,
    })
  );

export const deleteVariation = async (thing: Thing, variation: string) =>
  takeVariations(
    await api().request("variations.remove", {
      ...targetOf(thing),
      variation,
    })
  );

export const clearVariations = async (thing: Thing) =>
  takeVariations(await api().request("variations.clear", targetOf(thing)));

/** The room between the page and its variations, and between two of them, on the canvas. */
export const BESIDE_GAP = 80;

/** How many variations a row beside the page holds, as the chosen design lays them out. */
const BESIDE_COLUMNS = 2;

/**
 * Where a thing's variations are laid out beside its page: two to a row past the page's right
 * edge, the first row level with the thing, each as wide as the thing and as tall as it is drawn
 * (the thing's height until it is measured), a row below the tallest of the one above.
 */
export const besideBoxes = (
  page: Box,
  thing: Box,
  ids: readonly string[],
  heights: Readonly<Record<string, number>>
): Record<string, Box> => {
  const boxes: Record<string, Box> = {};
  let { y } = thing;
  for (let start = 0; start < ids.length; start += BESIDE_COLUMNS) {
    const row = ids.slice(start, start + BESIDE_COLUMNS);
    row.forEach((id, column) => {
      boxes[id] = {
        height: heights[id] ?? thing.height,
        width: thing.width,
        x:
          page.x +
          page.width +
          BESIDE_GAP +
          column * (thing.width + BESIDE_GAP),
        y,
      };
    });
    y += Math.max(...row.map((id) => boxes[id]?.height ?? 0)) + BESIDE_GAP;
  }
  return boxes;
};

/**
 * A key pressed while a thing's variations are open: ← and → move the preview, Enter uses it,
 * Escape closes them. False when none are open, or the key is none of these.
 */
export const variationsKey = (key: string): boolean => {
  if (useVariations.getState().open === null) {
    return false;
  }
  switch (key) {
    case "ArrowLeft":
      stepVariation(-1);
      return true;
    case "ArrowRight":
      stepVariation(1);
      return true;
    case "Enter":
      putPreviewInUse().catch(reportError);
      return true;
    case "Escape":
      closeVariations();
      return true;
    default:
      return false;
  }
};

/** The tree a document holds now: a page's or a canvas's, or an app component's main tree. */
export const rootOfDocument = (
  docs: Readonly<Record<string, { readonly root: DesignNode | null }>>,
  components: readonly ComponentFile[],
  doc: string
): DesignNode | null => {
  const component = componentOfDoc(doc);
  return component === null
    ? (docs[doc]?.root ?? null)
    : (appComponentOf(components, component)?.tree ?? null);
};

let previewed: {
  readonly components: readonly ComponentFile[];
  readonly drawn: readonly ComponentFile[];
  readonly tree: DesignNode | null;
} | null = null;

/**
 * The components as the editor draws them: an app component whose variations are open with
 * another in the preview drawn with that one's tree, in its board and every instance; nothing
 * written. The same list for the same components and preview.
 */
export const previewedComponents = (
  components: readonly ComponentFile[]
): readonly ComponentFile[] => {
  const state = useVariations.getState();
  const component = state.open ? componentOfDoc(state.open.doc) : null;
  const set = openSet(state);
  const tree =
    component !== null && set && state.open?.preview !== set.inUse
      ? (set.variations.find((v) => v.id === state.open?.preview)?.tree ?? null)
      : null;
  if (tree === null) {
    return components;
  }
  if (previewed?.components !== components || previewed.tree !== tree) {
    previewed = {
      components,
      // The part shown in its place in the tree: the whole tree when it is the main tree's root.
      drawn: components.map((c) =>
        c.origin === "app" && c.name === component
          ? { ...c, tree: drawnWith(c.tree, tree) }
          : c
      ),
      tree,
    };
  }
  return previewed.drawn;
};
