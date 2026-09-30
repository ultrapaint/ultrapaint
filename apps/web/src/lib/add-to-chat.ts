/**
 * Add to chat: the element goes to the open thread's composer as a chip, or to a new thread when
 * the chat shows the list. The chat opens on it; nothing is sent.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { useAgents } from "../state/agents.ts";
import {
  addChip,
  type Chip,
  chipOfSelection,
  isAttached,
} from "../state/attachments.ts";
import { frameOfCanvasNode, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { viewportSize } from "./shortcuts.ts";
import { createThread } from "./start-thread.ts";

/** The thread an element added now goes to: the one open in the chat, if one is. */
const openThread = (): Thread | null => {
  const { current, threads, view } = useAgents.getState();
  return view === "thread"
    ? (threads.find((t) => t.id === current) ?? null)
    : null;
};

export const addToChat = async (
  selection: Selection | readonly Selection[]
) => {
  const chips = (Array.isArray(selection) ? selection : [selection]).flatMap(
    (s: Selection) => {
      const chip = chipOfSelection(s);
      return chip ? [chip] : [];
    }
  );
  if (chips.length === 0) {
    return;
  }
  const thread = openThread() ?? (await createThread());
  if (!thread) {
    return;
  }
  for (const chip of chips) {
    addChip(thread.id, chip);
  }
  useEditor.getState().setLeftTab("chat");
  await useAgents.getState().open(thread.id);
};

/** The thread an element is in: attached to its next prompt, or what it was started on. */
export const threadOfNode = (
  threads: readonly Thread[],
  byThread: Record<string, readonly Chip[]>,
  current: string | null,
  selection: Selection,
  file: string | null
): Thread | null => {
  if (isAttached(byThread, current, selection)) {
    return threads.find((t) => t.id === current) ?? null;
  }
  return (
    threads.find(
      (t) => t.scope?.nodeId === selection.nodeId && t.scope.file === file
    ) ?? null
  );
};

/** Brings a thread's scope into view on the canvas, selected. */
export const showScope = (thread: Thread) => {
  const { scope } = thread;
  if (!scope) {
    return;
  }
  const editor = useEditor.getState();
  const page = useProject.getState().pages.find((p) => p.file === scope.file);
  if (page && scope.nodeId === undefined) {
    editor.selectPage(page.id);
  } else if (scope.nodeId !== undefined) {
    const frame =
      page?.id ??
      frameOfCanvasNode(
        useDocuments.getState().docs,
        editor.canvas,
        scope.nodeId
      );
    if (!frame) {
      return;
    }
    editor.select({ frame, nodeId: scope.nodeId });
  }
  editor.zoomToSelection(viewportSize());
};
