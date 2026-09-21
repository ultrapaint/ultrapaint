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

/** How agents name a tool of our MCP server: asking us about the project is reading. */
const ASKING_US_RE = /(^|_)mcp__ultrapaint__/;

/** ACP names a tool call's kind; the editor only cares what it means for the canvas. */
const actionOf = (
  toolKind: string | undefined,
  title: string | undefined
): AgentAction => {
  if (title && ASKING_US_RE.test(title)) {
    return "reading";
  }
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
  pages: readonly Page[],
  focusedRoute: string | undefined
) => {
  const named = places.flatMap((place) => {
    const page = pages.find((p) => p.file === place.path);
    return page ? [page.id] : [];
  });
  if (named.length > 0) {
    return named;
  }
  const inTitle = title
    ? pages.filter((page) => title.includes(page.file)).map((p) => p.id)
    : [];
  if (inTitle.length > 0) {
    return inTitle;
  }
  // Nothing in the call says where it is: the agent's own last word on it stands.
  const focused = pages.find((page) => page.route === focusedRoute);
  return focused ? [focused.id] : [];
};

/**
 * One entry per thread whose agent is working. A thread is left out the moment its turn ends, so
 * nothing lingers on the canvas after the agent has stopped.
 */
export const agentActivity = (
  threads: readonly Thread[],
  items: Record<string, readonly ThreadItem[]>,
  pages: readonly Page[],
  /** The route each agent last said it was working on, by thread. */
  focused: Record<string, string> = {}
): readonly AgentActivity[] =>
  threads
    .filter((thread) => thread.status === "running")
    .map((thread) => {
      const tool = openToolCall(items[thread.id] ?? []);
      const places = tool?.locations ?? [];
      return {
        action: tool ? actionOf(tool.toolKind, tool.title) : "thinking",
        color: colorOfThread(threads, thread.id),
        pageIds: pagesOfCall(places, tool?.title, pages, focused[thread.id]),
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
