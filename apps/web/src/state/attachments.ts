/**
 * What the composer of each thread sends along with its next prompt, as chips: nodes attached
 * from the canvas (Add to chat, a layer dragged in, the right-click menu), pages, a screenshot.
 * A store, not the composer's state: the canvas adds to it while the chat may be closed.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import type { PromptAttachment } from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { frameOfCanvasNode, nodeIn, useDocuments } from "./documents.ts";
import { type Selection, useEditor } from "./editor.ts";
import { useProject } from "./project.ts";

export type Chip =
  | {
      readonly component: boolean;
      /** The page's file, or the canvas's `canvas.json` for a node beside the pages. */
      readonly file: string;
      readonly frame: string;
      readonly kind: "node";
      readonly name: string;
      readonly nodeId: string;
    }
  | {
      readonly file: string;
      readonly kind: "page";
      readonly name: string;
      readonly pageId: string;
    }
  | { readonly frameId: string; readonly kind: "shot"; readonly name: string };

/** The key of a node's chip, known from where the node is without the node itself. */
export const nodeKey = (frame: string, nodeId: string) =>
  `node:${frame}#${nodeId}`;

export const chipKey = (chip: Chip): string => {
  switch (chip.kind) {
    case "node":
      return nodeKey(chip.frame, chip.nodeId);
    case "page":
      return `page:${chip.pageId}`;
    default:
      return `shot:${chip.frameId}`;
  }
};

interface AttachmentsStore {
  byThread: Record<string, readonly Chip[]>;
}

export const useAttachments = create<AttachmentsStore>(() => ({
  byThread: {},
}));

const NONE: readonly Chip[] = [];

export const chipsOf = (threadId: string | null) =>
  (threadId ? useAttachments.getState().byThread[threadId] : undefined) ?? NONE;

export const useChips = (threadId: string | null) =>
  useAttachments((s) => (threadId ? s.byThread[threadId] : undefined) ?? NONE);

export const addChip = (threadId: string, chip: Chip) =>
  useAttachments.setState((s) => {
    const chips = s.byThread[threadId] ?? [];
    if (chips.some((c) => chipKey(c) === chipKey(chip))) {
      return s;
    }
    return { byThread: { ...s.byThread, [threadId]: [...chips, chip] } };
  });

export const removeChip = (threadId: string, key: string) =>
  useAttachments.setState((s) => ({
    byThread: {
      ...s.byThread,
      [threadId]: (s.byThread[threadId] ?? []).filter(
        (c) => chipKey(c) !== key
      ),
    },
  }));

export const clearChips = (threadId: string) =>
  useAttachments.setState((s) => {
    const { [threadId]: _sent, ...rest } = s.byThread;
    return { byThread: rest };
  });

/** The file a node of a frame lives in: its page's, or the canvas's own for a loose node. */
export const fileOfFrame = (frame: string): string | null => {
  const page = useProject.getState().pages.find((p) => p.id === frame);
  if (page) {
    return page.file;
  }
  const designsDir = useProject.getState().settings?.designsDir;
  const { canvas } = useEditor.getState();
  if (designsDir === undefined || canvas === null) {
    return null;
  }
  return `${designsDir}/${canvas ? `${canvas}/` : ""}canvas.json`;
};

export const nodeChip = (
  selection: Selection,
  node: DesignNode
): Chip | null => {
  const file = fileOfFrame(selection.frame);
  return file
    ? {
        component: node.type === "instance",
        file,
        frame: selection.frame,
        kind: "node",
        name: nodeLabel(node),
        nodeId: node.id,
      }
    : null;
};

/** The chip of a selection on the canvas, when its node is known. */
export const chipOfSelection = (selection: Selection): Chip | null => {
  const node = nodeIn(
    useDocuments.getState().docs,
    useEditor.getState().canvas,
    selection.frame,
    selection.nodeId
  );
  return node ? nodeChip(selection, node) : null;
};

export const pageChip = (page: Page): Chip => ({
  file: page.file,
  kind: "page",
  name: page.name,
  pageId: page.id,
});

/**
 * The chip a prompt's attachment came from, to put a queued prompt back in the composer: a node
 * found again where it is, or a page. A picture is not kept.
 */
export const chipOfAttachment = (attachment: PromptAttachment): Chip | null => {
  const { pages } = useProject.getState();
  if (attachment.kind === "file") {
    const page = pages.find((p) => p.file === attachment.path);
    return page ? pageChip(page) : null;
  }
  if (attachment.kind !== "selection") {
    return null;
  }
  const page = pages.find((p) => p.file === attachment.file);
  const frame =
    page?.id ??
    frameOfCanvasNode(
      useDocuments.getState().docs,
      useEditor.getState().canvas,
      attachment.nodeId
    );
  return frame
    ? {
        component: attachment.component === true,
        file: attachment.file,
        frame,
        kind: "node",
        name: attachment.name,
        nodeId: attachment.nodeId,
      }
    : null;
};
