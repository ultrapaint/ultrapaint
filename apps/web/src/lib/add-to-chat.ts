/**
 * Add to chat: the element, or what is picked on a board, goes to the open thread's composer as a
 * chip, or to a new thread when the chat shows the list or one is asked for. The chat opens on
 * it; nothing is sent. Taking it back out removes the chip.
 */
import type { BoardAttachment, Thread } from "@ultrapaint/contracts/threads";
import { useMemo } from "react";
import { useAgents } from "../state/agents.ts";
import {
  addChip,
  type Chip,
  canvasOfFile,
  chipKey,
  chipOfSelection,
  isPlace,
  nodeChip,
  nodeKey,
  removeChip,
  useChips,
  useDismissed,
} from "../state/attachments.ts";
import { pickOf, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { boardChipOf } from "./board-chip.ts";
import { reveal } from "./reveal.ts";
import { createThread } from "./start-thread.ts";

/** The thread an element added now goes to: the one open in the chat, if one is. */
const openThread = (): Thread | null => {
  const { current, threads, view } = useAgents.getState();
  return view === "thread"
    ? (threads.find((t) => t.id === current) ?? null)
    : null;
};

const listOf = (selection: Selection | readonly Selection[]) =>
  Array.isArray(selection) ? selection : [selection as Selection];

export const addToChat = (
  selection: Selection | readonly Selection[],
  options: { readonly newThread?: boolean } = {}
) =>
  addChipsToChat(
    listOf(selection).flatMap((s) => {
      const chip = chipOfSelection(s);
      return chip ? [chip] : [];
    }),
    options
  );

/** Chips to the open thread's composer, or a new thread's; a board's pick goes this way. */
export const addChipsToChat = async (
  chips: readonly Chip[],
  { newThread = false }: { readonly newThread?: boolean } = {}
) => {
  if (chips.length === 0) {
    return;
  }
  const thread = (newThread ? null : openThread()) ?? (await createThread());
  if (!thread) {
    return;
  }
  for (const chip of chips) {
    addChip(thread.id, chip);
  }
  await showLeftPanel({ chat: thread.id });
};

/**
 * The chip of what is picked on the board view open, as the stores have it now; null on the page
 * canvas and where a board has nothing to tell.
 */
export const useBoardChip = (): BoardAttachment | null => {
  const open = useBoard((s) => s.open);
  const pick = useBoard(pickOf);
  const ds = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const catalogue = useComponents((s) => s.catalogue);
  const components = useComponents((s) => s.components);
  const designsDir = useProject((s) => s.settings?.designsDir);
  const editedOn = useIsolation((s) => s.isolated?.frame ?? null);
  return useMemo(
    () =>
      open && designsDir !== undefined
        ? boardChipOf(open, pick, {
            catalogue,
            components,
            designsDir,
            document,
            ds,
            editedOn,
          })
        : null,
    [open, pick, ds, document, catalogue, components, designsDir, editedOn]
  );
};

/**
 * What goes along with a thread's next prompt without being attached, shown dashed in its
 * composer: with no place attached, the element selected, or else what is picked on a board,
 * unless the user took it out. `selected` is that element or pick, taken out or not.
 */
export const useImplicitChip = (threadId: string) => {
  const selection = useEditor((s) => s.selection);
  const selectedNode = useDocuments((s) =>
    selection
      ? nodeIn(
          s.docs,
          useEditor.getState().canvas,
          selection.frame,
          selection.nodeId
        )
      : null
  );
  const boardChip = useBoardChip();
  const placed = useChips(threadId).some(isPlace);
  const dismissed = useDismissed(threadId);
  const selected =
    (selection && selectedNode ? nodeChip(selection, selectedNode) : null) ??
    boardChip;
  const implicit =
    placed || selected === null || dismissed.includes(chipKey(selected))
      ? null
      : selected;
  return { implicit, selected };
};

/** Takes elements back out of the open thread's composer. */
export const removeFromChat = (selection: Selection | readonly Selection[]) => {
  const { current } = useAgents.getState();
  if (current === null) {
    return;
  }
  for (const s of listOf(selection)) {
    removeChip(current, nodeKey(s.frame, s.nodeId));
  }
};

/**
 * Brings a thread's scope into view on the canvas, selected: its page, or its node, on whichever
 * canvas it is.
 */
export const showScope = (thread: Thread) => {
  const { scope } = thread;
  if (!scope) {
    return;
  }
  const page = useProject.getState().pages.find((p) => p.file === scope.file);
  if (scope.nodeId === undefined) {
    return page ? reveal({ page: page.id }) : undefined;
  }
  if (page) {
    return reveal({ frame: page.id, nodeId: scope.nodeId });
  }
  // A node beside the pages: the scope names its canvas's own file.
  const canvas = canvasOfFile(scope.file);
  return canvas === null ? undefined : reveal({ canvas, nodeId: scope.nodeId });
};
