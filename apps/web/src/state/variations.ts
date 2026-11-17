/**
 * A thing's variations (ADR 0098) and choosing among them: the one state module the inspector's
 * Variations section, the canvas and the preview's controls go through.
 *
 * Opened, a thing's variations are laid out beside its page, and the thing in its page is the
 * **preview**: showing a variation there writes nothing, and **Use this** puts the preview in use
 * as one undo step. Done or Escape closes them, the one in use kept.
 *
 * An agent's **rounds** of takes are followed here too: the takes still coming are placeholders
 * beside the others, those that failed red boxes with Try again, and the thing's variations are
 * laid out once the first of a round comes in or fails.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import {
  type ComponentFile,
  componentOfDoc,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  type DocumentVariations,
  ORIGINAL,
  ORIGINAL_ID,
  takesIn,
  type VariationRound,
  type VariationSet,
  type VariationSets,
  type VariationTarget,
} from "@ultrapaint/contracts/variations";
import {
  canvasDocOf,
  childrenOf,
  findNode,
  idsOf,
} from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { appComponentOf, useComponents } from "./components.ts";
import { api } from "./connection.ts";
import { docOfFrame, useDocuments } from "./documents.ts";
import { type Selection, useEditor } from "./editor.ts";
import { nodeFrameOf } from "./frame-ref.ts";
import { reportError } from "./project.ts";
import { select, selectMany } from "./selection.ts";
import { follow } from "./server-data.ts";
import {
  drawnWith,
  mixName,
  type PartPut,
  putPart,
} from "./variation-parts.ts";

/** A thing whose variations are open: where its preview is drawn, and which is shown there. */
export interface OpenVariations {
  readonly doc: string;
  /** The frame its page, or itself on the canvas, is drawn in. */
  readonly frame: string;
  readonly mix: DesignNode | null;
  readonly node: string;
  /** A part of a variation selected beside the page, its fields shown read-only. */
  readonly part: PartOf | null;
  /**
   * The parts put in the preview from other variations (Use in preview, Add to preview), and the
   * **mix**: the tree the preview draws with them; none while it draws one variation whole.
   */
  readonly parts: readonly PartOf[];
  /**
   * The variation shown in the preview: the one in use until another is shown; null for the
   * thing as it is drawn, while none is in use.
   */
  readonly preview: string | null;
  /** What was selected when they opened, the lead and the others, given back when they close. */
  readonly selected: readonly Selection[];
  /** Which opening of the variations this is: a part selected or let go is the same one. */
  readonly session: number;
}

/** A part of one of the thing's variations: the variation, and the part's node id. */
export interface PartOf {
  readonly node: string;
  readonly variation: string;
}

interface VariationsStore {
  /** The variations of every document of the canvas open, and of the components, by document. */
  readonly byDoc: Readonly<Record<string, VariationSets>>;
  readonly canvas: string | null;
  readonly open: OpenVariations | null;
  /** The agents' rounds of takes under way, and those with a take that failed. */
  readonly rounds: readonly VariationRound[];
}

export const useVariations = create<VariationsStore>(() => ({
  byDoc: {},
  canvas: null,
  open: null,
  rounds: [],
}));

const takeVariations = ({ doc, sets }: DocumentVariations) =>
  useVariations.setState((s) => {
    const { [doc]: _was, ...others } = s.byDoc;
    return {
      byDoc: Object.keys(sets).length > 0 ? { ...others, [doc]: sets } : others,
    };
  });

/** The frame a thing of the canvas open is drawn in: its page's, or its node's beside them. */
const frameOfThing = (target: VariationTarget): string | null => {
  const { canvas } = useVariations.getState();
  if (canvas === null) {
    return null;
  }
  if (target.doc === canvasDocOf(canvas)) {
    const root = useDocuments.getState().docs[target.doc]?.root;
    const placed = (root ? childrenOf(root) : []).find(
      (n) => findNode(n, target.node) !== null
    );
    return placed ? nodeFrameOf(placed.id) : null;
  }
  return useDocuments.getState().docs[target.doc] ? target.doc : null;
};

const settled = (round: VariationRound | undefined) =>
  round === undefined
    ? 0
    : takesIn(round, "handedIn") + takesIn(round, "failed");

/**
 * The rounds as the server tells them. A round's first take come in or failed lays its thing's
 * variations out (ADR 0098), unless some are open already or its thing is not on this canvas.
 */
const takeRounds = (rounds: readonly VariationRound[]) => {
  const before = useVariations.getState().rounds;
  useVariations.setState({ rounds });
  if (useVariations.getState().open !== null) {
    return;
  }
  const first = rounds.find(
    (r) => settled(r) > 0 && settled(before.find((b) => b.id === r.id)) === 0
  );
  const frame = first ? frameOfThing(first) : null;
  if (first && frame !== null) {
    openVariations({ doc: first.doc, frame, nodeId: first.node });
  }
};

const variationsData = follow({
  apply: ({ documents, rounds }) =>
    useVariations.setState({
      byDoc: Object.fromEntries(documents.map((d) => [d.doc, d.sets])),
      rounds,
    }),
  key: () => useVariations.getState().canvas,
  news: ["variations", "variationRounds"],
  on: { variationRounds: takeRounds, variations: takeVariations },
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

/** The agents' rounds of takes on a thing, oldest first. */
export const roundsOf = (
  state: Pick<VariationsStore, "rounds">,
  doc: string,
  node: string
): readonly VariationRound[] =>
  state.rounds.filter((r) => r.doc === doc && r.node === node);

/** A thing with nothing but its original, while an agent's first takes are under way. */
const ORIGINAL_ONLY: VariationSet = {
  inUse: ORIGINAL_ID,
  variations: [ORIGINAL],
};

/**
 * The set of a thing, or its original alone while an agent's round on it has none in yet: its
 * takes still coming, or failed, are laid out beside it all the same.
 */
const setOrRound = (
  state: Pick<VariationsStore, "byDoc" | "rounds">,
  doc: string,
  node: string
): VariationSet | undefined =>
  setOf(state, doc, node) ??
  (roundsOf(state, doc, node).length > 0 ? ORIGINAL_ONLY : undefined);

/** The set of the thing whose variations are open. */
export const openSet = (state: VariationsStore): VariationSet | undefined =>
  state.open ? setOrRound(state, state.open.doc, state.open.node) : undefined;

/** The takes on the open thing still coming from an agent, and the rounds with some that failed. */
export const takesOfOpen = (state: VariationsStore) => {
  const rounds = state.open
    ? roundsOf(state, state.open.doc, state.open.node)
    : [];
  return {
    coming: rounds.reduce((n, r) => n + takesIn(r, "working"), 0),
    failed: rounds.filter((r) => takesIn(r, "failed") > 0),
  };
};

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
  if (!(open && set) || open.frame !== frame) {
    return null;
  }
  if (open.mix !== null) {
    return open.mix;
  }
  return open.preview === set.inUse
    ? null
    : (set.variations.find((v) => v.id === open.preview)?.tree ?? null);
};

/**
 * Lays the thing's variations out beside its page, `preview` in the preview (the one in use
 * unless one is named). Nothing is selected meanwhile, so the right panel gives them the room.
 */
export const openVariations = (thing: Thing, preview?: string) => {
  const target = targetOf(thing);
  const set = setOrRound(useVariations.getState(), target.doc, target.node);
  if (!set) {
    return;
  }
  const { also, selection } = useEditor.getState();
  beforeClick = null;
  sessions += 1;
  select(null);
  useVariations.setState({
    open: {
      ...target,
      frame: thing.frame,
      mix: null,
      part: null,
      parts: [],
      preview: preview ?? set.inUse,
      selected: selection ? [selection, ...also] : [],
      session: sessions,
    },
  });
};

/** The variations opened so far: each opening's own number. */
let sessions = 0;

/**
 * Whether the variations open now show the preview `was` showed: the same opening, the same
 * variation and parts in it, whatever part is selected meanwhile.
 */
const samePreview = (was: OpenVariations, now: OpenVariations | null) =>
  now !== null &&
  now.session === was.session &&
  now.preview === was.preview &&
  now.mix === was.mix;

/** Shows a variation in the preview (null: the thing as it is drawn); nothing is written. */
export const showVariation = (variation: string | null) =>
  useVariations.setState(({ open }) =>
    open ? { open: { ...open, mix: null, parts: [], preview: variation } } : {}
  );

/** What the variations were before the click that may begin a double-click. */
let beforeClick: OpenVariations | null = null;

/**
 * A click on a variation beside the page: it is shown in the preview, what the preview was kept
 * for a double-click, which selects a part instead (`clickUndone`). The second click of a
 * double-click shows nothing more.
 */
export const clickVariation = (variation: string, clicks: number) => {
  if (clicks > 1) {
    return;
  }
  beforeClick = useVariations.getState().open;
  showVariation(variation);
};

/** The preview as it was before the click that began a double-click: its mix kept. */
export const clickUndone = () => {
  const was = beforeClick;
  beforeClick = null;
  if (was) {
    useVariations.setState(({ open }) =>
      open
        ? {
            open: {
              ...open,
              mix: was.mix,
              parts: was.parts,
              preview: was.preview,
            },
          }
        : {}
    );
  }
};

/** A part of a variation selected beside the page, or none; nothing is written. */
export const selectPart = (part: PartOf | null) =>
  useVariations.setState(({ open }) =>
    open ? { open: { ...open, part } } : {}
  );

/** A variation's tree: its own, or the document's for the one in use. */
const treeOfVariation = (
  set: VariationSet,
  variation: string,
  current: DesignNode | null
): DesignNode | null =>
  variation === set.inUse
    ? current
    : (set.variations.find((v) => v.id === variation)?.tree ?? null);

/** The open thing as its document draws it now. */
const currentThing = (open: OpenVariations): DesignNode | null =>
  findNode(
    rootOfDocument(
      useDocuments.getState().docs,
      useComponents.getState().components,
      open.doc
    ),
    open.node
  );

/** The frame a variation is drawn in beside its page: none of the page canvas's frames. */
export const variationFrameOf = (
  open: Pick<OpenVariations, "doc" | "node">,
  variation: string
) => `variation:${open.doc}/${open.node}/${variation}`;

/** A part of a variation, as its tree holds it; null when it holds none. */
export const partNodeOf = (
  state: VariationsStore,
  part: PartOf
): DesignNode | null => {
  const { open } = state;
  const set = openSet(state);
  return open && set
    ? findNode(
        treeOfVariation(set, part.variation, currentThing(open)),
        part.node
      )
    : null;
};

/** Whether the preview draws the part's variation whole: its parts are in it already. */
export const partShown = (open: OpenVariations, part: PartOf): boolean =>
  open.mix === null && open.preview === part.variation;

/** What a part does to the preview: the tree it would draw, or why it cannot be put there. */
export const partInPreview = (
  open: OpenVariations,
  set: VariationSet,
  part: PartOf
): PartPut | null => {
  const current = currentThing(open);
  const preview =
    open.mix ??
    (open.preview === null
      ? current
      : treeOfVariation(set, open.preview, current));
  const source = treeOfVariation(set, part.variation, current);
  return preview && source ? putPart(preview, source, part.node) : null;
};

/**
 * Use in preview, or Add to preview: the part put in the preview's tree, which writes nothing;
 * Reset takes it back out, and Use this puts the mix in use as a variation of its own.
 */
export const putPartInPreview = (part: PartOf) => {
  const state = useVariations.getState();
  const set = openSet(state);
  const put = state.open && set ? partInPreview(state.open, set, part) : null;
  if (state.open && put?.tree) {
    // The parts are what the mix draws: one put in over another, or in one that holds it, is
    // the part drawn now, and the other is no longer.
    const placed = findNode(put.tree, part.node);
    const holds = placed ? idsOf(placed) : new Set([part.node]);
    // Gone from the mix too: a part another took the place of, with what it held.
    const drawn = idsOf(put.tree);
    useVariations.setState({
      open: {
        ...state.open,
        mix: put.tree,
        parts: [
          ...state.open.parts.filter(
            (p) => !holds.has(p.node) && drawn.has(p.node)
          ),
          part,
        ],
      },
    });
  }
};

/** What the preview is: a variation's name, or what it is made of ("Original with Editorial's heading"). */
export const previewName = (state: VariationsStore): string => {
  const { open } = state;
  const set = openSet(state);
  if (!(open && set)) {
    return "";
  }
  const nameOf = (id: string | null) =>
    set.variations.find((v) => v.id === id)?.name ?? "As drawn";
  const current = open.parts.length > 0 ? currentThing(open) : null;
  return mixName(
    nameOf(open.preview),
    open.parts.flatMap((p) => {
      const node = findNode(treeOfVariation(set, p.variation, current), p.node);
      return node ? [{ node, variationName: nameOf(p.variation) }] : [];
    })
  );
};

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
  // The thing as drawn is the one in use once an undo puts one back.
  const at = ids.indexOf(state.open.preview ?? set.inUse);
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
  beforeClick = null;
  useVariations.setState({ open: null });
  if (open && open.selected.length > 0) {
    selectMany(open.selected);
  }
};

/** Whether text typed in a frame is written: not while its preview shows another variation. */
export const writesThrough = (frame: string): boolean => {
  const state = useVariations.getState();
  return state.open?.frame !== frame || !previewDiffers(state);
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
  if (set !== undefined && state.open?.mix) {
    return true;
  }
  // The thing as it is drawn is what is in use, whichever that is (an undo may put one back).
  return set !== undefined && preview !== null && preview !== set.inUse;
};

/**
 * The preview being put in use, by the variations it was open in: a second Use this on the same
 * joins it rather than saving it again; another preview saves its own.
 */
let putting: {
  readonly open: OpenVariations;
  readonly saved: Promise<void>;
} | null = null;

/**
 * Use this: the preview put in use, as one undo step; the variations close and the thing stays
 * selected. Pressed again while it is saved, it waits for that save.
 */
export const putPreviewInUse = (): Promise<void> => {
  const { open } = useVariations.getState();
  if (open === null) {
    return Promise.resolve();
  }
  if (!(putting && samePreview(putting.open, open))) {
    const saving = {
      open,
      saved: putPreviewOnce().finally(() => {
        if (putting === saving) {
          putting = null;
        }
      }),
    };
    putting = saving;
  }
  return putting.saved;
};

const putPreviewOnce = async () => {
  const state = useVariations.getState();
  const { open } = state;
  if (!open) {
    return;
  }
  if (open.mix !== null) {
    // A preview made of several variations joins the set as a variation of its own.
    takeVariations(
      await api().request("variations.useTree", {
        doc: open.doc,
        name: previewName(state),
        node: open.node,
        tree: open.mix,
      })
    );
    if (!samePreview(open, useVariations.getState().open)) {
      return;
    }
  } else if (previewDiffers(state) && open.preview !== null) {
    takeVariations(
      await api().request("variations.use", {
        doc: open.doc,
        node: open.node,
        variation: open.preview,
      })
    );
    // Closed and opened again while it was on its way: those are left as they are.
    if (!samePreview(open, useVariations.getState().open)) {
      return;
    }
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

/**
 * A part drawn out of its page, sized as its parent sizes it there: at the thing's width, and at
 * its height where it fills its parent's. Measured on 17 Nov (ADR 0098): of 148 parts of the
 * Redesign canvas, the 15 drawn at another height than in their page all filled their parent's
 * height; width, breakpoint and theme covered the rest.
 */
export const sizedAsInPage = (
  tree: DesignNode,
  thing: { readonly height: number; readonly width: number }
): DesignNode => {
  const width = typeof tree.width === "number" ? {} : { width: thing.width };
  const height = tree.height === "fill" ? { height: thing.height } : {};
  return { ...tree, ...width, ...height } as DesignNode;
};

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
      // A part selected beside the page is let go first.
      if (useVariations.getState().open?.part) {
        selectPart(null);
      } else {
        closeVariations();
      }
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
  const shown =
    state.open?.mix ??
    (set && state.open?.preview !== set.inUse
      ? (set.variations.find((v) => v.id === state.open?.preview)?.tree ?? null)
      : null);
  const tree = component === null ? null : shown;
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
