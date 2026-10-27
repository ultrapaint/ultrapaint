/** What a test asks of a thread's transcript, in-process or over the socket. */
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";

/** The turn is over once its end is in the transcript and the thread is idle again. */
export const turnEnded = (thread: Thread, items: readonly ThreadItem[]) =>
  items.at(-1)?.kind === "turn_end" && thread.status === "idle";

/** `turnEnded`, for the `n`th turn. */
export const turnsEnded =
  (n: number) => (thread: Thread, items: readonly ThreadItem[]) =>
    turnEnded(thread, items) &&
    items.filter((i) => i.kind === "turn_end").length === n;

/** What the agent said, message by message. */
export const said = (items: readonly ThreadItem[]) =>
  items.flatMap((i) => (i.kind === "agent" ? [i.text] : []));

export const kinds = (items: readonly ThreadItem[]) => items.map((i) => i.kind);
