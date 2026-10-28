import type {
  Comment,
  CommentList,
  CommentReply,
} from "@ultrapaint/contracts/comments";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { viewportSize } from "../lib/shortcuts.ts";
import { useAgents } from "./agents.ts";
import { attachmentsOf, chipOfComment } from "./attachments.ts";
import { setView } from "./camera.ts";
import { commentPrompt, commentThreadTitle } from "./comment-prompt.ts";
import { api } from "./connection.ts";
import { pagesOfCanvas, useEditor } from "./editor.ts";
import { goTo } from "./location.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

/** A comment being written: where it was placed, before it has any text. */
export interface CommentDraft {
  element: string | null;
  nodeId: string | null;
  pageId: string;
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
  on: {
    comments: ({ list, canvas }) => {
      if (canvas === useComments.getState().canvas) {
        useComments.setState({ comments: list.comments });
      }
    },
  },
  read: (canvas) => api().request("comments.list", { canvas }),
});

/** The page a comment is on, among the pages of the open canvas. */
export const pageOfComment = (comment: Comment): Page | undefined =>
  pagesOfCanvas(useEditor.getState().canvas).find(
    (p) => p.path === comment.page
  );

const currentCanvas = () => useComments.getState().canvas ?? "";

/**
 * Posts the comment being written; a behaviour note (ADR 0030) says what the code must do that
 * the design cannot show, and goes to the code when the page is implemented.
 */
export const postDraft = async (
  text: string,
  kind: "comment" | "behaviour" = "comment"
) => {
  const { draft } = useComments.getState();
  const page = pagesOfCanvas(useEditor.getState().canvas).find(
    (p) => p.id === draft?.pageId
  );
  if (!(draft && page && text.trim())) {
    return;
  }
  try {
    const comment = await api().request("comments.create", {
      canvas: currentCanvas(),
      element: draft.element,
      kind,
      nodeId: draft.nodeId,
      page: page.path,
      text: text.trim(),
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

/**
 * Starts writing a comment at a point of a page, pinned on `node` when it is one of the page's
 * elements. Returns the draft, which a later call replaces.
 */
export const startComment = (
  pageId: string,
  at: { x: number; y: number },
  node?: DesignNode | null
): CommentDraft => {
  showComments();
  const pinned = node && node.type !== "page" ? node : null;
  const draft = {
    element: pinned ? nodeLabel(pinned) : null,
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
 * in the prototype, on its page, which the prototype goes to.
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
  const frame = page ? editor.frames[page.id] : undefined;
  if (!(page && frame)) {
    return;
  }
  showComments();
  const viewport = viewportSize();
  const { zoom } = editor.view;
  setView({
    x: viewport.x + viewport.width / 2 - (frame.x + comment.x) * zoom,
    y: viewport.height / 2 - (frame.y + comment.y) * zoom,
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
