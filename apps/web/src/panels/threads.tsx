import { levelOf, reviewSettingsOf } from "@ultrapaint/contracts/review";
import {
  isBusy,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { ChevronLeft, CircleAlert, Ellipsis } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelFailed } from "../components/panel.tsx";
import { PanelLoading } from "../components/splash.tsx";
import { roundsByPlan, stoppedRuns } from "../lib/design-run.ts";
import { deleteThread } from "../lib/thread-actions.ts";
import { splitTurns } from "../lib/thread-turns.ts";
import { threadView } from "../lib/thread-view.ts";
import { groupWork } from "../lib/thread-work.ts";
import { useAgents } from "../state/agents.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { usePreferences } from "../state/preferences.ts";
import { useProject } from "../state/project.ts";
import { ThreadList } from "./chat-list.tsx";
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
import { TurnView } from "./thread-turn.tsx";
import { WorkingIndicator } from "./thread-work.tsx";

export const Threads = () => {
  const configured = useProject((s) => s.info.configured);
  const view = useAgents((s) => s.view);
  const thread = useAgents(
    (s) => s.threads.find((t) => t.id === s.current) ?? null
  );
  const items = useAgents((s) => (thread ? s.items[thread.id] : undefined));
  const readFailed = useAgents(
    (s) => thread !== null && s.readFailed[thread.id] === true
  );

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
      <ThreadHeader thread={thread} />
      <SetupStepBar threadId={thread.id} />
      {/* A chat still being read is not an empty one: its starters are a new chat's alone. */}
      {items === undefined ? (
        <Unread
          failed={readFailed}
          onRetry={() => useAgents.getState().open(thread.id)}
        />
      ) : (
        <ThreadView items={items} thread={thread} />
      )}
      <Composer key={`composer:${thread.id}`} thread={thread} />
    </div>
  );
};

/**
 * Back to the list, the thread's name, and its menu (ADR 0095). Who works on it is the composer's
 * model picker's; following and showing its page are its turn's card's, where they apply.
 */
const ThreadHeader = ({ thread }: { thread: Thread }) => {
  const everyStep = usePreferences((s) => s.everyStep);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the header's menu is the thread's; its buttons raise it from the keyboard.
    <div
      className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-1.5"
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
      <h2 className="flex min-w-0 flex-1 items-center gap-1.5 font-heading-xsmall">
        <CutText className="block truncate">{thread.title}</CutText>
        {/* A design thread is the rule; one that may write the code says so (ADR 0030). */}
        {thread.purpose === "implement" ? (
          <Tooltip>
            <TooltipTrigger render={<Badge className="shrink-0" />}>
              Implements
            </TooltipTrigger>
            <TooltipContent>May change the application’s code</TooltipContent>
          </Tooltip>
        ) : null}
      </h2>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="More"
                    className="text-muted-foreground"
                    size="icon"
                    variant="ghost"
                  />
                }
              />
            }
          >
            <Ellipsis />
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuCheckboxItem
            checked={everyStep}
            onCheckedChange={(on) =>
              usePreferences.getState().set("everyStep", on)
            }
          >
            Show every step
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => deleteThread(thread.id)}
            variant="destructive"
          >
            Delete chat…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

/**
 * In the transcript's place while nothing is held of it: it is being read, or its read failed,
 * which is said there with the way to read it again (ADR 0080).
 */
const Unread = ({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) => (
  <div className="min-h-0 flex-1">
    {failed ? (
      <PanelFailed onRetry={onRetry} title="The chat didn’t load" />
    ) : (
      <PanelLoading />
    )}
  </div>
);

/** Every step the agent reported, its tool calls folded between its messages ("Show every step"). */
const EveryStep = ({
  items,
  run,
  thread,
}: {
  items: readonly ThreadItem[];
  run: RunContext;
  thread: Thread;
}) => {
  const entries = useMemo(() => groupWork(items), [items]);
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
  const { busy } = threadView(thread);
  const last = items.at(-1);
  const reviewing = thread.status === "reviewing";
  return (
    <>
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
          label={reviewing ? "Reviewing…" : "Working…"}
          since={
            reviewing
              ? items.findLast((i) => i.kind === "review")?.at
              : items.findLast((i) => i.kind === "user")?.at
          }
        />
      ) : null}
    </>
  );
};

/** Each prompt and what came of it, as a card (ADR 0095). */
const Turns = ({
  items,
  thread,
}: {
  items: readonly ThreadItem[];
  thread: Thread;
}) => {
  const turns = useMemo(() => splitTurns(items), [items]);
  const { busy } = threadView(thread);
  return turns.map((turn, i) => (
    <MessageScrollerItem key={turn.id} messageId={turn.id}>
      <TurnView
        last={i === turns.length - 1}
        running={busy}
        thread={thread}
        turn={turn}
      />
    </MessageScrollerItem>
  ));
};

const ThreadView = ({
  thread,
  items,
}: {
  thread: Thread;
  items: readonly ThreadItem[];
}) => {
  const run = useRunContext(thread, items);
  const { busy, failed } = threadView(thread);
  const everyStep = usePreferences((s) => s.everyStep);
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
                  {everyStep ? (
                    <EveryStep items={items} run={run} thread={thread} />
                  ) : (
                    <Turns items={items} thread={thread} />
                  )}
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
    </>
  );
};
