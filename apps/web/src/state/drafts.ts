/**
 * What is typed in each thread's composer and not sent yet, by thread. A store, not the
 * composer's state: the composer is mounted only while its thread is open, and a draft outlives
 * going back to the list or to another chat. A new chat's starters read it, and are offered only
 * while it is empty, so that one never takes the place of what was typed.
 */
import { create } from "zustand";

interface DraftsStore {
  byThread: Readonly<Record<string, string>>;
}

export const useDrafts = create<DraftsStore>(() => ({ byThread: {} }));

/** A thread's draft, empty when nothing is typed. */
export const useDraft = (threadId: string) =>
  useDrafts((s) => s.byThread[threadId] ?? "");

/** Writes a thread's draft, or what it becomes from the draft as it is. */
export const setDraft = (
  threadId: string,
  text: string | ((current: string) => string)
) =>
  useDrafts.setState((s) => {
    const current = s.byThread[threadId] ?? "";
    const next = typeof text === "function" ? text(current) : text;
    if (next === current) {
      return s;
    }
    const { [threadId]: _old, ...rest } = s.byThread;
    return { byThread: next === "" ? rest : { ...rest, [threadId]: next } };
  });

/** Forgets the draft of a thread that is gone: there is no composer left to send it from. */
export const dropDraft = (threadId: string) => setDraft(threadId, "");
