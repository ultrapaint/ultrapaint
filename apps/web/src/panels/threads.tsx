import {
  isModelOption,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  ChevronLeft,
  CircleAlert,
  Ellipsis,
  Eye,
  LocateFixed,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { AgentIcon } from "../components/agent-icon.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { showScope } from "../lib/add-to-chat.ts";
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
import { Composer } from "./thread-composer.tsx";
import { currentName } from "./thread-pickers.tsx";
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
    return <SetupEmpty />;
  }
  if (view === "list" || !thread) {
    return <ThreadList />;
  }
  return (
    <div className="flex h-full flex-col">
      <ThreadHeader thread={thread} />
      <SetupStepBar threadId={thread.id} />
      <ScopeBar thread={thread} />
      <ThreadView items={items ?? []} thread={thread} />
    </div>
  );
};

/** Back to the list, the thread's name and who works on it. */
const ThreadHeader = ({ thread }: { thread: Thread }) => {
  const agentName = useAgents(
    (s) => s.agents.find((a) => a.id === thread.agentId)?.name
  );
  const model = currentName(thread.configOptions?.find(isModelOption));
  const following = useAgents((s) => s.following === thread.id);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the header's menu is the thread's; its buttons raise it from the keyboard.
    <div
      className="flex h-13 shrink-0 items-center gap-1 border-b px-1.5"
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
        <span className="truncate font-heading-xsmall">{thread.title}</span>
        <span className="flex min-w-0 items-center gap-1 font-body text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3 shrink-0" />
          <span className="truncate">
            {[agentName, model].filter(Boolean).join(" · ")}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-sm border px-1 leading-4",
              thread.purpose === "implement" && "border-agent text-agent"
            )}
            title={
              thread.purpose === "implement"
                ? "Implements: it may write the application's code"
                : "Designs: it writes the designs only; behaviour it is asked for becomes notes for the code"
            }
          >
            {thread.purpose === "implement" ? "Implements" : "Designs"}
          </span>
        </span>
      </div>
      <IconButton
        aria-pressed={following}
        className={cn(following && "text-agent hover:text-agent")}
        onClick={() => toggleFollowing(thread.id)}
        tooltip={following ? "Stop following" : "Follow on the canvas"}
      >
        <Eye />
      </IconButton>
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
  const route = useProject((s) => {
    const page = s.pages.find((p) => p.file === scope?.file);
    return page ? (page.route ?? page.name) : undefined;
  });
  if (!scope) {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b bg-muted/30 py-2 pr-2 pl-3">
      <ScopePicture className="size-9" thread={thread} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-body text-muted-foreground">Working on</span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "truncate font-semibold",
              scope.component && "text-component"
            )}
          >
            {scope.name}
            {scope.count ? ` +${scope.count - 1}` : ""}
          </span>
          <span className="truncate font-code text-muted-foreground">
            {route ?? "canvas"}
          </span>
        </span>
      </div>
      <Button onClick={() => showScope(thread)} size="sm" variant="outline">
        <LocateFixed data-icon="inline-start" />
        Show
      </Button>
    </div>
  );
};

const ThreadView = ({
  thread,
  items,
}: {
  thread: Thread;
  items: readonly ThreadItem[];
}) => {
  const entries = useMemo(() => groupWork(items), [items]);
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
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-2 p-2">
                {entries.map((entry) => (
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
                {busy ? <WorkingIndicator since={since} /> : null}
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
        </MessageScrollerProvider>
      )}
      <Composer key={`composer:${thread.id}`} thread={thread} />
    </>
  );
};
