/**
 * The context menu's two halves that touch the editor: the facts a target's menu is built from,
 * read off the stores when it opens, and what each of its items does. What the menus hold is
 * `menu-model.ts`'s.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import { attachTextStyle } from "@ultrapaint/design-document/text-styles";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { bridgeFor } from "../canvas/bridge.ts";
import { canvasPoint, insertAt } from "../canvas/drag.ts";
import { sendComment } from "../canvas/send-to-agent.tsx";
import { confirmDialog } from "../components/dialogs.tsx";
import { useAgents } from "../state/agents.ts";
import {
  deleteComment,
  pageOfComment,
  revealComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import type { MenuTarget, Point } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { isNodeFrame, nodeIn, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { addToChat } from "./add-to-chat.ts";
import {
  copyNode,
  cutNode,
  pasteAt,
  pasteInto,
  pasteIntoPage,
  useClipboard,
} from "./clipboard.ts";
import {
  canvasEntries,
  commentEntries,
  componentEntries,
  type Entry,
  nodeEntries,
  pageEntries,
  routeEntries,
  type TokenField,
  textStyleEntries,
  threadEntries,
  tokenEntries,
} from "./menu-model.ts";
import {
  type Arrangement,
  arrangeNode,
  deleteSelection,
  duplicateSelection,
  insertNode,
  insertTarget,
  nodeContext,
  placeOf,
  renameNode,
  selected,
  selectParent,
  setHidden,
  unwrapSelection,
  updateSelection,
  wrapSelection,
} from "./node-actions.ts";
import { copyNodeLink, copyNodeRef } from "./node-links.ts";
import {
  deletePage,
  duplicatePage,
  goToPage,
  implementPage,
  newPage,
  pageById,
  renamePage,
  setPagePreset,
  zoomToPage,
} from "./page-actions.ts";
import { viewportSize } from "./shortcuts.ts";
import {
  deleteThread,
  openChat,
  stopThread,
  toggleFollowing,
} from "./thread-actions.ts";

export const copyText = (text: string, what = text) => {
  navigator.clipboard?.writeText(text).then(
    () => toast(`Copied ${what}`),
    () => undefined
  );
};

const canPaste = () => useClipboard.getState().node !== null;

const onCanvas = () => useEditor.getState().workspace !== "prototype";

const commentById = (id: string) =>
  useComments.getState().comments.find((c) => c.id === id);

// ---- What a menu holds ----

const nodeMenu = (target: Selection): Entry[] | null => {
  const ctx = nodeContext(target);
  const current = selected(ctx);
  if (!current) {
    return null;
  }
  const place = placeOf(ctx);
  return nodeEntries({
    canPaste: canPaste(),
    index: place?.siblings.findIndex((c) => c.id === current.node.id) ?? 0,
    node: current.node,
    onPage: !isNodeFrame(target.frame),
    parentSelectable: !!place?.parent && place.parent.type !== "page",
    siblings: place?.siblings.length ?? 1,
  });
};

/** The entries of a target's menu; null when what it was for is gone. */
export const entriesFor = (target: MenuTarget): Entry[] | null => {
  switch (target.kind) {
    case "node":
      return nodeMenu(target);
    case "page": {
      const page = pageById(target.pageId);
      return page
        ? pageEntries({
            canPaste: canPaste(),
            name: page.name,
            onCanvas: onCanvas(),
            preset: useEditor.getState().frames[page.id]?.preset ?? null,
            route: page.route,
          })
        : null;
    }
    case "canvas":
      return canvasEntries({
        canPaste: canPaste(),
        commentsVisible: useComments.getState().visible,
      });
    case "route":
      return routeEntries(target.route);
    case "comment": {
      const comment = commentById(target.commentId);
      if (!comment) {
        return null;
      }
      const { current: id, threads } = useAgents.getState();
      const current = threads.find((t) => t.id === id);
      return commentEntries({
        current: current
          ? {
              busy:
                current.status === "running" || current.status === "cancelling",
              title: current.title,
            }
          : null,
        hasElement: !!comment.nodeId && !!pageOfComment(comment),
        resolved: comment.resolved,
      });
    }
    case "token":
      return tokenEntries({
        kind: target.tokenKind,
        name: target.name,
        selected: selected()?.node ?? null,
        value: target.value,
      });
    case "textStyle":
      return textStyleEntries({
        name: target.name,
        selected: selected()?.node ?? null,
      });
    case "component":
      return componentEntries({
        isComponent: target.isComponent,
        name: target.name,
        onCanvas: onCanvas() && useEditor.getState().space !== null,
        target: insertTarget()?.name ?? null,
      });
    case "thread": {
      const thread = useAgents
        .getState()
        .threads.find((t) => t.id === target.threadId);
      return thread
        ? threadEntries({
            following: useAgents.getState().following === thread.id,
            running:
              thread.status === "running" || thread.status === "cancelling",
            title: thread.title,
          })
        : null;
    }
    default:
      return null;
  }
};

// ---- What an item does ----

const select = (target: Selection) => useEditor.getState().select(target);

/** The code the node stands for is in the right panel, which only the design workspace has. */
const viewCode = (target: Selection) => {
  const editor = useEditor.getState();
  if (editor.workspace !== "design") {
    editor.setWorkspace("design");
  }
  editor.select(target);
  editor.setRightTab("code");
};

/**
 * Starts a comment on the node: where it was clicked, else in the middle of it. Comments are
 * pinned on pages, so a node of the canvas has none.
 */
const commentOn = async (target: Selection, at?: Point) => {
  const { docs } = useDocuments.getState();
  const node = nodeIn(
    docs,
    useEditor.getState().space,
    target.frame,
    target.nodeId
  );
  if (!node || isNodeFrame(target.frame)) {
    return;
  }
  let point = at;
  if (!point) {
    const rect = (await bridgeFor(target.frame).measure([node.id]))[node.id];
    point = rect
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      : { x: 24, y: 24 };
  }
  startComment(target.frame, point, node);
};

const startComment = (pageId: string, at: Point, node?: DesignNode) => {
  const comments = useComments.getState();
  if (!comments.visible) {
    comments.toggleVisible();
  }
  const pinned = node && node.type !== "page" ? node : null;
  comments.setDraft({
    element: pinned ? nodeLabel(pinned) : null,
    nodeId: pinned?.id ?? null,
    pageId,
    x: Math.round(at.x),
    y: Math.round(at.y),
  });
};

const zoomToNode = (target: Selection) => {
  select(target);
  useEditor.getState().zoomToSelection(viewportSize());
};

const editText = (target: Selection) => {
  select(target);
  bridgeFor(target.frame).editText(target.nodeId);
};

/** Items whose id carries an argument: `wrap:row`, `arrange:up`. */
const argOf = (id: string) => id.slice(id.indexOf(":") + 1);

const runNode = (target: Selection & { at?: Point }, id: string) => {
  const sel = { frame: target.frame, nodeId: target.nodeId };
  const node = selected(nodeContext(sel))?.node;
  if (!node) {
    return;
  }
  if (id.startsWith("wrap:")) {
    wrapSelection(argOf(id) as "row" | "column" | "group", sel);
    return;
  }
  if (id.startsWith("arrange:")) {
    arrangeNode(argOf(id) as Arrangement, sel);
    return;
  }
  const actions: Record<string, () => unknown> = {
    ask: () => addToChat(sel),
    comment: () => commentOn(sel, target.at),
    copy: () => copyNode(sel),
    copyLink: () => copyNodeLink(sel),
    copyRef: () => copyNodeRef(sel),
    cut: () => cutNode(sel),
    delete: () => deleteSelection(sel),
    duplicate: () => duplicateSelection(sel),
    editText: () => editText(sel),
    paste: () => pasteInto(sel),
    rename: () => renameNode(sel),
    selectParent: () => selectParent(sel),
    toggleHidden: () => setHidden(!node.hidden, sel),
    unwrap: () => unwrapSelection(sel),
    viewCode: () => viewCode(sel),
    zoomTo: () => zoomToNode(sel),
  };
  actions[id]?.();
};

const runPage = (pageId: string, id: string, at?: Point) => {
  const page = pageById(pageId);
  if (!page) {
    return;
  }
  if (id.startsWith("preset:")) {
    setPagePreset(page, argOf(id) as ViewportPreset);
    return;
  }
  const actions: Record<string, () => unknown> = {
    comment: () => startComment(page.id, at ?? { x: 40, y: 40 }),
    delete: () => deletePage(page),
    duplicate: () => duplicatePage(page),
    goTo: () => goToPage(page),
    implement: () => implementPage(page),
    paste: () => pasteIntoPage(page.id),
    rename: () => renamePage(page),
    zoomTo: () => zoomToPage(page),
  };
  actions[id]?.();
};

const runCanvas = (at: Point, id: string) => {
  const editor = useEditor.getState();
  const actions: Record<string, () => unknown> = {
    newPage: () => newPage(),
    paste: () => pasteAt(at),
    toggleComments: () => useComments.getState().toggleVisible(),
    "tool:group": () => editor.setMode("group"),
    "tool:text": () => editor.setMode("text"),
    zoom100: () => editor.setView({ zoom: 1 }),
    zoomFit: () => editor.zoomToFit(viewportSize()),
  };
  actions[id]?.();
};

const runComment = async (commentId: string, id: string) => {
  const comment = commentById(commentId);
  if (!comment) {
    return;
  }
  switch (id) {
    case "open":
      revealComment(comment);
      break;
    case "selectElement": {
      const page = pageOfComment(comment);
      if (page && comment.nodeId) {
        select({ frame: page.id, nodeId: comment.nodeId });
      }
      break;
    }
    case "resolve":
      updateComment(comment.id, { resolved: !comment.resolved });
      break;
    case "send:current": {
      const { current } = useAgents.getState();
      if (current) {
        sendComment(comment, { threadId: current }, undefined);
      }
      break;
    }
    case "send:new":
      sendComment(comment, { newThread: true }, undefined);
      break;
    case "copyText":
      copyText(comment.text, "the comment");
      break;
    case "delete":
      if (
        await confirmDialog({
          confirmLabel: "Delete",
          description: "Its replies go with it.",
          destructive: true,
          title: "Delete this comment?",
        })
      ) {
        deleteComment(comment.id);
      }
      break;
    default:
      break;
  }
};

/** What setting a field to a token writes: a border keeps its width and style. */
const tokenSet = (
  field: TokenField["field"],
  ref: string,
  node: DesignNode
): Record<string, JsonValue> =>
  field === "border.color"
    ? { border: { ...node.border, color: ref } }
    : { [field]: ref };

const runToken = (name: string, value: string, id: string) => {
  if (id === "copyRef") {
    copyText(tokenRef(name));
    return;
  }
  if (id === "copyValue") {
    copyText(value);
    return;
  }
  const node = selected()?.node;
  if (node && id.startsWith("apply:")) {
    const field = argOf(id) as TokenField["field"];
    updateSelection(tokenSet(field, tokenRef(name), node), `Apply ${name}`);
  }
};

const runTextStyle = (name: string, id: string) => {
  if (id === "copyName") {
    copyText(name);
    return;
  }
  const style = useDesignSystem
    .getState()
    .designSystem?.typography.styles.find((s) => s.name === name);
  if (style && selected()?.node.type === "text") {
    updateSelection(attachTextStyle(style), `Set the text in ${name}`);
  }
};

/** Puts a new node on the canvas, in the middle of what can be seen of it. */
const insertOnCanvas = (node: DesignNode) => {
  const el = document.querySelector("[data-canvas]");
  const { x, width, height } = viewportSize();
  const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const at = canvasPoint(r.left + x + width / 2, r.top + height / 2);
  return insertAt({ kind: "canvas" }, node, at);
};

const runComponent = (
  target: Extract<MenuTarget, { kind: "component" }>,
  id: string
) => {
  const actions: Record<string, () => unknown> = {
    copyName: () => copyText(target.name),
    insert: () => insertNode(target.make()),
    insertCanvas: () => insertOnCanvas(target.make()),
  };
  actions[id]?.();
};

const runThread = (threadId: string, id: string) => {
  const actions: Record<string, () => unknown> = {
    delete: () => deleteThread(threadId),
    follow: () => toggleFollowing(threadId),
    open: () => openChat(threadId),
    stop: () => stopThread(threadId),
  };
  actions[id]?.();
};

export const runEntry = (target: MenuTarget, id: string) => {
  switch (target.kind) {
    case "node":
      runNode(target, id);
      break;
    case "page":
      runPage(target.pageId, id, target.at);
      break;
    case "canvas":
      runCanvas(target.at, id);
      break;
    case "route":
      if (id === "newPage") {
        newPage(target.route);
      } else if (id === "copyRoute") {
        copyText(target.route);
      }
      break;
    case "comment":
      runComment(target.commentId, id);
      break;
    case "token":
      runToken(target.name, target.value, id);
      break;
    case "textStyle":
      runTextStyle(target.name, id);
      break;
    case "component":
      runComponent(target, id);
      break;
    case "thread":
      runThread(target.threadId, id);
      break;
    default:
      break;
  }
};
