/**
 * A target's context menu, as the menu host and the command palette ask for it: `menuFor` reads
 * the facts the target's menu is built from off the stores and gives its items, each with its
 * action bound to the target; `runMenuAction` does what an action says, one case for each. What
 * the menus hold is `menu-model.ts`'s.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import { familyOf } from "@ultrapaint/contracts/canvas-layout";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { isBusy } from "@ultrapaint/contracts/threads";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { toast } from "sonner";
import { canvasPoint } from "../canvas/drag.ts";
import { frameOf } from "../canvas/editor-frame.ts";
import { sendComment } from "../canvas/send-to-agent.tsx";
import { confirmDialog, promptDialog } from "../components/dialogs.tsx";
import { askLinkUrl } from "../components/link-field.tsx";
import { useAgents } from "../state/agents.ts";
import { zoomToSelection } from "../state/camera.ts";
import { placeOnCanvas, useCanvasGrid } from "../state/canvas-grid.ts";
import {
  deleteComment,
  pageOfComment,
  revealComment,
  startComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import { api } from "../state/connection.ts";
import type { MenuTarget, Point } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { isNodeFrame, nodeIn, useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, type Selection, useEditor } from "../state/editor.ts";
import { useImplementation } from "../state/implementation.ts";
import { pagesActedOn } from "../state/page-picks.ts";
import { showRightPanel } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { addToChat } from "./add-to-chat.ts";
import {
  canvasById,
  componentSheet,
  copyPagesTo,
  deleteCanvas,
  duplicateCanvas,
  duplicateCanvasWithAgent,
  moveCanvas,
  newVariant,
  openCanvas,
  renameCanvas,
} from "./canvas-actions.ts";
import {
  copyNode,
  cutNode,
  pasteAt,
  pasteInto,
  pasteIntoPage,
  useClipboard,
} from "./clipboard.ts";
import { runCommand } from "./commands.ts";
import { linkToPage } from "./links.ts";
import {
  type CanvasAction,
  type CanvasEntryAction,
  type CommentAction,
  type ComponentAction,
  canvasEntries,
  canvasListEntries,
  commentEntries,
  componentEntries,
  type Entry,
  mapActions,
  type NodeAction,
  nodeEntries,
  type PageAction,
  pageEntries,
  type TextStyleAction,
  type ThreadAction,
  type TokenAction,
  type TokenField,
  textStyleEntries,
  threadEntries,
  tokenEntries,
} from "./menu-model.ts";
import {
  actedOn,
  areSiblings,
  arrangeNode,
  deleteSelection,
  duplicateSelection,
  insertNode,
  insertNodesAt,
  insertTarget,
  nodeContext,
  nodesOf,
  placeOf,
  renameNode,
  selected,
  selectParent,
  setField,
  setHidden,
  setLocked,
  unwrapSelection,
  updateSelection,
  updateSelectionWith,
  wrapSelection,
} from "./node-actions.ts";
import { TEXT_STYLE } from "./node-fields.ts";
import { copyNodeLink, copyNodeRef } from "./node-links.ts";
import {
  adoptPages,
  deletePage,
  duplicatePage,
  editPageUrl,
  goToPage,
  implementPage,
  markImplemented,
  newState,
  pageById,
  renamePage,
  setPagePreset,
  setPageReady,
  setPagesReady,
  setPageUrl,
  unlinkImplementation,
  zoomToPage,
} from "./page-actions.ts";
import { viewportSize } from "./shortcuts.ts";
import { deleteThread, openChat, stopThread } from "./thread-actions.ts";
import { editTokenValue } from "./token-edit.ts";

// ---- An action, bound to what it acts on ----

type TargetOf<K extends MenuTarget["kind"]> = Extract<MenuTarget, { kind: K }>;

/** What each target's items do. */
interface Actions extends Record<MenuTarget["kind"], unknown> {
  canvas: CanvasAction;
  canvasEntry: CanvasEntryAction;
  comment: CommentAction;
  component: ComponentAction;
  node: NodeAction;
  page: PageAction;
  textStyle: TextStyleAction;
  thread: ThreadAction;
  token: TokenAction;
}

type ActionOn<K extends keyof Actions> = {
  [P in K]: { act: Actions[P]; on: P; target: TargetOf<P> };
}[K];

/** What a menu item does, with the target it does it to: `runMenuAction` runs it. */
export type MenuAction = ActionOn<keyof Actions>;

export type MenuEntry = Entry<MenuAction>;

const bind = <K extends keyof Actions>(
  on: K,
  target: TargetOf<K>,
  entries: readonly Entry<Actions[K]>[]
): Entry<ActionOn<K>>[] =>
  mapActions(entries, (act): ActionOn<K> => ({ act, on, target }));

// ---- What a menu holds ----

const canPaste = () => useClipboard.getState().nodes.length > 0;

const onCanvas = () => useEditor.getState().workspace !== "prototype";

const commentById = (id: string) =>
  useComments.getState().comments.find((c) => c.id === id);

/** The nodes of these selections, as the documents have them now. */
const nodesAt = (targets: readonly Selection[]) =>
  nodesOf(targets).map((n) => n.node);

/** Every one of these nodes is hidden: showing them is what toggling does. */
const allHidden = (targets: readonly Selection[]) => {
  const nodes = nodesAt(targets);
  return nodes.length > 0 && nodes.every((n) => n.hidden === true);
};

/** The canvas's base pages a link can lead to, by name. */
const linkTargets = () =>
  pagesOfCanvas(useEditor.getState().canvas)
    .filter((p) => p.variant === undefined)
    .map((p) => ({ name: p.name, path: linkToPage(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

const nodeMenu = (target: Selection) => {
  const ctx = nodeContext(target);
  const current = selected(ctx);
  if (!current) {
    return null;
  }
  const place = placeOf(ctx);
  const targets = actedOn(target);
  const onPage = !isNodeFrame(target.frame);
  return nodeEntries({
    canPaste: canPaste(),
    count: targets.length,
    hidden: allHidden(targets),
    index: place?.siblings.findIndex((c) => c.id === current.node.id) ?? 0,
    linkTargets: onPage ? linkTargets() : [],
    node: current.node,
    onPage,
    parentSelectable: !!place?.parent && place.parent.type !== "page",
    siblings: place?.siblings.length ?? 1,
    wrappable: targets.length === 1 || areSiblings(targets),
  });
};

const pageMenu = (pageId: string) => {
  const page = pageById(pageId);
  if (!page) {
    return null;
  }
  const { canvases, pages } = useProject.getState();
  // The page's drawings so far: the same screen in the same canvas.
  const drawings = familyOf(pages, page);
  const drawn = new Set(drawings.flatMap((p) => p.variant ?? []));
  const stated = new Set(drawings.flatMap((p) => p.state ?? []));
  const canvas = canvases.find((c) => c.id === page.canvas);
  return pageEntries({
    canPaste: canPaste(),
    canvases: canvases
      .filter((c) => c.id !== page.canvas)
      .map((c) => ({ id: c.id, name: c.name })),
    count: pagesActedOn(page.id).length,
    name: page.name,
    onCanvas: onCanvas(),
    preset: useEditor.getState().frames[page.id]?.preset ?? null,
    ...(page.route !== undefined && { route: page.route }),
    ...(page.variant !== undefined && { variant: page.variant }),
    ...(page.state !== undefined && { state: page.state }),
    implementation:
      useImplementation.getState().byTarget[page.id]?.status ?? "draft",
    statesFree: (canvas?.states ?? []).filter((v) => !stated.has(v)),
    variantsFree: (canvas?.variants ?? []).filter((v) => !drawn.has(v)),
  });
};

const canvasEntryMenu = (canvasId: string) => {
  const { canvases } = useProject.getState();
  const index = canvases.findIndex((c) => c.id === canvasId);
  return index === -1
    ? null
    : canvasListEntries({
        current: useEditor.getState().canvas === canvasId,
        first: index === 0,
        last: index === canvases.length - 1,
        only: canvases.length === 1,
      });
};

const commentMenu = (commentId: string) => {
  const comment = commentById(commentId);
  if (!comment) {
    return null;
  }
  const { current: id, threads } = useAgents.getState();
  const current = threads.find((t) => t.id === id);
  return commentEntries({
    behaviour: comment.kind === "behaviour",
    current: current
      ? { busy: isBusy(current.status), id: current.id, title: current.title }
      : null,
    hasElement: !!comment.nodeId && !!pageOfComment(comment),
    resolved: comment.resolved,
  });
};

const threadMenu = (threadId: string) => {
  const { following, threads } = useAgents.getState();
  const thread = threads.find((t) => t.id === threadId);
  return thread
    ? threadEntries({
        following: following === thread.id,
        running: isBusy(thread.status),
        title: thread.title,
      })
    : null;
};

/**
 * The menu of a target, read off the stores as they are now, its items bound to it; null when
 * what it was for is gone.
 */
export const menuFor = (target: MenuTarget): MenuEntry[] | null => {
  switch (target.kind) {
    case "node": {
      const entries = nodeMenu(target);
      return entries && bind("node", target, entries);
    }
    case "page": {
      const entries = pageMenu(target.pageId);
      return entries && bind("page", target, entries);
    }
    case "canvasEntry": {
      const entries = canvasEntryMenu(target.canvasId);
      return entries && bind("canvasEntry", target, entries);
    }
    case "canvas":
      return bind(
        "canvas",
        target,
        canvasEntries({
          canPaste: canPaste(),
          commentsVisible: useComments.getState().visible,
          gridVisible: useCanvasGrid.getState().visible,
        })
      );
    case "comment": {
      const entries = commentMenu(target.commentId);
      return entries && bind("comment", target, entries);
    }
    case "token":
      return bind(
        "token",
        target,
        tokenEntries({
          kind: target.tokenKind,
          name: target.name,
          selected: nodesAt(actedOn()),
          value: target.value,
        })
      );
    case "textStyle":
      return bind(
        "textStyle",
        target,
        textStyleEntries({ name: target.name, selected: nodesAt(actedOn()) })
      );
    case "component":
      return bind(
        "component",
        target,
        componentEntries({
          isComponent: target.isComponent,
          name: target.name,
          onCanvas: onCanvas() && useEditor.getState().canvas !== null,
          target: insertTarget()?.name ?? null,
        })
      );
    case "thread": {
      const entries = threadMenu(target.threadId);
      return entries && bind("thread", target, entries);
    }
    default:
      return null;
  }
};

// ---- What an item does ----

const copyText = (text: string, what = text) =>
  navigator.clipboard?.writeText(text).then(
    () => toast(`Copied ${what}`),
    () => undefined
  );

const select = (target: Selection) => useEditor.getState().select(target);

/**
 * Starts a comment on the node: where it was clicked, else in the middle of it. Comments are
 * pinned on pages, so a node of the canvas has none.
 */
const commentOn = (target: Selection, at?: Point) => {
  const { docs } = useDocuments.getState();
  const node = nodeIn(
    docs,
    useEditor.getState().canvas,
    target.frame,
    target.nodeId
  );
  if (!node || isNodeFrame(target.frame)) {
    return;
  }
  let point = at;
  if (!point) {
    const rect = frameOf(target.frame).measure([node.id])[node.id];
    point = rect
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      : { x: 24, y: 24 };
  }
  startComment(target.frame, point, node);
};

/**
 * Selects the element a comment is pinned on. The prototype shows no selection, so from there it
 * is selected on the canvas, in the design workspace, and brought into view.
 */
const selectCommented = (pageId: string, nodeId: string) => {
  const editor = useEditor.getState();
  if (editor.workspace !== "prototype") {
    select({ frame: pageId, nodeId });
    return;
  }
  editor.setWorkspace("design");
  select({ frame: pageId, nodeId });
  // The canvas is laid out the frame after it is shown.
  requestAnimationFrame(() => zoomToSelection(viewportSize()));
};

/** Sets where a node leads: a page's file or back; `null` for nowhere. */
const setLink = (sel: Selection, link: string | null) =>
  updateSelection({ link }, link === null ? "Remove the link" : "Link", sel);

/** Asks for a URL or another site for the node to lead to. */
const askLink = async (sel: Selection) => {
  const link = await askLinkUrl(selected(nodeContext(sel))?.node.link);
  if (link !== null) {
    await setLink(sel, link);
  }
};

/**
 * A node of a page made a draft component (ADR 0029): its subtree becomes the spec's tree, and it
 * an instance of it, which pages can use until the code has the component.
 */
const makeDraftOf = async (sel: Selection) => {
  const node = selected(nodeContext(sel))?.node;
  if (!(node && ensureEditable())) {
    return;
  }
  const name = await promptDialog({
    confirmLabel: "Make component",
    defaultValue: node.name ?? "",
    description:
      "Its look is the design's; the code gets it when it is implemented (the Components tab). Until then pages use it as it is drawn.",
    placeholder: "Pricing card",
    title: "A draft component",
  });
  if (!name?.trim()) {
    return;
  }
  try {
    const entry = await api().request("specs.draftFrom", {
      id: sel.frame,
      name: name.trim(),
      nodeId: node.id,
    });
    toast.success(`${entry.spec?.component ?? name} is a draft component.`);
  } catch (error) {
    reportError(error);
  }
};

/**
 * A node's item. Most act on the whole selection when the node is one of it (the actions find it
 * through `actedOn`); renaming, editing text, selecting the parent, commenting, the links and
 * arranging are about the node itself.
 */
const runNode = (target: TargetOf<"node">, act: NodeAction): unknown => {
  const sel = { frame: target.frame, nodeId: target.nodeId };
  if (!selected(nodeContext(sel))) {
    return;
  }
  switch (act.kind) {
    case "ask":
      return addToChat(actedOn(sel), { newThread: act.newChat });
    case "editText":
      select(sel);
      return frameOf(sel.frame).editText(sel.nodeId);
    case "rename":
      return renameNode(sel);
    case "viewCode":
      // The workspace first: it brings back the selection it kept.
      showRightPanel("code");
      return select(sel);
    case "comment":
      return commentOn(sel, target.at);
    case "makeDraft":
      return makeDraftOf(sel);
    case "link":
      return setLink(sel, act.to);
    case "linkUrl":
      return askLink(sel);
    case "selectParent":
      return selectParent(sel);
    case "copyLink":
      return copyNodeLink(sel);
    case "copyRef":
      return copyNodeRef(sel);
    case "copy":
      return copyNode(sel);
    case "cut":
      return cutNode(sel);
    case "paste":
      return pasteInto(sel);
    case "duplicate":
      return duplicateSelection(sel);
    case "wrap":
      return wrapSelection(act.in, sel);
    case "unwrap":
      return unwrapSelection(sel);
    case "arrange":
      return arrangeNode(act.to, sel);
    case "hide":
      return setHidden(act.hidden, sel);
    case "lock":
      return setLocked(act.locked, sel);
    case "zoomTo":
      select(sel);
      return zoomToSelection(viewportSize());
    case "delete":
      return deleteSelection(sel);
    default:
      return unhandled(act);
  }
};

const runPage = (target: TargetOf<"page">, act: PageAction): unknown => {
  const page = pageById(target.pageId);
  if (!page) {
    return;
  }
  switch (act.kind) {
    case "goTo":
      return goToPage(page);
    case "zoomTo":
      return zoomToPage(page);
    case "paste":
      return pasteIntoPage(page.id);
    case "preset":
      return setPagePreset(page, act.preset);
    case "rename":
      return renamePage(page);
    case "setUrl":
      return editPageUrl(page);
    case "removeUrl":
      return setPageUrl(page, "");
    case "duplicate":
      return duplicatePage(page);
    case "variant":
      return newVariant(page, act.variant ?? undefined);
    case "state":
      return newState(page, act.state ?? undefined);
    case "copyTo": {
      const ids = pagesActedOn(page.id);
      return copyPagesTo(
        useProject.getState().pages.filter((p) => ids.includes(p.id)),
        act.canvas,
        act.move
      );
    }
    case "implement":
      return implementPage(page);
    case "adopt":
      return adoptPages(pagesActedOn(page.id));
    case "ready":
      return setPageReady(page, act.ready);
    case "readyAll":
      return setPagesReady(pagesActedOn(page.id));
    case "markImplemented":
      return markImplemented(
        page.id,
        page.name,
        useImplementation.getState().byTarget[page.id]?.files
      );
    case "unlink":
      return unlinkImplementation(page.id, page.name);
    case "comment":
      return startComment(page.id, target.at ?? { x: 40, y: 40 });
    case "delete":
      return deletePage(page);
    default:
      return unhandled(act);
  }
};

const runCanvasEntry = (
  target: TargetOf<"canvasEntry">,
  act: CanvasEntryAction
): unknown => {
  const canvas = canvasById(target.canvasId);
  if (!canvas) {
    return;
  }
  switch (act.kind) {
    case "openCanvas":
      return openCanvas(canvas.id);
    case "rename":
      return renameCanvas(canvas);
    case "duplicate":
      return duplicateCanvas(canvas);
    case "duplicateWithAgent":
      return duplicateCanvasWithAgent(canvas);
    case "componentSheet":
      return componentSheet(canvas);
    case "readyAll":
      return setPagesReady(
        useProject
          .getState()
          .pages.filter((p) => p.canvas === canvas.id)
          .map((p) => p.id)
      );
    case "adopt":
      return adoptPages([canvas.id]);
    case "move":
      return moveCanvas(canvas, act.by);
    case "delete":
      return deleteCanvas(canvas);
    default:
      return unhandled(act);
  }
};

const runCanvas = (target: TargetOf<"canvas">, act: CanvasAction): unknown => {
  switch (act.kind) {
    case "paste":
      return pasteAt(target.at);
    case "command":
      return runCommand(act.id);
    default:
      return unhandled(act);
  }
};

const runComment = async (
  target: TargetOf<"comment">,
  act: CommentAction
): Promise<unknown> => {
  const comment = commentById(target.commentId);
  if (!comment) {
    return;
  }
  switch (act.kind) {
    case "open":
      return revealComment(comment);
    case "selectElement": {
      const page = pageOfComment(comment);
      return page && comment.nodeId
        ? selectCommented(page.id, comment.nodeId)
        : undefined;
    }
    case "resolve":
      return updateComment(comment.id, { resolved: act.resolved });
    case "note":
      return updateComment(comment.id, {
        kind: act.behaviour ? "behaviour" : "comment",
      });
    case "send":
      return sendComment(
        comment,
        act.threadId === null
          ? { newThread: true }
          : { threadId: act.threadId },
        undefined
      );
    case "copyText":
      return copyText(comment.text, "the comment");
    case "delete": {
      const ok = await confirmDialog({
        confirmLabel: "Delete",
        description: "Its replies go with it.",
        destructive: true,
        title: "Delete this comment?",
      });
      return ok ? deleteComment(comment.id) : undefined;
    }
    default:
      return unhandled(act);
  }
};

/** What setting a field to a token writes: a border keeps the rest of itself. */
const tokenSet = (
  field: TokenField["field"],
  ref: string,
  node: DesignNode
): Record<string, JsonValue> => {
  switch (field) {
    case "border.color":
      return { border: { ...node.border, color: ref } };
    case "border.width":
      return { border: { ...node.border, width: ref } };
    default:
      return { [field]: ref };
  }
};

const runToken = (target: TargetOf<"token">, act: TokenAction): unknown => {
  switch (act.kind) {
    case "copyRef":
      return copyText(tokenRef(target.name));
    case "copyValue":
      return copyText(target.value);
    case "edit":
      return editTokenValue(target.name, target.value);
    case "apply":
      return updateSelectionWith(
        (node) => tokenSet(act.field, tokenRef(target.name), node),
        `Apply ${target.name}`
      );
    default:
      return unhandled(act);
  }
};

const runTextStyle = (
  target: TargetOf<"textStyle">,
  act: TextStyleAction
): unknown => {
  switch (act.kind) {
    case "copyName":
      return copyText(target.name);
    case "apply": {
      const style = useDesignSystem
        .getState()
        .designSystem?.typography.styles.find((s) => s.name === target.name);
      const nodes = nodesAt(actedOn());
      return style && nodes.length > 0 && nodes.every((n) => n.type === "text")
        ? setField(TEXT_STYLE, style)
        : undefined;
    }
    default:
      return unhandled(act);
  }
};

/** Puts a new node on the canvas, in the middle of what can be seen of it. */
const insertOnCanvas = (node: DesignNode) => {
  const el = document.querySelector("[data-canvas]");
  const { x, width, height } = viewportSize();
  const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const at = canvasPoint(r.left + x + width / 2, r.top + height / 2);
  return insertNodesAt({ at: placeOnCanvas(at), kind: "canvas" }, [node]);
};

const runComponent = (
  target: TargetOf<"component">,
  act: ComponentAction
): unknown => {
  switch (act.kind) {
    case "insert":
      return insertNode(target.make());
    case "insertCanvas":
      return insertOnCanvas(target.make());
    case "copyName":
      return copyText(target.name);
    default:
      return unhandled(act);
  }
};

const runThread = (target: TargetOf<"thread">, act: ThreadAction): unknown => {
  switch (act.kind) {
    case "open":
      return openChat(target.threadId);
    case "follow":
      return useAgents
        .getState()
        .setFollowing(act.follow ? target.threadId : null);
    case "stop":
      return stopThread(target.threadId);
    case "delete":
      return deleteThread(target.threadId);
    default:
      return unhandled(act);
  }
};

/** An action no case runs: the type checker refuses it, so a new one is run or nothing builds. */
const unhandled = (action: never): never => action;

/**
 * Does what a menu item says, to what it was for. What it gives back is what its action gave:
 * the promise of a request, for one that makes one.
 */
export const runMenuAction = (action: MenuAction): unknown => {
  switch (action.on) {
    case "node":
      return runNode(action.target, action.act);
    case "page":
      return runPage(action.target, action.act);
    case "canvasEntry":
      return runCanvasEntry(action.target, action.act);
    case "canvas":
      return runCanvas(action.target, action.act);
    case "comment":
      return runComment(action.target, action.act);
    case "token":
      return runToken(action.target, action.act);
    case "textStyle":
      return runTextStyle(action.target, action.act);
    case "component":
      return runComponent(action.target, action.act);
    case "thread":
      return runThread(action.target, action.act);
    default:
      return unhandled(action);
  }
};
