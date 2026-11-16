import type {
  Comment,
  CommentList,
  CommentReply,
} from "@ultrapaint/contracts/comments";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { useAgents } from "./agents.ts";
import { attachmentsOf, chipOfComment } from "./attachments.ts";
import { setView, viewportSize } from "./camera.ts";
import { commentPrompt, commentThreadTitle } from "./comment-prompt.ts";
import { api } from "./connection.ts";
import { frameOfCanvasNode, useDocuments } from "./documents.ts";
import { type EditorState, pagesOfCanvas, useEditor } from "./editor.ts";
import { frameRefOf, pageOfRef, viewFrameOf } from "./frame-ref.ts";
import { goTo } from "./location.ts";
import { pageCanvasFrames } from "./page-layout.ts";
import { reportError, useProject } from "./project.ts";
import { follow } from "./server-data.ts";

/** A comment being written: where it was placed, before it has any text. */
export interface CommentDraft {
  element: string | null;
  /**
   * The frame it was placed in, which alone draws it, in whose pixels `x`/`y` are: a page's own,
   * one of its views, a node's beside the pages, the prototype's; null on the canvas itself.
   */
  frame: string | null;
  nodeId: string | null;
  /** The page it is on, by id; null on the canvas, beside the pages. */
  pageId: string | null;
  x: number;
  y: number;
}

const VISIBLE_KEY = "ultrapaint:comments-visible";

interface CommentsStore {
  canvas: string | null;
  /** Comments of the open canvas, resolved ones included. */
  comments: readonly Comment[];
  draft: CommentDraft | null;
  /** Opens a canvas's comments. */
  load: (canvas: string) => Promise<void>;
  /** The comment whose card is open on the canvas. */
  open: string | null;
  setDraft: (draft: CommentDraft | null) => void;
  setOpen: (id: string | null) => void;
  setShowResolved: (show: boolean) => void;
  /** Whether the panel lists resolved comments too. The canvas never shows them. */
  showResolved: boolean;
  toggleVisible: () => void;
  /** Whether the pins are drawn on the canvas at all. */
  visible: boolean;
}

export const useComments = create<CommentsStore>((set, get) => ({
  canvas: null,
  comments: [],
  draft: null,
  load: async (canvas) => {
    set({ canvas, comments: [], draft: null, open: null });
    await commentsData.read().catch(reportError);
  },
  open: null,
  setDraft: (draft) => set({ draft, ...(draft && { open: null }) }),
  setOpen: (open) => set({ open, ...(open && { draft: null }) }),
  setShowResolved: (showResolved) => set({ showResolved }),
  showResolved: false,
  toggleVisible: () => {
    const visible = !get().visible;
    localStorage.setItem(VISIBLE_KEY, String(visible));
    set({ visible, ...(!visible && { draft: null, open: null }) });
  },
  visible: localStorage.getItem(VISIBLE_KEY) !== "false",
}));

/** The comments of the canvas open; a snapshot keeps none, so they stay the files' (ADR 0019). */
const commentsData = follow({
  apply: ({ comments }: CommentList) => useComments.setState({ comments }),
  key: () => useComments.getState().canvas,
  // Every canvas's comments are told; one told while a read is on its way waits for its answer.
  news: ["comments"],
  on: {
    comments: ({ list, canvas }) => {
      if (canvas === useComments.getState().canvas) {
        useComments.setState({ comments: list.comments });
      }
    },
  },
  read: (canvas) => api().request("comments.list", { canvas }),
});

/** The page a comment is on, among the pages of the open canvas; none for one on the canvas. */
export const pageOfComment = (comment: Comment): Page | undefined =>
  comment.page === null
    ? undefined
    : pagesOfCanvas(useEditor.getState().canvas).find(
        (p) => p.path === comment.page
      );

/**
 * Whether a comment has a spot on its page. One written through a tool (an agent's behaviour
 * note, ADR 0030) was never placed and sits at the page's corner, 0 0: it is not pinned on the
 * canvas but listed in the inspector of what it is on and in the Comments panel (ADR 0085, 0086).
 * One on the canvas itself was always placed.
 */
export const hasSpot = (comment: Pick<Comment, "page" | "x" | "y">) =>
  comment.page === null || comment.x !== 0 || comment.y !== 0;

/**
 * Where the page canvas's frames are, as far as its comments ask: what says which frame a comment is
 * drawn in (`commentFrame`).
 */
export interface CommentLayout {
  /** The frame of the node of the canvas a node is in, when it is one of them. */
  readonly nodeFrame: (nodeId: string) => string | null;
  /** A page of the canvas's id, by its path. */
  readonly pageId: (path: string) => string | undefined;
  /** The views a page has, by id (ADR 0036). */
  readonly views: (pageId: string) => readonly string[];
}

/**
 * The one place of the page canvas a comment is drawn (ADR 0097): a frame, by id, or the canvas
 * itself (null). A page's comment is in the view it was left in, else in the page's own frame,
 * which also takes back the comments of a view taken away. A comment on the canvas is in the frame
 * of the node it was left on, beside the pages, so it moves with it, else on the canvas. Undefined
 * when it is drawn nowhere: its page is not on this canvas.
 */
export const commentFrame = (
  comment: Pick<Comment, "nodeId" | "page" | "view">,
  layout: CommentLayout
): string | null | undefined => {
  if (comment.page === null) {
    return comment.nodeId === null ? null : layout.nodeFrame(comment.nodeId);
  }
  const page = layout.pageId(comment.page);
  if (page === undefined) {
    return;
  }
  return comment.view !== null && layout.views(page).includes(comment.view)
    ? viewFrameOf(page, comment.view)
    : page;
};

/** The comment layout of a canvas, from its pages, the frames' layout and its documents. */
export const commentLayoutOf = (
  canvas: string | null,
  pages: readonly Page[],
  frames: EditorState["frames"],
  docs: Record<string, DocumentState>
): CommentLayout => {
  const here = pages.filter((p) => p.canvas === canvas);
  return {
    nodeFrame: (nodeId) => frameOfCanvasNode(docs, canvas, nodeId),
    pageId: (path) => here.find((p) => p.path === path)?.id,
    views: (pageId) => (frames[pageId]?.views ?? []).map((v) => v.id),
  };
};

/** The open canvas's comment layout as it is now. */
export const commentLayoutNow = (): CommentLayout => {
  const { canvas, frames } = useEditor.getState();
  return commentLayoutOf(
    canvas,
    useProject.getState().pages,
    frames,
    useDocuments.getState().docs
  );
};

/**
 * Whether a frame of the page canvas, or the canvas itself (null), holds the card that is open or
 * the comment being written: it is lifted over its neighbours, so they do not cover the card.
 */
export const holdsCard = (
  s: Pick<CommentsStore, "comments" | "draft" | "open">,
  frame: string | null
): boolean => {
  if (s.draft) {
    return s.draft.frame === frame;
  }
  const open = s.open === null ? null : s.comments.find((c) => c.id === s.open);
  return open ? commentFrame(open, commentLayoutNow()) === frame : false;
};

/**
 * The open behaviour notes on one thing of a page, oldest first: on the page as a whole
 * (`nodeId` null, or the page's root `rootId`), or on one element.
 */
export const behaviourNotesOf = (
  comments: readonly Comment[],
  pagePath: string,
  on: { nodeId: string } | { rootId: string }
): Comment[] =>
  comments.filter(
    (c) =>
      c.page === pagePath &&
      c.kind === "behaviour" &&
      !c.resolved &&
      ("nodeId" in on
        ? c.nodeId === on.nodeId
        : c.nodeId === null || c.nodeId === on.rootId)
  );

const currentCanvas = () => useComments.getState().canvas ?? "";

/** The view of a page a comment placed in a frame is on: none but in a view's frame. */
const viewOfFrame = (frame: string | null) => {
  const ref = frame === null ? null : frameRefOf(frame);
  return ref?.kind === "view" ? ref.view : null;
};

/**
 * Posts the comment being written; a behaviour note (ADR 0030) says what the code must do that
 * the design cannot show, and goes to the code when the page is implemented: a comment on the
 * canvas is never one.
 */
export const postDraft = async (
  text: string,
  kind: "comment" | "behaviour" = "comment"
) => {
  const { draft } = useComments.getState();
  if (!(draft && text.trim())) {
    return;
  }
  const page =
    draft.pageId === null
      ? null
      : pagesOfCanvas(useEditor.getState().canvas).find(
          (p) => p.id === draft.pageId
        );
  if (page === undefined) {
    return;
  }
  try {
    const comment = await api().request("comments.create", {
      canvas: currentCanvas(),
      element: draft.element,
      kind: page === null ? "comment" : kind,
      nodeId: draft.nodeId,
      page: page?.path ?? null,
      text: text.trim(),
      view: viewOfFrame(draft.frame),
      x: draft.x,
      y: draft.y,
    });
    useComments.setState({ draft: null });
    useComments.getState().setOpen(comment.id);
  } catch (error) {
    reportError(error);
  }
};

export const updateComment = (
  id: string,
  change: {
    kind?: "comment" | "behaviour";
    resolved?: boolean;
    text?: string;
  }
) =>
  api()
    .request("comments.update", { canvas: currentCanvas(), id, ...change })
    .then((comment) => {
      // A resolved comment leaves the canvas, and its card with it.
      if (comment.resolved && useComments.getState().open === id) {
        useComments.getState().setOpen(null);
      }
    })
    .catch(reportError);

export const replyTo = (id: string, text: string) =>
  api()
    .request("comments.reply", {
      canvas: currentCanvas(),
      id,
      text: text.trim(),
    })
    .then(() => true)
    .catch((error) => {
      reportError(error);
      return false;
    });

export const deleteReply = (id: string, replyId: string) =>
  api()
    .request("comments.deleteReply", { canvas: currentCanvas(), id, replyId })
    .catch(reportError);

export const deleteComment = (id: string) => {
  if (useComments.getState().open === id) {
    useComments.getState().setOpen(null);
  }
  api()
    .request("comments.delete", { canvas: currentCanvas(), id })
    .catch(reportError);
};

/** Comments are asked to be seen whenever one is opened or started. */
const showComments = () => {
  if (!useComments.getState().visible) {
    useComments.getState().toggleVisible();
  }
};

/** Opens a comment's card where it is, without moving the canvas: a note from the inspector. */
export const openComment = (id: string) => {
  showComments();
  useComments.getState().setOpen(id);
};

/**
 * Starts writing a comment at a point of a frame, in its pixels, pinned on `node` when it is one
 * of its elements; with `frame` null, at a point of the canvas itself (ADR 0097). The frame is a
 * page's own, a view of it (ADR 0036), whose comment is the page's but drawn in that view alone,
 * or a node's beside the pages, whose comment is the canvas's and moves with the node. `pageId`
 * names the page of a frame that does not say it, the prototype's. Returns the draft, which a
 * later call replaces.
 */
export const startComment = (
  frame: string | null,
  at: { x: number; y: number },
  node?: DesignNode | null,
  pageId: string | null = frame === null ? null : pageOfRef(frameRefOf(frame))
): CommentDraft => {
  showComments();
  const pinned = node && node.type !== "page" ? node : null;
  const draft = {
    element: pinned ? nodeLabel(pinned) : null,
    frame,
    nodeId: pinned?.id ?? null,
    pageId,
    x: Math.round(at.x),
    y: Math.round(at.y),
  };
  useComments.getState().setDraft(draft);
  return draft;
};

/**
 * The prototype's comment mode, on or off: on, a click on the page drops a comment instead of
 * reaching the page.
 */
export const toggleCommenting = () => {
  const editor = useEditor.getState();
  if (editor.mode === "comment") {
    editor.setMode("interact");
    return;
  }
  editor.setMode("comment");
  showComments();
};

/**
 * Brings a comment into view and opens it: in the middle of what can be seen of the canvas, or,
 * in the prototype, on its page, which the prototype goes to. One on the canvas itself is shown
 * on the canvas, which the prototype gives way to.
 */
export const revealComment = (comment: Comment) => {
  const page = pageOfComment(comment);
  const editor = useEditor.getState();
  if (page && editor.workspace === "prototype") {
    goTo({ page: page.id });
    showComments();
    useComments.getState().setOpen(comment.id);
    return;
  }
  const frame = commentFrame(comment, commentLayoutNow());
  if (frame === undefined) {
    return;
  }
  const box = frame === null ? { x: 0, y: 0 } : pageCanvasFrames()[frame];
  if (!box) {
    return;
  }
  editor.setWorkspace("design");
  showComments();
  const viewport = viewportSize();
  const { zoom } = editor.view;
  setView({
    x: viewport.x + viewport.width / 2 - (box.x + comment.x) * zoom,
    y: viewport.height / 2 - (box.y + comment.y) * zoom,
  });
  useComments.getState().setOpen(comment.id);
};

/** Where a comment goes: the agent thread in use, or a new one with the chat's default agent. */
export type SendTarget = { threadId: string } | { newThread: true };

/**
 * Sends a comment's thread, or one message of it, to an agent as a prompt. The page file and
 * the element the comment is pinned on go along, the way the chat attaches the selection.
 * Resolves to the thread it went to, or null when it could not be sent.
 */
export const sendToAgent = async (
  comment: Comment,
  target: SendTarget,
  reply?: CommentReply
): Promise<{ id: string; title: string } | null> => {
  const page = pageOfComment(comment);
  const attachments = attachmentsOf(page ? [chipOfComment(comment, page)] : []);
  try {
    const thread =
      "threadId" in target
        ? useAgents.getState().threads.find((t) => t.id === target.threadId)
        : await api().request("threads.create", {
            title: commentThreadTitle((reply ?? comment).text),
          });
    if (!thread) {
      return null;
    }
    await api().request("threads.prompt", {
      attachments,
      text: commentPrompt(comment, page, reply),
      threadId: thread.id,
    });
    return { id: thread.id, title: thread.title };
  } catch (error) {
    reportError(error);
    return null;
  }
};
