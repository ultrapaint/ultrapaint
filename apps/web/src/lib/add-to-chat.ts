/**
 * Add to chat: the element goes to the open thread's composer as a chip, or to a new thread when
 * the chat shows the list or one is asked for. The chat opens on it; nothing is sent. Taking it
 * back out removes the chip.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { useAgents } from "../state/agents.ts";
import {
  addChip,
  canvasOfFile,
  chipOfSelection,
  nodeKey,
  removeChip,
} from "../state/attachments.ts";
import type { Selection } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
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

export const addToChat = async (
  selection: Selection | readonly Selection[],
  { newThread = false }: { readonly newThread?: boolean } = {}
) => {
  const chips = listOf(selection).flatMap((s) => {
    const chip = chipOfSelection(s);
    return chip ? [chip] : [];
  });
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
