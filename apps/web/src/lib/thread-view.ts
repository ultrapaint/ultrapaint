/**
 * How a thread is shown: whether its agent is working, waiting on the user or stopped, and the
 * word a list, a dot or a badge says of it. Every place that shows a thread's state reads it
 * here rather than its status, so a thread being stopped is working everywhere at once.
 */
import { isBusy, type Thread } from "@ultrapaint/contracts/threads";

export interface ThreadView {
  /** A turn runs, or is being stopped (contracts' `isBusy`). */
  readonly busy: boolean;
  /** The agent stopped on an error, which the thread's `error` says. */
  readonly failed: boolean;
  /** What a list says of it, null when there is nothing to say: idle, nothing asked. */
  readonly label: "Working" | "Your turn" | "Stopped" | null;
  /** The colour the label is in. */
  readonly tone: "working" | "attention" | "failed" | null;
  /** The agent's turn ended on something the user is asked (its summary says so). */
  readonly waiting: boolean;
}

const IDLE: ThreadView = {
  busy: false,
  failed: false,
  label: null,
  tone: null,
  waiting: false,
};

/**
 * A thread as the editor shows it; one not there (a step's thread not read yet) is idle. Working
 * goes before a question, which goes before a failure: a turn under way is what the thread is
 * doing now.
 */
export const threadView = (
  thread: Pick<Thread, "status" | "summary"> | undefined
): ThreadView => {
  if (!thread) {
    return IDLE;
  }
  const busy = isBusy(thread.status);
  const waiting = thread.summary?.waiting === true;
  const failed = thread.status === "error";
  if (busy) {
    return { busy, failed, label: "Working", tone: "working", waiting };
  }
  if (waiting) {
    return { busy, failed, label: "Your turn", tone: "attention", waiting };
  }
  if (failed) {
    return { busy, failed, label: "Stopped", tone: "failed", waiting };
  }
  return IDLE;
};

/** Whether an agent is working on any of the threads: the rail's dot on the chat. */
export const someBusy = (threads: readonly Thread[]) =>
  threads.some((t) => threadView(t).busy);
