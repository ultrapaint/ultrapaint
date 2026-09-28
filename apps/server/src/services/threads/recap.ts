/**
 * What a new session is told of the conversation it joins. A thread outlives its sessions: the
 * user switches to another agent, or a stored session cannot be loaded, and the agent that
 * answers next has not seen what was said. It goes out once, with the session's first prompt.
 * Pure.
 */
import type { ThreadItem } from "@ultrapaint/contracts/threads";

/** Past this a message is cut: the agent needs the thread of the conversation, not every word. */
const MESSAGE_LIMIT = 4000;
/** The recap keeps the most recent messages that fit. */
const RECAP_LIMIT = 24_000;

const clip = (text: string) =>
  text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text;

const lineOf = (item: ThreadItem): string | null => {
  switch (item.kind) {
    case "user":
      return item.attachments.length > 0
        ? `User: ${clip(item.text)}\n(attached: ${item.attachments.join(", ")})`
        : `User: ${clip(item.text)}`;
    case "agent":
      return `Assistant: ${clip(item.text)}`;
    case "question":
      return item.answers === null
        ? `(Assistant asked: ${item.questions.map((q) => q.question).join(" / ")}; not answered)`
        : null;
    case "status":
      return `(${item.text})`;
    case "turn_end":
      return item.changedFiles.length > 0
        ? `(files changed: ${item.changedFiles.join(", ")})`
        : null;
    default:
      return null;
  }
};

/** The conversation so far as one text block, or null when nothing was asked yet. */
export const recapOf = (items: readonly ThreadItem[]): string | null => {
  if (!items.some((item) => item.kind === "user")) {
    return null;
  }
  const lines = items.flatMap((item) => {
    const line = lineOf(item);
    return line === null ? [] : [line];
  });
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.toReversed()) {
    if (size + line.length > RECAP_LIMIT && kept.length > 0) {
      break;
    }
    kept.unshift(line);
    size += line.length;
  }
  const omitted = lines.length - kept.length;
  return [
    "<ultrapaint-history>",
    "This conversation started before this session, possibly with another agent. What was said so far, oldest first. The files named may have changed since.",
    ...(omitted > 0 ? [`(${omitted} earlier entries left out)`] : []),
    "",
    kept.join("\n\n"),
    "</ultrapaint-history>",
  ].join("\n");
};
