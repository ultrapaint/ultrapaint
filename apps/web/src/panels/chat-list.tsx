/**
 * The chat's list of threads: what each works on, as a picture, its name, its last line and where
 * it stands. Opening one gives the thread; the list is where the chat opens.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  CircleAlert,
  ListFilter,
  MessageSquare,
  Plus,
  Search,
  SquareDashedMousePointer,
  SquarePen,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { AgentIcon } from "../components/agent-icon.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { createThread } from "../lib/start-thread.ts";
import { threadView } from "../lib/thread-view.ts";
import { isUnread, useAgents } from "../state/agents.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import {
  refreshPreviews,
  useThreadPreviews,
} from "../state/thread-previews.ts";

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

const isToday = (at: number, now: number) =>
  new Date(at).toDateString() === new Date(now).toDateString();

/** Where a thread's scope is: its page's URL, or its name when it has none, or the canvas. */
const useScopeLabel = (thread: Thread) =>
  useProject((s) => {
    const { scope } = thread;
    if (!scope) {
      return null;
    }
    const page = s.pages.find((p) => p.file === scope.file);
    const where = page ? (page.route ?? page.name) : "canvas";
    return scope.nodeId === undefined ? where : `${scope.name} · ${where}`;
  });

/** The picture of what a thread works on, or a quiet tile when it works on nothing yet. */
export const ScopePicture = ({
  className,
  thread,
}: {
  className?: string;
  thread: Thread;
}) => {
  const picture = useThreadPreviews((s) => s.pictures[thread.id]);
  const several = (thread.scope?.count ?? 0) > 1;
  return (
    <span
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md",
        // A design is drawn on white, as on the canvas; the hairline holds its edge on any theme.
        picture
          ? "bg-white outline outline-black/10 -outline-offset-1 dark:outline-white/10"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      {picture ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          height={44}
          src={picture}
          width={44}
        />
      ) : (
        <MessageSquare className="size-4" />
      )}
      {several ? (
        <span className="absolute right-0.5 bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-foreground/85 px-1 font-caption text-background tabular-nums">
          {thread.scope?.count}
        </span>
      ) : null}
    </span>
  );
};

/** Where a thread stands, when it says something: a status mark beside its word. */
export const ThreadStatus = ({ thread }: { thread: Thread }) => {
  const { label, tone } = threadView(thread);
  if (label === null || tone === null) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-small text-foreground">
      {tone === "working" ? <Spinner className="size-3 text-agent" /> : null}
      {tone === "attention" ? (
        <span className="size-1.5 rounded-full bg-warning" />
      ) : null}
      {tone === "failed" ? (
        <CircleAlert className="size-3.5 text-destructive" />
      ) : null}
      {label}
    </span>
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
  const open = () => useAgents.getState().open(thread.id);
  const { label } = threadView(thread);
  return (
    <button
      className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={open}
      onContextMenu={(e) =>
        openMenuAt(e, { kind: "thread", threadId: thread.id })
      }
      title={thread.title}
      type="button"
    >
      <ScopePicture thread={thread} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-label text-foreground">
            {thread.title}
          </span>
          {/* What an agent did since the thread was last opened; a working one says so itself. */}
          {unread && label === null ? (
            <span
              aria-label="Unread"
              className="size-1.5 shrink-0 rounded-full bg-agent"
              role="img"
            />
          ) : null}
          <span className="shrink-0 font-small text-muted-foreground tabular-nums">
            {ago(thread.updatedAt, now)}
          </span>
        </span>
        <span className="truncate font-small text-muted-foreground">
          {thread.summary?.text || "Nothing sent yet"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-small text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {scopeLabel ?? "Nothing attached"}
          </span>
          <ThreadStatus thread={thread} />
        </span>
      </span>
    </button>
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
              <span className="font-small text-muted-foreground tabular-nums">
                {counts[f.value]}
              </span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** Keeps the pictures in step with the threads and their documents, a moment after they settle. */
const usePreviews = (threads: readonly Thread[]) => {
  const docs = useDocuments((s) => s.docs);
  // A document that changed is drawn again: its hash is what the picture is kept by.
  // biome-ignore lint/correctness/useExhaustiveDependencies: docs is what the pictures are drawn from.
  useEffect(() => {
    const timer = setTimeout(() => {
      refreshPreviews(threads.filter((t) => t.scope)).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [threads, docs]);
};

const Section = ({
  label,
  now,
  seen,
  threads,
}: {
  label: string;
  now: number;
  seen: Record<string, number>;
  threads: readonly Thread[];
}) =>
  threads.length > 0 ? (
    <section className="flex flex-col">
      <h3 className="px-2 pt-3 pb-1 font-small text-muted-foreground">
        {label}
      </h3>
      {threads.map((t) => (
        <ThreadRow key={t.id} now={now} thread={t} unread={isUnread(t, seen)} />
      ))}
    </section>
  ) : null;

export const ThreadList = () => {
  const threads = useAgents((s) => s.threads);
  const seen = useAgents((s) => s.seen);
  const activePage = useEditor((s) => s.activePage);
  const pageFile = useProject(
    (s) => s.pages.find((p) => p.id === activePage)?.file
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  usePreviews(threads);

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
        (t.summary?.text.toLowerCase().includes(q) ?? false) ||
        (t.scope?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [threads, query, filter, pageFile]);
  const today = shown.filter((t) => isToday(t.updatedAt, now));
  const earlier = shown.filter((t) => !isToday(t.updatedAt, now));

  const clear = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3">
        <h2 className="flex-1 font-heading-xsmall">Agents</h2>
        <IconButton onClick={() => createThread()} tooltip="New chat">
          <SquarePen />
        </IconButton>
      </div>
      {threads.length === 0 ? (
        <PanelEmpty
          action={
            <Button onClick={() => createThread()}>
              <Plus data-icon="inline-start" />
              New chat
            </Button>
          }
          icon={<SquareDashedMousePointer />}
          title="No chats yet"
        >
          Select something on the canvas and add it to a chat, or start one and
          say what to make.
        </PanelEmpty>
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
            <Section label="Today" now={now} seen={seen} threads={today} />
            <Section label="Earlier" now={now} seen={seen} threads={earlier} />
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
