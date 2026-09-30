/**
 * How an element on the canvas is in a chat, read off the threads and their composers' chips.
 * Pure, so the agent button's states can be tested without the stores.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import type { Chip } from "../state/attachments.ts";
import type { Selection } from "../state/editor.ts";

/** Whether a node is attached to a thread's next prompt. */
export const isAttached = (
  byThread: Record<string, readonly Chip[]>,
  threadId: string | null,
  selection: Selection
) =>
  threadId !== null &&
  (byThread[threadId] ?? []).some(
    (c) =>
      c.kind === "node" &&
      c.frame === selection.frame &&
      c.nodeId === selection.nodeId
  );

/**
 * `attached` to the open thread's next prompt, which can be undone, or the element a thread was
 * started on, which cannot.
 */
export interface ChatLink {
  readonly attached: boolean;
  readonly thread: Thread;
}

export const chatLinkOf = (
  threads: readonly Thread[],
  byThread: Record<string, readonly Chip[]>,
  current: string | null,
  selection: Selection,
  file: string | null
): ChatLink | null => {
  if (isAttached(byThread, current, selection)) {
    const thread = threads.find((t) => t.id === current);
    return thread ? { attached: true, thread } : null;
  }
  const thread = threads.find(
    (t) => t.scope?.nodeId === selection.nodeId && t.scope.file === file
  );
  return thread ? { attached: false, thread } : null;
};
