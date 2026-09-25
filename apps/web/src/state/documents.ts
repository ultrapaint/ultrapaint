/**
 * The design documents of the open space, as the server last saved them: every page and the
 * canvas. The layers, the inspector and the preview all read them from here; every change goes
 * to the server as operations and comes back as the documents it produced, so there is one
 * truth, and an undo or an agent's edit reaches the editor the same way.
 */
import type {
  DesignNode,
  DocOp,
  DocumentEdit,
  DocumentState,
} from "@ultrapaint/contracts/document";
import {
  canvasDocOf,
  childrenOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface DocumentsStore {
  docs: Record<string, DocumentState>;
  /** Reads every document of the space. */
  load: (space: string) => Promise<void>;
  loaded: boolean;
  put: (state: DocumentState) => void;
  space: string | null;
}

let bound = false;

export const useDocuments = create<DocumentsStore>((set, get) => ({
  docs: {},
  load: async (space) => {
    set({ docs: {}, loaded: false, space });
    try {
      const states = await api().request("documents.list", { space });
      if (get().space !== space) {
        return;
      }
      set({
        docs: Object.fromEntries(states.map((s) => [s.doc, s])),
        loaded: true,
      });
    } catch (error) {
      reportError(error);
    }
  },
  loaded: false,
  put: (state) =>
    set((s) => {
      if (state.root === null && state.problem === undefined) {
        const { [state.doc]: _gone, ...docs } = s.docs;
        return { docs };
      }
      return { docs: { ...s.docs, [state.doc]: state } };
    }),
  space: null,
}));

/** Follows every document change the server reports, whoever made it. */
export const bindDocuments = () => {
  if (bound) {
    return;
  }
  bound = true;
  api().on("document", (state) => {
    const { docs, space } = useDocuments.getState();
    const known = docs[state.doc];
    // A page of another space is not ours to show; one we already have is.
    if (known?.hash === state.hash) {
      return;
    }
    if (known || belongsTo(state.doc, space)) {
      useDocuments.getState().put(state);
    }
  });
};

const belongsTo = (doc: string, space: string | null) => {
  if (space === null) {
    return false;
  }
  if (doc === canvasDocOf(space)) {
    return true;
  }
  return space === "" || doc.startsWith(`${space}/`);
};

/** Applies operations as one undo step; the documents come back and replace the old ones. */
export const applyEdits = async (
  edits: readonly DocumentEdit[],
  label?: string
) => {
  try {
    const result = await api().request("documents.apply", {
      edits,
      ...(label !== undefined && { label }),
    });
    for (const state of result.documents) {
      useDocuments.getState().put(state);
    }
    return result;
  } catch (error) {
    reportError(error);
    return null;
  }
};

export const applyOps = (doc: string, ops: readonly DocOp[], label?: string) =>
  applyEdits([{ doc, ops }], label);

// ---- Frames ----

/** Prefix of the id of a frame showing a node placed on the canvas. */
export const NODE_FRAME_PREFIX = "node:";

export const nodeFrameOf = (nodeId: string) => `${NODE_FRAME_PREFIX}${nodeId}`;

export const isNodeFrame = (frame: string) =>
  frame.startsWith(NODE_FRAME_PREFIX);

/** The document a frame belongs to: the page it is, or the canvas of the space. */
export const docOfFrame = (frame: string, space: string | null): string =>
  isNodeFrame(frame) ? canvasDocOf(space ?? "") : frame;

const NO_NODES: readonly DesignNode[] = [];

/** The nodes on the canvas beside the pages; the same empty list when there are none. */
export const canvasNodes = (
  docs: Record<string, DocumentState>,
  space: string | null
): readonly DesignNode[] => {
  const root = space === null ? null : docs[canvasDocOf(space)]?.root;
  return root ? childrenOf(root) : NO_NODES;
};

/** What a frame draws: a page's root, or the node on the canvas it stands for. */
export const rootOfFrame = (
  docs: Record<string, DocumentState>,
  space: string | null,
  frame: string
): DesignNode | null => {
  if (isNodeFrame(frame)) {
    const id = frame.slice(NODE_FRAME_PREFIX.length);
    return canvasNodes(docs, space).find((n) => n.id === id) ?? null;
  }
  return docs[frame]?.root ?? null;
};

/** A node of a frame, by id. */
export const nodeIn = (
  docs: Record<string, DocumentState>,
  space: string | null,
  frame: string,
  id: string
): DesignNode | null => findNode(rootOfFrame(docs, space, frame), id);

/** The way down to a node inside the frame's document, the frame's root first. */
export const pathIn = (
  docs: Record<string, DocumentState>,
  space: string | null,
  frame: string,
  id: string
): DesignNode[] | null => findPath(rootOfFrame(docs, space, frame), id);

/** The frame a node of the canvas's document is shown in: its top-level ancestor's. */
export const frameOfCanvasNode = (
  docs: Record<string, DocumentState>,
  space: string | null,
  id: string
): string | null => {
  for (const top of canvasNodes(docs, space)) {
    if (findNode(top, id)) {
      return nodeFrameOf(top.id);
    }
  }
  return null;
};
