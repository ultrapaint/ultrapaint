import { levelOf, reviewSettingsOf } from "@ultrapaint/contracts/review";
import {
  isBusy,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { ChevronLeft, CircleAlert, Ellipsis, LocateFixed } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { AgentIcon } from "../components/agent-icon.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { showScope } from "../lib/add-to-chat.ts";
import { roundsByPlan, stoppedRuns } from "../lib/design-run.ts";
import { toggleFollowing } from "../lib/thread-actions.ts";
import { threadView } from "../lib/thread-view.ts";
import { groupWork } from "../lib/thread-work.ts";
import { useAgents } from "../state/agents.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { ScopePicture, ThreadList } from "./chat-list.tsx";
import { ChatStarters } from "./chat-starters.tsx";
import { SetupStepBar, SetupStepIntro } from "./design-system-setup.tsx";
import { LEVEL_NAMES } from "./review-level.tsx";
import { Composer } from "./thread-composer.tsx";
import {
  inRunCard,
  type RunContext,
  RunContextValue,
} from "./thread-review.tsx";
import { Entry, keyOfEntry } from "./thread-transcript.tsx";
import { WorkingIndicator } from "./thread-work.tsx";

export const Threads = () => {
  const configured = useProject((s) => s.info.configured);
  const view = useAgents((s) => s.view);
  const thread = useAgents(
    (s) => s.threads.find((t) => t.id === s.current) ?? null
  );
  const items = useAgents((s) => (thread ? s.items[thread.id] : undefined));

  useEffect(() => {
    if (!configured) {
      return;
    }
    useAgents.getState().load();
  }, [configured]);

  if (!configured) {
    return <NoFolder />;
  }
  if (view === "list" || !thread) {
    return <ThreadList />;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col border-b">
        <ThreadHeader thread={thread} worked={(items?.length ?? 0) > 0} />
        <ScopeBar thread={thread} />
      </div>
      <SetupStepBar threadId={thread.id} />
      <ThreadView items={items ?? []} thread={thread} />
    </div>
  );
};

/**
 * Back to the list, the thread's name and who works on it (its model is the composer's picker's),
 * and, once the agent has done something, following it on the canvas.
 */
const ThreadHeader = ({
  thread,
  worked,
}: {
  thread: Thread;
  worked: boolean;
}) => {
  const agentName = useAgents(
    (s) => s.agents.find((a) => a.id === thread.agentId)?.name
  );
  const following = useAgents((s) => s.following === thread.id);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the header's menu is the thread's; its buttons raise it from the keyboard.
    <div
      className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-1.5"
      onContextMenu={(e) =>
        openMenuAt(e, { kind: "thread", threadId: thread.id })
      }
    >
      <IconButton
        onClick={() => useAgents.getState().back()}
        tooltip="All chats"
      >
        <ChevronLeft />
      </IconButton>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate font-heading-xsmall" title={thread.title}>
          {thread.title}
        </h2>
        <span className="flex min-w-0 items-center gap-1.5 font-body-small text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3 shrink-0" />
          <span className="truncate">{agentName ?? thread.agentId}</span>
          {/* A design thread is the rule; one that may write the code says so (ADR 0030). */}
          {thread.purpose === "implement" ? (
            <Tooltip>
              <TooltipTrigger render={<Badge className="shrink-0" />}>
                Implements
              </TooltipTrigger>
              <TooltipContent>May change the application’s code</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </div>
      {worked ? (
        <Button
          aria-pressed={following}
          className={cn(
            "text-muted-foreground",
            following && "bg-accent text-foreground"
          )}
          onClick={() => toggleFollowing(thread.id)}
          size="sm"
          title={
            following
              ? "Stop following the agent on the canvas"
              : "Follow the agent on the canvas"
          }
          variant="ghost"
        >
          Follow
        </Button>
      ) : null}
      <IconButton
        onClick={(e) => openMenuAt(e, { kind: "thread", threadId: thread.id })}
        tooltip="More"
      >
        <Ellipsis />
      </IconButton>
    </div>
  );
};

/** What the thread works on, pinned under its header, with the way to it on the canvas. */
const ScopeBar = ({ thread }: { thread: Thread }) => {
  const { scope } = thread;
  // A node's page by its name and URL; a page by its URL; a node beside the pages, the canvas.
  const where = useProject((s) => {
    const page = s.pages.find((p) => p.file === scope?.file);
    if (!page) {
      return "On the canvas";
    }
    const route = page.route ?? page.name;
    return scope?.nodeId === undefined ? route : `${page.name} · ${route}`;
  });
  if (!scope) {
    return null;
  }
  const more = scope.count && scope.count > 1 ? scope.count - 1 : 0;
  return (
    <div className="flex items-center gap-2.5 px-3 pb-2">
      <ScopePicture className="size-8" thread={thread} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-body font-medium" title={scope.name}>
          {scope.name}
          {more ? (
            <span className="text-muted-foreground"> and {more} more</span>
          ) : null}
        </span>
        <span className="truncate font-body-small text-muted-foreground">
          {where}
        </span>
      </div>
      <Button onClick={() => showScope(thread)} size="sm" variant="ghost">
        <LocateFixed data-icon="inline-start" />
        Show
      </Button>
    </div>
  );
};

/** The review a design thread runs with, in a few words, and its runs' rounds (ADR 0063). */
const useRunContext = (
  thread: Thread,
  items: readonly ThreadItem[]
): RunContext => {
  const project = useProject((s) => s.settings?.review);
  return useMemo(() => {
    const settings = reviewSettingsOf(project, thread.review);
    const level = levelOf(settings);
    const count = settings.reviewModels?.length ?? 0;
    const planned =
      level === "off"
        ? "Off"
        : [
            LEVEL_NAMES[level],
            count > 0 ? `${count} review model${count === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
    return {
      busy: isBusy(thread.status),
      planned,
      rounds: roundsByPlan(items),
      stopped: stoppedRuns(items),
      threadId: thread.id,
    };
  }, [items, project, thread.id, thread.review, thread.status]);
};

const ThreadView = ({
  thread,
  items,
}: {
  thread: Thread;
  items: readonly ThreadItem[];
}) => {
  const entries = useMemo(() => groupWork(items), [items]);
  const run = useRunContext(thread, items);
  // A round inside its run's card isn't an entry of its own: no gap is left where it was.
  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          !(
            e.kind === "item" &&
            e.item.kind === "review" &&
            inRunCard(run, e.item)
          )
      ),
    [entries, run]
  );
  const { busy, failed } = threadView(thread);
  const last = items.at(-1);
  const since = items.findLast((i) => i.kind === "user")?.at;
  const fresh = items.length === 0 && !(busy || failed);
  const stepThread = useDesignSystemSetup(
    (s) =>
      s.setup?.steps.some(
        (step) => step.threadId === thread.id && step.status !== "todo"
      ) ?? false
  );
  return (
    <>
      {fresh && stepThread ? <SetupStepIntro threadId={thread.id} /> : null}
      {fresh && !stepThread ? <ChatStarters thread={thread} /> : null}
      {/* Keyed by thread so each one opens scrolled to its latest message. */}
      {fresh ? null : (
        <MessageScrollerProvider
          autoScroll
          defaultScrollPosition="end"
          key={`scroller:${thread.id}`}
        >
          <RunContextValue.Provider value={run}>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-3 px-3 pt-3 pb-4">
                  {shown.map((entry) => (
                    <MessageScrollerItem
                      key={keyOfEntry(entry)}
                      messageId={keyOfEntry(entry)}
                    >
                      <Entry
                        entry={entry}
                        last={last}
                        running={busy}
                        threadId={thread.id}
                      />
                    </MessageScrollerItem>
                  ))}
                  {/* While a turn runs, the agent's start included, or is being stopped. */}
                  {busy ? (
                    <WorkingIndicator
                      label={
                        thread.status === "reviewing"
                          ? "Reviewing…"
                          : "Working…"
                      }
                      since={
                        thread.status === "reviewing"
                          ? items.findLast((i) => i.kind === "review")?.at
                          : since
                      }
                    />
                  ) : null}
                  {failed ? (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertTitle>The agent stopped</AlertTitle>
                      <AlertDescription className="whitespace-pre-wrap">
                        {thread.error}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </RunContextValue.Provider>
        </MessageScrollerProvider>
      )}
      <Composer key={`composer:${thread.id}`} thread={thread} />
    </>
  );
};
