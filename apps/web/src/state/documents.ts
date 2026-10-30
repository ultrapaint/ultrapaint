/**
 * The design documents of the open canvas, as the server last saved them: every page and the
 * canvas's loose nodes. The layers, the inspector and the preview all read them from here; every change goes
 * to the server as operations and comes back as the documents it produced, so there is one
 * truth, and an undo or an agent's edit reaches the editor the same way.
 */
import {
  type DesignNode,
  type DocumentChange,
  type DocumentEdit,
  type DocumentState,
  isWholeDocument,
} from "@ultrapaint/contracts/document";
import { withChangedNodes } from "@ultrapaint/design-document/patch";
import {
  canvasDocOf,
  canvasOfDoc,
  childrenOf,
  findNode,
  findPath,
  shareUnchanged,
} from "@ultrapaint/design-document/tree";
import { canvasIdOf } from "@ultrapaint/shared/canvas";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError, useProject } from "./project.ts";
import { follow } from "./server-data.ts";
import { ensureEditable } from "./setup.ts";
import { viewedSnapshot } from "./snapshot-view.ts";

interface DocumentsStore {
  canvas: string | null;
  docs: Record<string, DocumentState>;
  /** The frame whose edits go to an app component's tree, while one does (`editFrameAs`). */
  edited: EditedAs | null;
  /** Opens a canvas's documents: every one of them, read. */
  load: (canvas: string) => Promise<void>;
  loaded: boolean;
  put: (state: DocumentState) => void;
  /**
   * Takes a change the server reports (ADR 0044): the whole document, or its changed nodes put
   * into the copy they were made over; a copy at another state reads the document again.
   */
  take: (change: DocumentChange) => void;
}

export const useDocuments = create<DocumentsStore>((set) => ({
  canvas: null,
  docs: {},
  edited: null,
  load: async (canvas) => {
    set({ canvas, docs: {}, loaded: false });
    await documentsData.read().catch(reportError);
  },
  loaded: false,
  put: (state) =>
    set((s) => {
      if (state.root === null && state.problem === undefined) {
        const { [state.doc]: _gone, ...docs } = s.docs;
        return { docs };
      }
      return { docs: { ...s.docs, [state.doc]: sharedWith(s.docs, state) } };
    }),
  take: (change) => {
    const { docs, put } = useDocuments.getState();
    const known = docs[change.doc];
    if (known?.hash === change.hash) {
      return;
    }
    if (isWholeDocument(change)) {
      put(change);
      return;
    }
    const waiting = reading.get(change.doc);
    if (waiting) {
      waiting.push(change);
      return;
    }
    const root =
      known?.hash === change.from && known.root && known.problem === undefined
        ? withChangedNodes(known.root, change.rootId, change.nodes)
        : null;
    if (root) {
      useDocuments.setState((s) => ({
        docs: {
          ...s.docs,
          [change.doc]: { doc: change.doc, hash: change.hash, root },
        },
      }));
      return;
    }
    readAgain(change.doc);
  },
}));

/** The documents being read again, with the changes reported while they are. */
const reading = new Map<string, DocumentChange[]>();

/**
 * A document read again, its copy having missed a change: what was reported while it was read is
 * taken after it, so nothing reported meanwhile is lost. A snapshot on screen reads every
 * document again when the editor goes back to now.
 */
const readAgain = (doc: string) => {
  if (reading.has(doc) || viewedSnapshot()) {
    return;
  }
  reading.set(doc, []);
  api()
    .request("documents.get", { doc })
    .then(
      (state) => {
        const waiting = reading.get(doc) ?? [];
        reading.delete(doc);
        useDocuments.getState().put(state);
        for (const change of waiting) {
          useDocuments.getState().take(change);
        }
      },
      (error: unknown) => {
        reading.delete(doc);
        reportError(error);
      }
    );
};

/**
 * A document as the server sent it, the nodes that did not change kept as they were
 * (`shareUnchanged`): what is drawn of them, and read from them, stays as it is.
 */
const sharedWith = (
  docs: Record<string, DocumentState>,
  state: DocumentState
): DocumentState => {
  const root = shareUnchanged(docs[state.doc]?.root ?? null, state.root);
  return root === state.root ? state : { ...state, root };
};

/**
 * The documents of the canvas open, and every change the server reports, whoever made it; a
 * snapshot on screen shows the ones it kept.
 */
const documentsData = follow({
  apply: (states: readonly DocumentState[]) =>
    useDocuments.setState(({ docs }) => ({
      docs: Object.fromEntries(states.map((s) => [s.doc, sharedWith(docs, s)])),
      loaded: true,
    })),
  key: () => useDocuments.getState().canvas,
  // A change told while the list is read is taken after it: the list may be older.
  news: ["document"],
  on: {
    document: (change) => {
      const { docs, canvas } = useDocuments.getState();
      // A page of another canvas is not ours to show; one we already have is.
      if (docs[change.doc] || belongsTo(change.doc, canvas)) {
        useDocuments.getState().take(change);
      }
    },
  },
  read: (canvas) => api().request("documents.list", { canvas }),
  snapshot: (view, canvas) =>
    view.documents.filter((s) => belongsTo(s.doc, canvas)),
});

/** Whether a document is the open canvas's: one of its pages, or its loose nodes. */
export const belongsTo = (doc: string, canvas: string | null) => {
  if (canvas === null) {
    return false;
  }
  if (doc === canvasDocOf(canvas)) {
    return true;
  }
  // A canvas nested in another holds its own pages: the longest canvas path that holds the file.
  const ids = useProject.getState().canvases.map((c) => c.id);
  return canvasOfDoc(doc) === null && canvasIdOf(ids, doc) === canvas;
};

/**
 * Applies operations as one undo step; the documents come back and replace the old ones. The
 * editor's edits to nodes are `lib/node-actions.ts`'s, which knows where each lands.
 */
export const applyEdits = async (
  edits: readonly DocumentEdit[],
  label?: string
) => {
  if (!ensureEditable()) {
    return null;
  }
  try {
    const result = await api().request("documents.apply", {
      edits,
      ...(label !== undefined && { label }),
    });
    for (const change of result.changes) {
      useDocuments.getState().take(change);
    }
    return result;
  } catch (error) {
    reportError(error);
    return null;
  }
};

// ---- Frames ----

/** Prefix of the id of a frame showing a node placed on the canvas. */
export const NODE_FRAME_PREFIX = "node:";

export const nodeFrameOf = (nodeId: string) => `${NODE_FRAME_PREFIX}${nodeId}`;

export const isNodeFrame = (frame: string) =>
  frame.startsWith(NODE_FRAME_PREFIX);

/**
 * Prefix of the id of a board's frame (ADR 0045), `board:<view>/<item>/<name>`: a document the
 * editor generates for the item a board view shows, which is no page and no node of the canvas.
 */
export const BOARD_FRAME_PREFIX = "board:";

/** Where a board's frame is: the board view, the item it shows, and the board's own name. */
export interface BoardFrame {
  readonly item: string;
  readonly name: string;
  readonly view: string;
}

export const boardFrameOf = ({ item, name, view }: BoardFrame) =>
  `${BOARD_FRAME_PREFIX}${view}/${item}/${name}`;

export const isBoardFrame = (frame: string) =>
  frame.startsWith(BOARD_FRAME_PREFIX);

/**
 * The board a frame id names; null for any other frame. An item may hold a slash (a guideline's
 * heading): the view is before the first, the board's name after the last.
 */
export const boardOfFrame = (frame: string): BoardFrame | null => {
  if (!isBoardFrame(frame)) {
    return null;
  }
  const rest = frame.slice(BOARD_FRAME_PREFIX.length);
  const first = rest.indexOf("/");
  const last = rest.lastIndexOf("/");
  if (first < 0 || last === first) {
    return null;
  }
  return {
    item: rest.slice(first + 1, last),
    name: rest.slice(last + 1),
    view: rest.slice(0, first),
  };
};

/**
 * What separates a page from one of its views in a view's frame id, `<page>#<view>` (ADR 0036):
 * a view is a frame of its own whose document is the page's.
 */
const VIEW_SEPARATOR = "#";

export const viewFrameOf = (page: string, view: string) =>
  `${page}${VIEW_SEPARATOR}${view}`;

export const isViewFrame = (frame: string) =>
  !(isNodeFrame(frame) || isBoardFrame(frame)) &&
  frame.includes(VIEW_SEPARATOR);

/** The page a frame shows: itself, or the page a view of it draws again. */
export const pageOfFrame = (frame: string): string =>
  isViewFrame(frame) ? frame.slice(0, frame.indexOf(VIEW_SEPARATOR)) : frame;

/** The view a frame is, by its id inside its page; null for the page's own frame. */
export const viewOfFrame = (frame: string): string | null =>
  isViewFrame(frame)
    ? frame.slice(frame.indexOf(VIEW_SEPARATOR) + VIEW_SEPARATOR.length)
    : null;

/**
 * A frame whose edits go to another document: an app component's tree edited in place in it
 * (ADR 0041, `isolation.ts`), at one of its variants (`size=lg`) or at its own fields.
 */
export interface EditedAs {
  /** The variant the edits land on, as a node's `at` keeps it; null for the node's own fields. */
  readonly at: string | null;
  readonly doc: string;
  readonly frame: string;
}

let editedAs: EditedAs | null = null;

/** Edits made in a frame go to another document from now on; null puts every frame back to its own. */
export const editFrameAs = (edited: EditedAs | null) => {
  editedAs = edited;
  useDocuments.setState({ edited });
};

/** The variant a frame's edits land on, while a component is edited in place in it at one. */
export const editedAtOf = (frame: string): string | null =>
  editedAs?.frame === frame ? editedAs.at : null;

/** The document a frame shows: the page it is, or the canvas's loose nodes. */
const shownDocOf = (frame: string, canvas: string | null): string =>
  isNodeFrame(frame) ? canvasDocOf(canvas ?? "") : pageOfFrame(frame);

/**
 * The document a frame's selection and edits belong to: the one it shows, or the app component
 * edited in place in it.
 */
export const docOfFrame = (frame: string, canvas: string | null): string =>
  editedAs?.frame === frame ? editedAs.doc : shownDocOf(frame, canvas);

const NO_NODES: readonly DesignNode[] = [];

/** The nodes on the canvas beside the pages; the same empty list when there are none. */
export const canvasNodes = (
  docs: Record<string, DocumentState>,
  canvas: string | null
): readonly DesignNode[] => {
  const root = canvas === null ? null : docs[canvasDocOf(canvas)]?.root;
  return root ? childrenOf(root) : NO_NODES;
};

/**
 * What a frame's selection and edits are in: what it draws, or the tree of the app component
 * edited in place in it.
 */
export const rootOfFrame = (
  docs: Record<string, DocumentState>,
  canvas: string | null,
  frame: string
): DesignNode | null =>
  editedAs?.frame === frame
    ? (docs[editedAs.doc]?.root ?? null)
    : drawnRootOf(docs, canvas, frame);

/**
 * What a frame draws: a page's root, or the node on the canvas it stands for. A board's frame
 * draws what its board generates, none of the documents.
 */
export const drawnRootOf = (
  docs: Record<string, DocumentState>,
  canvas: string | null,
  frame: string
): DesignNode | null => {
  if (isBoardFrame(frame)) {
    return null;
  }
  if (isNodeFrame(frame)) {
    const id = frame.slice(NODE_FRAME_PREFIX.length);
    return canvasNodes(docs, canvas).find((n) => n.id === id) ?? null;
  }
  return docs[pageOfFrame(frame)]?.root ?? null;
};

/** A node of a frame, by id. */
export const nodeIn = (
  docs: Record<string, DocumentState>,
  canvas: string | null,
  frame: string,
  id: string
): DesignNode | null => findNode(rootOfFrame(docs, canvas, frame), id);

/** The way down to a node inside the frame's document, the frame's root first. */
export const pathIn = (
  docs: Record<string, DocumentState>,
  canvas: string | null,
  frame: string,
  id: string
): DesignNode[] | null => findPath(rootOfFrame(docs, canvas, frame), id);

/** The frame a node of the canvas's document is shown in: its top-level ancestor's. */
export const frameOfCanvasNode = (
  docs: Record<string, DocumentState>,
  canvas: string | null,
  id: string
): string | null => {
  for (const top of canvasNodes(docs, canvas)) {
    if (findNode(top, id)) {
      return nodeFrameOf(top.id);
    }
  }
  return null;
};
