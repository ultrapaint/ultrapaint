/**
 * How the chat list groups its chats (ADR 0141), by the person's Group chats setting: by state
 * as T3 Code does (what needs them or finished on top, then Working, then Settled), by day, by
 * page, or not at all. Settled chats are last in every grouping, in a group that folds.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { rowState } from "./thread-view.ts";

export type ChatGrouping = "state" | "day" | "page" | "none";

export const CHAT_GROUPINGS: readonly { label: string; value: ChatGrouping }[] =
  [
    { label: "By state", value: "state" },
    { label: "By day", value: "day" },
    { label: "By page", value: "page" },
    { label: "None", value: "none" },
  ];

export interface ChatGroup {
  /** Folds open and closed with its chevron: Working and Settled. */
  readonly folds: boolean;
  readonly key: string;
  /** Its heading; null for the chats on top that need none. */
  readonly label: string | null;
  readonly threads: readonly Thread[];
}

interface Options {
  readonly grouping: ChatGrouping;
  readonly now: number;
  /** Where a chat works, as its page says it, or null when it works on no page. */
  readonly pageOf: (thread: Thread) => string | null;
  /** Whether the chat changed since the person last opened it. */
  readonly unread: (thread: Thread) => boolean;
}

const isToday = (at: number, now: number) =>
  new Date(at).toDateString() === new Date(now).toDateString();

const group = (
  key: string,
  label: string | null,
  threads: readonly Thread[],
  folds = false
): ChatGroup => ({ folds, key, label, threads });

/** The groups the list shows, in order, each with its chats in the order given; none empty. */
export const groupChats = (
  threads: readonly Thread[],
  { grouping, now, pageOf, unread }: Options
): ChatGroup[] => {
  const settled = threads.filter((t) => t.settledAt !== undefined);
  const listed = threads.filter((t) => t.settledAt === undefined);
  const groups: ChatGroup[] = [];
  if (grouping === "state") {
    const working = (t: Thread) => rowState(t, unread(t))?.kind === "working";
    groups.push(
      group(
        "top",
        null,
        listed.filter((t) => !working(t))
      )
    );
    groups.push(group("working", "Working", listed.filter(working), true));
  } else if (grouping === "day") {
    groups.push(
      group(
        "today",
        "Today",
        listed.filter((t) => isToday(t.updatedAt, now))
      )
    );
    groups.push(
      group(
        "earlier",
        "Earlier",
        listed.filter((t) => !isToday(t.updatedAt, now))
      )
    );
  } else if (grouping === "page") {
    const pages = new Map<string, Thread[]>();
    const none: Thread[] = [];
    for (const t of listed) {
      const page = pageOf(t);
      if (page === null) {
        none.push(t);
      } else {
        pages.set(page, [...(pages.get(page) ?? []), t]);
      }
    }
    for (const [page, held] of pages) {
      groups.push(group(`page:${page}`, page, held));
    }
    groups.push(group("no-page", "No page", none));
  } else {
    groups.push(group("all", null, listed));
  }
  groups.push(group("settled", "Settled", settled, true));
  return groups.filter((g) => g.threads.length > 0);
};
