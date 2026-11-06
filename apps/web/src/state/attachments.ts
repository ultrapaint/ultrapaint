/**
 * What the composer of each thread sends along with its next prompt, as chips: nodes attached
 * from the canvas (Add to chat, a layer dragged in, the right-click menu), pages, what is
 * picked on a board of Design system or the Library (ADR 0045, B11), and pictures and text files
 * pasted, dropped or picked from disk (ADR 0064). A store, not
 * the composer's state: the canvas adds to it while the chat may be closed. `attachmentsOf` says
 * what chips go with a prompt as, a comment sent to an agent's included.
 */
import type { Comment } from "@ultrapaint/contracts/comments";
import {
  componentFileOf,
  componentOfDoc,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import type {
  BoardAttachment,
  PromptAttachment,
} from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import {
  frameOfCanvasNode,
  isBoardFrame,
  nodeIn,
  useDocuments,
} from "./documents.ts";
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
  /** What is picked on a board, as the prompt carries it (`lib/board-chip.ts`). */
  | BoardAttachment
  /** A picture pasted, dropped or picked from disk, sent as the picture itself. */
  | ImageChip
  /** A text file from disk, sent as its text (ADR 0064). */
  | TextChip;

export interface ImageChip {
  readonly dataUrl: string;
  /** Tells two pictures apart, whatever their names. */
  readonly id: string;
  readonly kind: "image";
  readonly name: string;
}

export interface TextChip {
  /** Tells two files apart, whatever their names. */
  readonly id: string;
  readonly kind: "text";
  readonly name: string;
  /** Its size in bytes, as the chip's tooltip says it. */
  readonly size: number;
  readonly text: string;
}

let attached = 0;

const attachedId = () => {
  attached += 1;
  return `${Date.now()}-${attached}`;
};

/** The chip of a picture, as a data URL. */
export const imageChip = (name: string, dataUrl: string): ImageChip => ({
  dataUrl,
  id: attachedId(),
  kind: "image",
  name,
});

/** The chip of a text file, read. */
export const textChip = (name: string, text: string): TextChip => ({
  id: attachedId(),
  kind: "text",
  name,
  size: new TextEncoder().encode(text).length,
  text,
});

/** Whether a chip says where in the designs the prompt is about, which a file from disk does not. */
export const isPlace = (chip: Chip) =>
  chip.kind !== "image" && chip.kind !== "text";

/** The key of a node's chip, known from where the node is without the node itself. */
export const nodeKey = (frame: string, nodeId: string) =>
  `node:${frame}#${nodeId}`;

/** The key of a board's chip: what it is, its name, and the place of a component picked. */
const boardChipKey = (chip: BoardAttachment) =>
  `board:${chip.pick}/${chip.name}/${chip.place?.variant ? `${chip.place.variant.axis}=${chip.place.variant.member}` : ""}/${chip.place?.state ?? ""}`;

export const chipKey = (chip: Chip): string => {
  if (chip.kind === "board") {
    return boardChipKey(chip);
  }
  if (chip.kind === "image" || chip.kind === "text") {
    return `${chip.kind}:${chip.id}`;
  }
  return chip.kind === "node"
    ? nodeKey(chip.frame, chip.nodeId)
    : `page:${chip.pageId}`;
};

interface AttachmentsStore {
  byThread: Record<string, readonly Chip[]>;
}

export const useAttachments = create<AttachmentsStore>(() => ({
  byThread: {},
}));

const NONE: readonly Chip[] = [];

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

/**
 * Takes off the chips a prompt was sent with. One attached while it was on its way goes with
 * the next prompt instead, and stays.
 */
export const clearChips = (threadId: string, sent: readonly Chip[]) =>
  useAttachments.setState((s) => {
    const gone = new Set(sent.map(chipKey));
    const { [threadId]: chips = [], ...rest } = s.byThread;
    const left = chips.filter((c) => !gone.has(chipKey(c)));
    return {
      byThread: left.length > 0 ? { ...rest, [threadId]: left } : rest,
    };
  });

/** A canvas's own file, which holds its nodes beside the pages: its `canvas.json`. */
const canvasFileOf = (designsDir: string, canvas: string) =>
  `${designsDir}/${canvas ? `${canvas}/` : ""}canvas.json`;

/**
 * The file a node of a frame lives in: its page's, or the canvas's own for a loose node; the app
 * component's while its tree is edited in place in the frame, on a page or on its board.
 */
export const fileOfFrame = (frame: string): string | null => {
  const { edited } = useDocuments.getState();
  const component = edited?.frame === frame ? componentOfDoc(edited.doc) : null;
  const designsDir = useProject.getState().settings?.designsDir;
  if (component !== null) {
    return designsDir === undefined
      ? null
      : `${designsDir}/${componentFileOf(component)}`;
  }
  // A board's frame is otherwise generated: it has no file of the designs (ADR 0045).
  if (isBoardFrame(frame)) {
    return null;
  }
  const page = useProject.getState().pages.find((p) => p.id === frame);
  if (page) {
    return page.file;
  }
  const { canvas } = useEditor.getState();
  if (designsDir === undefined || canvas === null) {
    return null;
  }
  return canvasFileOf(designsDir, canvas);
};

/** The canvas whose own file `file` is (`fileOfFrame`'s for a loose node), or null. */
export const canvasOfFile = (file: string): string | null => {
  const { canvases, settings } = useProject.getState();
  const designsDir = settings?.designsDir;
  if (designsDir === undefined) {
    return null;
  }
  return (
    canvases.find((c) => canvasFileOf(designsDir, c.id) === file)?.id ?? null
  );
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
 * found again where it is, a page, a picture or a text file.
 */
export const chipOfAttachment = (attachment: PromptAttachment): Chip | null => {
  if (attachment.kind === "board") {
    return attachment;
  }
  if (attachment.kind === "image") {
    return imageChip(attachment.name, attachment.dataUrl);
  }
  if (attachment.kind === "text") {
    return textChip(attachment.name, attachment.text);
  }
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

/** A comment's chip: the node it is pinned on, by the name the comment gives it, or its page. */
export const chipOfComment = (comment: Comment, page: Page): Chip =>
  comment.nodeId
    ? {
        component: false,
        file: page.file,
        frame: page.id,
        kind: "node",
        name: comment.element ?? "node",
        nodeId: comment.nodeId,
      }
    : pageChip(page);

/**
 * What a prompt carries for its chips: each page's file, and each node with the file it lives in,
 * a file once however many of its nodes go; a board's pick as it is, its file linked rather than
 * sent. A screenshot is the composer's to add.
 */
export const attachmentsOf = (chips: readonly Chip[]): PromptAttachment[] => {
  const attachments: PromptAttachment[] = [];
  const files = new Set<string>();
  for (const chip of chips) {
    if (chip.kind === "board") {
      attachments.push(chip);
      continue;
    }
    if (chip.kind === "image") {
      attachments.push({
        dataUrl: chip.dataUrl,
        kind: "image",
        name: chip.name,
      });
      continue;
    }
    if (chip.kind === "text") {
      attachments.push({ kind: "text", name: chip.name, text: chip.text });
      continue;
    }
    if (!files.has(chip.file)) {
      files.add(chip.file);
      attachments.push({ kind: "file", path: chip.file });
    }
    if (chip.kind === "node") {
      attachments.push({
        file: chip.file,
        kind: "selection",
        name: chip.name,
        nodeId: chip.nodeId,
        ...(chip.component ? { component: true } : {}),
      });
    }
  }
  return attachments;
};
