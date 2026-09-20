/**
 * What each agent is doing right now, worked out from the transcript it is already streaming: the
 * last tool call it has not finished. The canvas uses it to show where an agent is working, the
 * strip under the canvas to say it in words.
 *
 * Derived, never stored, and free of the editor's stores so it can be read on its own.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";

export type AgentAction = "editing" | "reading" | "running" | "thinking";

export interface AgentActivity {
  readonly action: AgentAction;
  /** Colour of this thread on the canvas, so two agents are told apart at a glance. */
  readonly color: string;
  /** Pages of the open project the agent is touching, by page id. */
  readonly pageIds: readonly string[];
  /** Repository-relative files, with the line when the agent said one. */
  readonly places: readonly { readonly line?: number; readonly path: string }[];
  readonly threadId: string;
  /** What the agent called the tool call; absent while it is between tool calls. */
  readonly title?: string;
}

/** Enough colours to tell a few agents apart; after that they repeat. */
const COLORS = ["#4f8cff", "#f0883e", "#b180ff", "#3fb950"] as const;

export const colorOfThread = (threads: readonly Thread[], threadId: string) =>
  COLORS[
    Math.max(
      0,
      threads.findIndex((t) => t.id === threadId)
    ) % COLORS.length
  ] ?? COLORS[0];

/** ACP names a tool call's kind; the editor only cares what it means for the canvas. */
const actionOf = (toolKind: string | undefined): AgentAction => {
  switch (toolKind) {
    case "edit":
    case "delete":
    case "move":
      return "editing";
    case "read":
    case "search":
    case "fetch":
      return "reading";
    case "execute":
      return "running";
    default:
      return "thinking";
  }
};

/** The tool call the agent has not finished, which is the one it is working on. */
const openToolCall = (items: readonly ThreadItem[]) => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "turn_end") {
      return;
    }
    if (
      item?.kind === "tool" &&
      (item.status === "pending" || item.status === "in_progress")
    ) {
      return item;
    }
  }
};

/**
 * The pages a tool call is about. An agent that edits through its file tools says which file it
 * is in; one that runs `sed` or `cat` says nothing, and all the editor has is the command it
 * wrote — so a page named in that text counts too. Matching by file path only, never by name: a
 * page called "index" must not light up because the word appears in a sentence.
 */
const pagesOfCall = (
  places: readonly { readonly path: string }[],
  title: string | undefined,
  pages: readonly Page[]
) => {
  const named = places.flatMap((place) => {
    const page = pages.find((p) => p.file === place.path);
    return page ? [page.id] : [];
  });
  if (named.length > 0 || !title) {
    return named;
  }
  return pages.filter((page) => title.includes(page.file)).map((p) => p.id);
};

/**
 * One entry per thread whose agent is working. A thread is left out the moment its turn ends, so
 * nothing lingers on the canvas after the agent has stopped.
 */
export const agentActivity = (
  threads: readonly Thread[],
  items: Record<string, readonly ThreadItem[]>,
  pages: readonly Page[]
): readonly AgentActivity[] =>
  threads
    .filter((thread) => thread.status === "running")
    .map((thread) => {
      const tool = openToolCall(items[thread.id] ?? []);
      const places = tool?.locations ?? [];
      return {
        action: tool ? actionOf(tool.toolKind) : "thinking",
        color: colorOfThread(threads, thread.id),
        pageIds: pagesOfCall(places, tool?.title, pages),
        places,
        threadId: thread.id,
        ...(tool?.title === undefined ? {} : { title: tool.title }),
      } satisfies AgentActivity;
    });

/** What one page has an agent on it, if any. */
export const activityOnPage = (
  activity: readonly AgentActivity[],
  pageId: string
) => activity.find((a) => a.pageIds.includes(pageId));
