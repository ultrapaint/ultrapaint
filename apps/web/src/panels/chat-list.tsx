/**
 * The chat's list of threads (ADR 0132): each a row of its title, where it stands and where it
 * works, grouped as the person chose and with Settle and Discard draft on hover (ADR 0141).
 * Opening one gives the thread; the list is where the chat opens.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Hourglass,
  ListFilter,
  MessageCircleQuestion,
  PenLine,
  Plus,
  Search,
  SquareDashedMousePointer,
  SquarePen,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { type ChatGroup, groupChats } from "../lib/chat-groups.ts";
import { createThread, startTask } from "../lib/start-thread.ts";
import { rowState, threadView } from "../lib/thread-view.ts";
import { isUnread, lineOf, useAgents } from "../state/agents.ts";
import { useChatListFolds } from "../state/chat-list-folds.ts";
import { useChatRename } from "../state/chat-rename.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { setDraft, useDraft } from "../state/drafts.ts";
import { useEditor } from "../state/editor.ts";
import { usePreferences } from "../state/preferences.ts";
import { reportError, useProject } from "../state/project.ts";

type Filter = "all" | "running" | "page";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in the fewest characters: now, 12m, 3h, 2d, 3w, 4mo. */
const ago = (at: number, now: number): string => {
  const d = Math.max(0, now - at);
  if (d < MINUTE) {
    return "now";
  }
  if (d < HOUR) {
    return `${Math.floor(d / MINUTE)}m`;
  }
  if (d < DAY) {
    return `${Math.floor(d / HOUR)}h`;
  }
  if (d < 7 * DAY) {
    return `${Math.floor(d / DAY)}d`;
  }
  if (d < 30 * DAY) {
    return `${Math.floor(d / (7 * DAY))}w`;
  }
  return `${Math.floor(d / (30 * DAY))}mo`;
};

/** Where a thread's scope is: its page's URL, or its name when it has none, or the canvas. */
const useScopeLabel = (thread: Thread) =>
  useProject((s) => {
    const { scope } = thread;
    if (!scope) {
      return null;
    }
    const page = s.pages.find((p) => p.file === scope.file);
    const where = page ? (page.route ?? page.name) : "Canvas";
    return scope.nodeId === undefined ? where : `${scope.name} · ${where}`;
  });

const ICON = "size-3.5 shrink-0";

/**
 * Where a thread stands, at the row's right: a word with its icon, or its age when there is
 * nothing to say. Only what needs the person takes a colour, on its icon: a question the warning,
 * a failure the destructive one. Working is muted, as the age is: nothing to do about it.
 */
const RowStatus = ({
  now,
  thread,
  unread,
}: {
  now: number;
  thread: Thread;
  unread: boolean;
}) => {
  const state = rowState(thread, unread);
  if (state === null) {
    return (
      <span className="shrink-0 font-body-small text-muted-foreground tabular-nums">
        {ago(thread.updatedAt, now)}
      </span>
    );
  }
  const working = state.kind === "working";
  const since =
    working && state.since !== undefined ? ago(state.since, now) : "now";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 font-body-small tabular-nums",
        working ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {working ? (
        <Spinner aria-hidden className={ICON} role="presentation" />
      ) : null}
      {state.kind === "asks" ? (
        <MessageCircleQuestion
          aria-hidden
          className={cn(ICON, "text-warning")}
        />
      ) : null}
      {state.kind === "unresponsive" ? (
        <Hourglass aria-hidden className={ICON} />
      ) : null}
      {state.kind === "stopped" ? (
        <CircleAlert aria-hidden className={cn(ICON, "text-destructive")} />
      ) : null}
      {state.kind === "done" ? (
        <CircleCheck aria-hidden className={ICON} />
      ) : null}
      {/* How long the turn has run, past its first minute: "Working 9m". */}
      {since === "now" ? state.label : `${state.label} ${since}`}
    </span>
  );
};

/** A pen before the title while the chat's composer holds something not sent. */
const DraftMark = ({ threadId }: { threadId: string }) => {
  const draft = useDraft(threadId);
  if (!draft) {
    return null;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label="Draft not sent"
            className="flex shrink-0 text-muted-foreground"
            role="img"
          />
        }
      >
        <PenLine className={ICON} />
      </TooltipTrigger>
      <TooltipContent>Draft not sent</TooltipContent>
    </Tooltip>
  );
};

/** Settles a chat from the list, or brings it back (ADR 0141). */
const settle = (threadId: string, settled: boolean) =>
  api().request("threads.settle", { settled, threadId }).catch(reportError);

/** Throws a chat's draft away, with Undo in a toast that puts it back. */
const discardDraft = (threadId: string, draft: string) => {
  setDraft(threadId, "");
  toast("Draft discarded", {
    // Back only into an empty composer: a draft written since is not thrown away for it.
    action: {
      label: "Undo",
      onClick: () =>
        setDraft(threadId, (current) => (current === "" ? draft : current)),
    },
  });
};

const ACTION =
  "flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 font-body-small text-muted-foreground outline-none transition-colors duration-100 hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * What a row offers on hover, or once the keyboard reaches it, in its state's place: Discard
 * draft while its composer holds one, then Settle, or Un-settle on a settled chat.
 */
const RowActions = ({ thread }: { thread: Thread }) => {
  const draft = useDraft(thread.id);
  const settled = thread.settledAt !== undefined;
  return (
    <span className="absolute top-1 right-1 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex">
      {draft ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label="Discard draft"
                className={cn(ACTION, "w-6 justify-center px-0")}
                onClick={() => discardDraft(thread.id, draft)}
                type="button"
              />
            }
          >
            <X className={ICON} />
          </TooltipTrigger>
          <TooltipContent>Discard draft</TooltipContent>
        </Tooltip>
      ) : null}
      <button
        className={ACTION}
        onClick={() => settle(thread.id, !settled)}
        type="button"
      >
        {settled ? <Undo2 className={ICON} /> : <Check className={ICON} />}
        {settled ? "Un-settle" : "Settle"}
      </button>
    </span>
  );
};

/** The title edited in place, from Rename… in the row's menu: Enter sends it, Escape keeps it. */
const TitleField = ({ thread }: { thread: Thread }) => {
  const done = useChatRename((s) => s.done);
  const [title, setTitle] = useState(thread.title);
  // Ended by Enter or Escape: the blur as the field goes is not a second ending.
  const ended = useRef<boolean>(false);
  const end = (byKey: boolean) => {
    ended.current = true;
    done(byKey);
  };
  const send = (byKey: boolean) => {
    if (ended.current) {
      return;
    }
    const given = title.trim();
    end(byKey);
    if (given && given !== thread.title) {
      api()
        .request("threads.rename", { threadId: thread.id, title: given })
        .catch(reportError);
    }
  };
  return (
    <input
      aria-label="Chat title"
      autoFocus
      className="min-w-0 flex-1 rounded-sm bg-background px-1 font-body-medium text-foreground outline-none ring-2 ring-ring"
      onBlur={() => send(false)}
      onChange={(e) => setTitle(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        // Enter confirming a word an input method composes is not the title's.
        if (e.nativeEvent.isComposing) {
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          send(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          end(true);
        }
      }}
      value={title}
    />
  );
};

const ThreadRow = ({
  now,
  thread,
  unread,
}: {
  now: number;
  thread: Thread;
  unread: boolean;
}) => {
  const scopeLabel = useScopeLabel(thread);
  const renaming = useChatRename((s) => s.threadId === thread.id);
  const refocus = useChatRename((s) => s.refocus === thread.id);
  const button = useRef<HTMLButtonElement>(null);
  // Back from its title by Enter or Escape: the keyboard is on the row again.
  useEffect(() => {
    if (refocus && button.current) {
      button.current.focus();
      useChatRename.setState({ refocus: null });
    }
  }, [refocus]);
  const open = () => useAgents.getState().open(thread.id);
  const where = (
    <span className="truncate font-body-small text-muted-foreground">
      {scopeLabel ?? "Nothing attached"}
    </span>
  );
  if (renaming) {
    return (
      <div className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <TitleField thread={thread} />
        </span>
        {where}
      </div>
    );
  }
  return (
    <div className="group/row relative">
      <button
        className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring group-hover/row:bg-accent"
        onClick={open}
        onContextMenu={(e) =>
          openMenuAt(e, { inList: true, kind: "thread", threadId: thread.id })
        }
        ref={button}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <DraftMark threadId={thread.id} />
          <CutText className="min-w-0 flex-1 truncate font-body-medium text-foreground">
            {thread.title}
          </CutText>
          {/* Kept in place under the actions, so the title does not move on hover. */}
          <span className="flex shrink-0 group-focus-within/row:invisible group-hover/row:invisible">
            <RowStatus now={now} thread={thread} unread={unread} />
          </span>
        </span>
        {where}
      </button>
      <RowActions thread={thread} />
    </div>
  );
};

const FILTERS: readonly { label: string; value: Filter }[] = [
  { label: "All chats", value: "all" },
  { label: "Working", value: "running" },
  { label: "On this page", value: "page" },
];

/**
 * The filter, at the end of the search field: which chats the list shows, each choice with how
 * many it would. Pressed while it narrows the list.
 */
const FilterMenu = ({
  counts,
  filter,
  onChange,
}: {
  counts: Partial<Record<Filter, number>>;
  filter: Filter;
  onChange: (filter: Filter) => void;
}) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            aria-label="Filter chats"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground",
              filter !== "all" && "bg-accent text-foreground"
            )}
          />
        }
      >
        <ListFilter className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>Filter</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" className="w-48">
      <DropdownMenuRadioGroup
        onValueChange={(v) => onChange(v as Filter)}
        value={filter}
      >
        {FILTERS.map((f) => (
          <DropdownMenuRadioItem closeOnClick key={f.value} value={f.value}>
            <span className="flex-1">{f.label}</span>
            {counts[f.value] === undefined ? null : (
              <span className="font-body-small text-muted-foreground tabular-nums">
                {counts[f.value]}
              </span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** A group's heading: none for the chats on top, a button with its count for one that folds. */
const SectionHeading = ({
  group,
  onToggle,
  open,
}: {
  group: ChatGroup;
  onToggle: () => void;
  open: boolean;
}) => {
  if (group.label === null) {
    return null;
  }
  if (!group.folds) {
    return (
      <h3 className="px-2 pt-3 pb-1 font-body-small text-muted-foreground">
        {group.label}
      </h3>
    );
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <h3>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-sm px-2 pt-3 pb-1 font-body-small text-muted-foreground outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <span className="flex-1 text-left">{group.label}</span>
        <span className="tabular-nums">{group.threads.length}</span>
        <Chevron className={ICON} />
      </button>
    </h3>
  );
};

/**
 * One group of the list: its heading over its rows. Working and Settled fold, as the person left
 * them; a search shows every chat it found, the settled too.
 */
const Section = ({
  group,
  now,
  searching,
  seen,
}: {
  group: ChatGroup;
  now: number;
  searching: boolean;
  seen: Record<string, number>;
}) => {
  const closed = useChatListFolds((s) => s.closed[group.key] ?? false);
  const toggle = useChatListFolds((s) => s.toggle);
  const open = !(group.folds && closed) || searching;
  return (
    <section className="flex flex-col gap-1">
      <SectionHeading
        group={group}
        onToggle={() => toggle(group.key)}
        open={open}
      />
      {open
        ? group.threads.map((t) => (
            <ThreadRow
              key={t.id}
              now={now}
              thread={t}
              unread={isUnread(t, seen)}
            />
          ))
        : null}
    </section>
  );
};

/**
 * The list with no chats. A folder whose settings were detected and not saved yet is ready to
 * design in (ADR 0092); an agent can check what was found against the code, `/setup` in a new
 * chat's composer for the person to send, and nothing starts it on its own (ADR 0073).
 */
const NoChats = ({ unsetFolder }: { unsetFolder: string | null }) =>
  unsetFolder === null ? (
    <PanelEmpty
      action={
        <Button onClick={() => createThread()} variant="secondary">
          <Plus data-icon="inline-start" />
          New chat
        </Button>
      }
      icon={<SquareDashedMousePointer />}
      title="No chats yet"
    >
      Select something on the canvas and add it to a chat, or start one and say
      what to make.
    </PanelEmpty>
  ) : (
    <PanelEmpty
      action={
        <Button
          onClick={() => startTask({ _tag: "Setup" })}
          variant="secondary"
        >
          Check settings…
        </Button>
      }
      icon={<SquareDashedMousePointer />}
      title="No chats yet"
    >
      {unsetFolder} is ready to design in. An agent can check what Ultrapaint
      found in it.
    </PanelEmpty>
  );

const NO_LINES: Readonly<Record<string, string>> = {};

export const ThreadList = () => {
  const threads = useAgents((s) => s.threads);
  const seen = useAgents((s) => s.seen);
  const activePage = useEditor((s) => s.activePage);
  const pageFile = useProject(
    (s) => s.pages.find((p) => p.id === activePage)?.file
  );
  const unsetFolder = useProject((s) =>
    s.info.configured && s.info.setup === "detected"
      ? (s.info.name ?? "This folder")
      : null
  );
  const [query, setQuery] = useState("");
  // Each chat's last line, which the rows no longer show (ADR 0132), is read only for a search
  // that finds a chat by it: the list is not drawn again for every word an agent streams.
  const lines = useAgents(
    useShallow((s) =>
      query.trim()
        ? Object.fromEntries(
            threads.map((t) => [t.id, lineOf(t, s.items[t.id])])
          )
        : NO_LINES
    )
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);

  const running = threads.filter((t) => threadView(t).busy).length;
  const onPage = threads.filter((t) => t.scope?.file === pageFile).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (filter === "running" && !threadView(t).busy) {
        return false;
      }
      if (filter === "page" && t.scope?.file !== pageFile) {
        return false;
      }
      return (
        !q ||
        t.title.toLowerCase().includes(q) ||
        (lines[t.id]?.toLowerCase().includes(q) ?? false) ||
        (t.scope?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [threads, lines, query, filter, pageFile]);
  const grouping = usePreferences((s) => s.chatGrouping);
  const pages = useProject((s) => s.pages);
  const groups = groupChats(shown, {
    grouping,
    now,
    pageOf: (t) => {
      const page = pages.find((p) => p.file === t.scope?.file);
      return page ? (page.route ?? page.name) : null;
    },
    unread: (t) => isUnread(t, seen),
  });

  const clear = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="flex-1 font-heading-xsmall">Agents</h2>
        <IconButton onClick={() => createThread()} tooltip="New chat">
          <SquarePen />
        </IconButton>
      </div>
      {threads.length === 0 ? (
        <NoChats unsetFolder={unsetFolder} />
      ) : (
        <>
          <div className="px-2 pb-1">
            <div className="flex h-7 items-center gap-1.5 rounded-md border border-transparent bg-muted pr-0.5 pl-2 text-muted-foreground transition-colors duration-100 hover:border-input has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/25">
              <label className="flex min-w-0 flex-1 items-center gap-1.5">
                <Search className="size-3.5 shrink-0" />
                <input
                  aria-label="Search chats"
                  className="min-w-0 flex-1 bg-transparent font-body text-foreground outline-none placeholder:text-muted-foreground"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && query) {
                      e.stopPropagation();
                      setQuery("");
                    }
                  }}
                  placeholder="Search chats"
                  value={query}
                />
              </label>
              <FilterMenu
                counts={{ all: threads.length, page: onPage, running }}
                filter={filter}
                onChange={setFilter}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {shown.length === 0 ? (
              <PanelEmpty
                action={
                  <Button onClick={clear} variant="secondary">
                    {query ? "Clear search" : "Show all chats"}
                  </Button>
                }
                icon={<Search />}
                title="No chats found"
              >
                {emptyNote(filter, query.trim())}
              </PanelEmpty>
            ) : null}
            {groups.map((g) => (
              <Section
                group={g}
                key={g.key}
                now={now}
                searching={!!query.trim()}
                seen={seen}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/** Why the list is empty, in the words of the search and the filter. */
const emptyNote = (filter: Filter, query: string) => {
  const which = {
    all: "chat",
    page: "chat on this page",
    running: "working chat",
  }[filter];
  if (query) {
    return `No ${which} mentions “${query}”.`;
  }
  return filter === "page" ? "No chat is on this page." : "No chat is working.";
};
