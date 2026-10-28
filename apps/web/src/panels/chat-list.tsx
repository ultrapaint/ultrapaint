/**
 * The chat's list of threads: what each works on, as a picture, its name, its last line and where
 * it stands. Opening one gives the thread; the list is where the chat opens.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  CircleAlert,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  SquareDashedMousePointer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { AgentIcon } from "../components/agent-icon.tsx";
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

/** The picture of what a thread works on, or the agents' mark when it works on nothing yet. */
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
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white",
        thread.scope?.component && "border-component/60",
        className
      )}
    >
      {picture ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          height={48}
          src={picture}
          width={48}
        />
      ) : (
        <Sparkles className="size-4 text-zinc-400" />
      )}
      {several ? (
        <span className="absolute right-0.5 bottom-0.5 rounded bg-foreground/80 px-1 font-body font-semibold text-background">
          {thread.scope?.count}
        </span>
      ) : null}
    </span>
  );
};

const TONE_CLASS = {
  attention: "text-warning",
  failed: "text-destructive",
  working: "text-agent",
} as const;

const Status = ({ thread }: { thread: Thread }) => {
  const { label, tone } = threadView(thread);
  if (label === null || tone === null) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 font-medium",
        TONE_CLASS[tone]
      )}
    >
      {tone === "working" ? <Spinner className="size-3" /> : null}
      {tone === "attention" ? (
        <span className="size-1.5 rounded-full bg-warning" />
      ) : null}
      {tone === "failed" ? <CircleAlert className="size-3" /> : null}
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
  return (
    <button
      className="flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={open}
      onContextMenu={(e) =>
        openMenuAt(e, { kind: "thread", threadId: thread.id })
      }
      type="button"
    >
      <ScopePicture thread={thread} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-heading-xsmall text-foreground">
            {thread.title}
          </span>
          {unread ? (
            <span
              aria-label="Unread"
              className="size-1.5 shrink-0 rounded-full bg-selection"
              role="img"
            />
          ) : null}
          <span className="shrink-0 font-body text-muted-foreground">
            {ago(thread.updatedAt, now)}
          </span>
        </span>
        <span className="truncate font-body text-muted-foreground">
          {thread.summary?.text || "Nothing sent yet"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pt-0.5 font-body">
          <AgentIcon agentId={thread.agentId} className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
            {scopeLabel ?? "No scope"}
          </span>
          <Status thread={thread} />
        </span>
      </span>
    </button>
  );
};

const FILTERS: readonly { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Running", value: "running" },
  { label: "This page", value: "page" },
];

/**
 * The filter, at the end of the search field: which chats the list shows, each choice with how
 * many it would. Lit while it narrows the list.
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
    <DropdownMenuTrigger
      aria-label="Filter chats"
      className="relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-background/60 data-popup-open:text-foreground"
      title="Filter chats"
    >
      <ListFilter
        className={cn("size-3.5", filter !== "all" && "text-foreground")}
      />
      {filter === "all" ? null : (
        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-brand" />
      )}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(v) => onChange(v as Filter)}
          value={filter}
        >
          {FILTERS.map((f) => (
            <DropdownMenuRadioItem closeOnClick key={f.value} value={f.value}>
              <span className="flex-1">{f.label}</span>
              {counts[f.value] ? (
                <span className="text-muted-foreground">{counts[f.value]}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
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
      <h3 className="px-2 pt-3 pb-1 font-heading-xsmall text-muted-foreground">
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3">
        <span className="flex-1 font-heading-xsmall">Chats</span>
        <Button
          className="h-7 gap-1 px-2 font-body"
          onClick={() => createThread()}
          size="sm"
          variant="secondary"
        >
          <Plus data-icon="inline-start" />
          New
        </Button>
      </div>
      <div className="px-3 pb-1">
        <div className="flex h-7.5 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-2 text-muted-foreground has-[input:focus]:ring-2 has-[input:focus]:ring-ring/50">
          <label className="flex min-w-0 flex-1 items-center gap-1.5">
            <Search className="size-3.5 shrink-0" />
            <input
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent font-body text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              value={query}
            />
          </label>
          <FilterMenu
            counts={{ page: onPage, running }}
            filter={filter}
            onChange={setFilter}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center text-muted-foreground">
            <SquareDashedMousePointer className="size-5" />
            <p>
              {threads.length === 0
                ? "Select something on the canvas and add it to the chat, or start a new chat."
                : "No chat matches."}
            </p>
          </div>
        ) : null}
        <Section label="Today" now={now} seen={seen} threads={today} />
        <Section label="Earlier" now={now} seen={seen} threads={earlier} />
      </div>
    </div>
  );
};
