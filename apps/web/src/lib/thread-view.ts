/**
 * How a thread is shown: whether its agent is working, waiting on the user or stopped, and the
 * word a list, a dot or a badge says of it. Every place that shows a thread's state reads it
 * here rather than its status, so a thread being stopped is working everywhere at once.
 */
import { isBusy, isWaiting, type Thread } from "@ultrapaint/contracts/threads";

export interface ThreadView {
  /** A turn runs, or is being stopped (contracts' `isBusy`). */
  readonly busy: boolean;
  /** The agent stopped on an error, which the thread's `error` says. */
  readonly failed: boolean;
  /** What a list says of it, null when there is nothing to say: idle, nothing asked. */
  readonly label:
    | "Working"
    | "Reviewing"
    | "Not responding"
    | "Your turn"
    | "Stopped"
    | null;
  /** The colour the label is in. */
  readonly tone: "working" | "attention" | "failed" | null;
  /**
   * The agent was asked to stop and has not confirmed it in time (ADR 0124): the person may force
   * stop the turn. Busy still.
   */
  readonly unresponsive: boolean;
  /** The agent's turn ended on something the user is asked (its summary says so). */
  readonly waiting: boolean;
}

const IDLE: ThreadView = {
  busy: false,
  failed: false,
  label: null,
  tone: null,
  unresponsive: false,
  waiting: false,
};

/**
 * A thread as the editor shows it; one not there (a step's thread not read yet) is idle. A
 * question goes before working, which goes before a failure: what needs the person first, then
 * what the thread is doing now.
 */
export const threadView = (
  thread: Pick<Thread, "status" | "summary"> | undefined
): ThreadView => {
  if (!thread) {
    return IDLE;
  }
  const busy = isBusy(thread.status);
  const waiting = isWaiting(thread);
  const failed = thread.status === "error";
  const unresponsive = thread.status === "unresponsive";
  const flags = { busy, failed, unresponsive, waiting };
  // A question or a permission undecided needs the person, its turn under way or not: the tab
  // over the window shows the same, its dot before the spinner (ADR 0107).
  if (waiting) {
    return { ...flags, label: "Your turn", tone: "attention" };
  }
  // A stop the agent ignored needs the person too: Force stop is theirs (ADR 0124).
  if (unresponsive) {
    return { ...flags, label: "Not responding", tone: "attention" };
  }
  if (busy) {
    // Its review models look at what it made (ADR 0063): still working, in other words.
    const label = thread.status === "reviewing" ? "Reviewing" : "Working";
    return { ...flags, label, tone: "working" };
  }
  if (failed) {
    return { ...flags, label: "Stopped", tone: "failed" };
  }
  return IDLE;
};

/**
 * What a row of the chat list says at its right (ADR 0132), most urgent first as T3 Code's thread
 * row orders it: a question or a permission waiting, a stop the agent ignored, the turn under way
 * and since when, then a failure or a finished turn the person has not opened. Null when the row
 * says only its age.
 */
export type RowState =
  | { readonly kind: "asks"; readonly label: "Your turn" }
  | { readonly kind: "unresponsive"; readonly label: "Not responding" }
  | {
      readonly kind: "working";
      readonly label: "Working" | "Reviewing";
      /** When the turn began: the person's last prompt (`summary.since`). */
      readonly since: number | undefined;
    }
  | { readonly kind: "stopped"; readonly label: "Stopped" }
  | { readonly kind: "done"; readonly label: "Done" };

export const rowState = (
  thread: Pick<Thread, "status" | "summary">,
  unread: boolean
): RowState | null => {
  const view = threadView(thread);
  if (view.waiting) {
    return { kind: "asks", label: "Your turn" };
  }
  if (view.unresponsive) {
    return { kind: "unresponsive", label: "Not responding" };
  }
  if (view.busy) {
    return {
      kind: "working",
      label: thread.status === "reviewing" ? "Reviewing" : "Working",
      since: thread.summary?.since,
    };
  }
  // Once opened, a failure says only its age, as a finished turn does: the chat tells the rest.
  if (!unread) {
    return null;
  }
  if (view.failed) {
    return { kind: "stopped", label: "Stopped" };
  }
  // A chat nothing was sent in has no turn to have finished.
  return thread.summary?.since === undefined
    ? null
    : { kind: "done", label: "Done" };
};

/** Whether an agent is working on any of the threads: the rail's dot on the chat. */
export const someBusy = (threads: readonly Thread[]) =>
  threads.some((t) => threadView(t).busy);
