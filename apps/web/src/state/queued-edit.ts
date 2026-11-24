/**
 * A queued prompt being edited in its thread's composer (ADR 0137): which one, and the draft and
 * chips set aside for it, which come back when it is updated or let go. The server holds the
 * whole queue meanwhile, so nothing goes half written. One edit per thread at a time.
 */
import type { PromptAttachment } from "@ultrapaint/contracts/threads";
import { toast } from "sonner";
import { create } from "zustand";
import {
  type Chip,
  chipOfAttachment,
  setChips,
  useAttachments,
} from "./attachments.ts";
import { api } from "./connection.ts";
import { setDraft, useDrafts } from "./drafts.ts";
import { reportError } from "./project.ts";

interface OpenEdit {
  /** What was in the composer before, back once the edit ends. */
  readonly aside: { readonly chips: readonly Chip[]; readonly text: string };
  /** The queued prompt's id. */
  readonly id: string;
  /**
   * The prompt's attachments that no chip shows (a file that is no longer a page, a node no
   * longer drawn): kept, and saved with it as they were.
   */
  readonly kept: readonly PromptAttachment[];
}

/** The threads whose Edit is on its way to the server: a second press waits for the first. */
const starting = new Set<string>();

interface QueuedEditsStore {
  byThread: Readonly<Record<string, OpenEdit>>;
}

export const useQueuedEdits = create<QueuedEditsStore>(() => ({
  byThread: {},
}));

/** The queued prompt a thread's composer edits, if any. */
export const useQueuedEdit = (threadId: string) =>
  useQueuedEdits((s) => s.byThread[threadId]);

/** The edit over: the record gone, and the composer back as it was unless `keep`. */
const ended = (threadId: string, keep = false) => {
  const edit = useQueuedEdits.getState().byThread[threadId];
  if (!edit) {
    return;
  }
  useQueuedEdits.setState((s) => {
    const { [threadId]: _gone, ...rest } = s.byThread;
    return { byThread: rest };
  });
  if (!keep) {
    setDraft(threadId, edit.aside.text);
    setChips(threadId, edit.aside.chips);
  }
};

/** Lets the edit go: the prompt stays as it was, and the queue goes on. */
export const cancelQueuedEdit = async (threadId: string) => {
  const edit = useQueuedEdits.getState().byThread[threadId];
  if (!edit) {
    return;
  }
  ended(threadId);
  await api()
    .request("threads.editQueued", {
      edit: { action: "cancel" },
      id: edit.id,
      threadId,
    })
    .catch(reportError);
};

/**
 * Opens a queued prompt in the composer: its words and attachments in place of what is typed,
 * which is set aside. Another edit of the thread's is let go first.
 */
export const editQueued = async (threadId: string, id: string) => {
  if (
    starting.has(threadId) ||
    useQueuedEdits.getState().byThread[threadId]?.id === id
  ) {
    return;
  }
  starting.add(threadId);
  await cancelQueuedEdit(threadId);
  try {
    const taken = await api().request("threads.editQueued", {
      edit: { action: "start" },
      id,
      threadId,
    });
    if (!taken) {
      return;
    }
    const aside = {
      chips: useAttachments.getState().byThread[threadId] ?? [],
      text: useDrafts.getState().byThread[threadId] ?? "",
    };
    const chips: Chip[] = [];
    const kept: PromptAttachment[] = [];
    for (const attachment of taken.attachments) {
      const chip = chipOfAttachment(attachment);
      if (chip) {
        chips.push(chip);
      } else {
        kept.push(attachment);
      }
    }
    useQueuedEdits.setState((s) => ({
      byThread: { ...s.byThread, [threadId]: { aside, id, kept } },
    }));
    setDraft(threadId, taken.text);
    setChips(threadId, chips);
  } catch (error) {
    reportError(error);
  } finally {
    starting.delete(threadId);
  }
};

/**
 * Saves the edit of the prompt `id`, the one the composer opened when Update was pressed: its new
 * words and attachments, with those no chip showed, and the queue goes on. Nothing is saved when
 * that edit is no longer the one open, let go or replaced meanwhile.
 */
export const saveQueuedEdit = async (
  threadId: string,
  id: string,
  text: string,
  attachments: PromptAttachment[]
) => {
  const edit = useQueuedEdits.getState().byThread[threadId];
  if (edit?.id !== id) {
    return;
  }
  // Over before it is asked: the queue may move on, and the prompt leave it, before the answer
  // comes, which must not read as the edit lost.
  const chips = useAttachments.getState().byThread[threadId] ?? [];
  ended(threadId);
  try {
    await api().request("threads.editQueued", {
      edit: {
        action: "save",
        attachments: [...attachments, ...edit.kept],
        text,
      },
      id,
      threadId,
    });
  } catch (error) {
    // Not saved: the edit is open again for the composer to say why, unless another was opened
    // meanwhile. What was typed since is set aside in its turn, so nothing is lost.
    if (useQueuedEdits.getState().byThread[threadId] === undefined) {
      const aside = {
        chips: useAttachments.getState().byThread[threadId] ?? [],
        text: useDrafts.getState().byThread[threadId] ?? "",
      };
      useQueuedEdits.setState((s) => ({
        byThread: { ...s.byThread, [threadId]: { ...edit, aside } },
      }));
      setDraft(threadId, text);
      setChips(threadId, chips);
    }
    throw error;
  }
};

/**
 * The prompt being edited left the queue some other way (another window sent or removed it):
 * the edit stays in the composer as a draft when the one set aside was empty, and is dropped
 * otherwise, as the reference product does.
 */
export const lostQueuedEdit = (threadId: string) => {
  const edit = useQueuedEdits.getState().byThread[threadId];
  if (!edit) {
    return;
  }
  const keep = edit.aside.text.trim() === "" && edit.aside.chips.length === 0;
  ended(threadId, keep);
  toast("The queued prompt is no longer queued", {
    description: keep
      ? "Your edit is kept in the composer."
      : "Your edit was discarded.",
  });
};
