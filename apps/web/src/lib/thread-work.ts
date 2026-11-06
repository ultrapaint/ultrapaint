/**
 * A thread's transcript as the chat lays it out: the tool calls an agent makes between two answers
 * fold into one entry, which says in a few words what they were.
 */
import {
  isEditorMcpCall,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;

/** A thread's items as the panel lays them out: most alone, runs of work folded together. */
export type ThreadEntry =
  | { readonly item: ThreadItem; readonly kind: "item" }
  | {
      readonly id: string;
      readonly items: readonly ThreadItem[];
      readonly kind: "work";
    }
  | {
      readonly item: TurnEnd;
      readonly kind: "turn";
      /** When the prompt that started the turn was sent, if it is in the transcript. */
      readonly since: number | undefined;
    };

type TurnEnd = Extract<ThreadItem, { kind: "turn_end" }>;

const isWork = (item: ThreadItem) =>
  item.kind === "tool" || item.kind === "thought";

/**
 * Folds each run of tool calls and thoughts into one entry, a lone tool call included, so every
 * call sits behind the same fold. A run with no tool call is only thinking and stays as it is. The
 * end of a turn carries the time of the prompt that started it, so the chat can say how long it took.
 */
export const groupWork = (
  items: readonly ThreadItem[]
): readonly ThreadEntry[] => {
  const entries: ThreadEntry[] = [];
  let run: ThreadItem[] = [];
  let since: number | undefined;
  const flush = () => {
    const [first] = run;
    if (first && run.some((i) => i.kind === "tool")) {
      // Keyed by its first item, so the entry keeps its identity as the run grows.
      entries.push({ id: first.id, items: run, kind: "work" });
    } else {
      entries.push(...run.map((item) => ({ item, kind: "item" as const })));
    }
    run = [];
  };
  for (const item of items) {
    if (isWork(item)) {
      run.push(item);
      continue;
    }
    flush();
    if (item.kind === "user") {
      since = item.at;
      // A round's findings sent to the designer are the review's: its round shows them.
      if (item.review === undefined) {
        entries.push({ item, kind: "item" });
      }
    } else if (item.kind === "turn_end") {
      entries.push({ item, kind: "turn", since });
      since = undefined;
    } else {
      entries.push({ item, kind: "item" });
    }
  }
  flush();
  return entries;
};

/** What a kind of tool call is, as it happens and once it is done. */
const LABELS: Record<string, readonly [string, string]> = {
  delete: ["Deleting", "Deleted"],
  edit: ["Editing", "Edited"],
  editor: ["Inspecting", "Inspected"],
  execute: ["Running", "Ran"],
  fetch: ["Fetching", "Fetched"],
  move: ["Moving", "Moved"],
  read: ["Reading", "Read"],
  search: ["Searching", "Searched"],
  think: ["Planning", "Planned"],
};
const OTHER = ["Working", "Tool"] as const;

const labelOf = (tool: ToolItem, active: boolean) => {
  // Asking the editor is its own thing, whatever kind the agent gave the call.
  const key = isEditorMcpCall(tool.title) ? "editor" : (tool.toolKind ?? "");
  return (LABELS[key] ?? OTHER)[active ? 0 : 1];
};

/** "Read ×5, Searched ×3, Edited": each kind once, in the order the agent first did it. */
export const workSummary = (items: readonly ThreadItem[], active: boolean) => {
  const counts = new Map<string, number>();
  let failed = 0;
  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    const label = labelOf(item, active);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (item.status === "failed") {
      failed += 1;
    }
  }
  const text = [...counts]
    .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
    .join(", ");
  return { failed, text };
};

/** Whether any tool call of the run has not finished. */
export const hasOpenCall = (items: readonly ThreadItem[]) =>
  items.some(
    (i) =>
      i.kind === "tool" &&
      (i.status === "pending" || i.status === "in_progress")
  );

/** "12s", "1m 4s": how long something took, to the second. */
export const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/**
 * Why a turn stopped, in words, when it was not the agent finishing on its own. ACP names the
 * reasons; an agent may add its own, which are shown as they came.
 */
export const stopNote = (stopReason: string): string | null => {
  switch (stopReason) {
    case "end_turn":
      return null;
    case "cancelled":
      return "Stopped";
    case "max_tokens":
      return "Stopped: the agent ran out of tokens";
    case "max_turn_requests":
      return "Stopped: the agent made too many requests";
    case "refusal":
      return "The agent declined";
    default:
      return `Stopped: ${stopReason}`;
  }
};
