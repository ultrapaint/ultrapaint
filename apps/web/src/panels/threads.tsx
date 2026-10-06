import type { Page } from "@ultrapaint/contracts/pages";
import {
  type Answer,
  type ConfigOption,
  defaultChoice,
  isEffortOption,
  isModelOption,
  namedChoices,
  type PromptAttachment,
  type QueuedPrompt,
  type SlashCommand,
  type Thread,
  type ThreadItem,
  type ToolContent,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  AppWindow,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock,
  Ellipsis,
  Eye,
  FilePen,
  FolderPen,
  Hand,
  ListPlus,
  ListTodo,
  LocateFixed,
  type LucideIcon,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Sparkles,
  Square,
  SquareDashedMousePointer,
  X,
  Zap,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { bridgeFor } from "../canvas/bridge.ts";
import { frameIdOf } from "../canvas/prototype.tsx";
import { AgentIcon } from "../components/agent-icon.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { showScope } from "../lib/add-to-chat.ts";
import {
  type AnswerDraft,
  answeredWell,
  notANumber,
  openQuestionOf,
  type QuestionItem,
  type QuestionOf,
  takesTyping,
} from "../lib/answers.ts";
import { shortcutLabel } from "../lib/keys.ts";
import {
  type DiffRow,
  diffCounts,
  diffHunks,
  lineDiff,
} from "../lib/line-diff.ts";
import { takeDraft, useDrafts } from "../lib/start-thread.ts";
import { toggleFollowing } from "../lib/thread-actions.ts";
import {
  formatDuration,
  groupWork,
  hasOpenCall,
  stopNote,
  type ThreadEntry,
  workSummary,
} from "../lib/thread-work.ts";
import { terminalKey, useAgents } from "../state/agents.ts";
import {
  declineQuestions,
  draftOf,
  pick,
  sendAnswers,
  setOther,
  setStep,
  useAnswers,
} from "../state/answers.ts";
import {
  addChip,
  type Chip,
  chipKey,
  chipOfAttachment,
  clearChips,
  nodeChip,
  pageChip,
  removeChip,
  useChips,
} from "../state/attachments.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import {
  showSetup,
  useDesignSystemSetup,
} from "../state/design-system-setup.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor, type Workspace } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { isSendKey, type SendKey, useSendKey } from "../state/send-key.ts";
import { useSync } from "../state/sync.ts";
import { ScopePicture, ThreadList } from "./chat-list.tsx";
import { ChatStarters } from "./chat-starters.tsx";
import { SetupStepBar, SetupStepIntro } from "./design-system-setup.tsx";
import { WorkingIndicator, WorkingMark } from "./thread-work.tsx";

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
    useAgents.getState().bind();
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

/** Back to the list, the thread's name, who works on it and where it may write. */
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
          <SandboxBadge thread={thread} />
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
  const running = thread.status === "running";
  const last = items.at(-1);
  const since = items.findLast((i) => i.kind === "user")?.at;
  const fresh = items.length === 0 && thread.status === "idle";
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
                      running={running}
                      threadId={thread.id}
                    />
                  </MessageScrollerItem>
                ))}
                {/* Also while the agent is still starting: that is part of the turn. */}
                {(running || thread.status === "starting") && (
                  <WorkingIndicator
                    since={since}
                    starting={thread.status === "starting"}
                  />
                )}
                {thread.status === "error" && (
                  <Alert variant="destructive">
                    <CircleAlert />
                    <AlertTitle>The agent stopped</AlertTitle>
                    <AlertDescription className="whitespace-pre-wrap">
                      {thread.error}
                    </AlertDescription>
                  </Alert>
                )}
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

const keyOfEntry = (entry: ThreadEntry) =>
  entry.kind === "work" ? entry.id : entry.item.id;

const Entry = ({
  entry,
  last,
  running,
  threadId,
}: {
  entry: ThreadEntry;
  /** The last item of the thread, the one the agent is appending to while it runs. */
  last: ThreadItem | undefined;
  running: boolean;
  threadId: string;
}) => {
  switch (entry.kind) {
    case "work":
      return (
        <WorkGroup
          items={entry.items}
          running={running}
          streamingId={running ? last?.id : undefined}
          threadId={threadId}
        />
      );
    case "turn":
      return <TurnEnd item={entry.item} since={entry.since} />;
    default:
      return (
        <Item
          item={entry.item}
          streaming={running && entry.item === last}
          threadId={threadId}
        />
      );
  }
};

/**
 * A run of tool calls and thoughts, folded into one line that counts what they were. It lights up
 * while the agent is still in it; opening it shows each call as before.
 */
const WorkGroup = ({
  items,
  running,
  streamingId,
  threadId,
}: {
  items: readonly ThreadItem[];
  running: boolean;
  /** The item the agent is still appending to, if it is in this run. */
  streamingId: string | undefined;
  threadId: string;
}) => {
  const active =
    running && (hasOpenCall(items) || items.some((i) => i.id === streamingId));
  const { failed, text } = workSummary(items, active);
  return (
    <Collapsible>
      <Disclosure className="w-full gap-1.5 border bg-muted/30">
        {active ? (
          <WorkingMark className="size-3.5" />
        ) : (
          <Zap className="text-muted-foreground" />
        )}
        <span className={cn("truncate", active && "text-shimmer")}>{text}</span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">· {failed} failed</span>
        )}
        <ChevronDown className="ml-auto transition-transform group-data-panel-open/button:rotate-180" />
      </Disclosure>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <div className="mt-1 ml-2 flex flex-col gap-1 border-l pl-2">
          {items.map((item) => (
            <Item
              item={item}
              key={item.id}
              streaming={item.id === streamingId}
              threadId={threadId}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const Disclosure = ({
  className,
  disabled,
  children,
}: {
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <CollapsibleTrigger
    disabled={disabled}
    render={
      <Button
        className={cn(
          "justify-start font-normal text-muted-foreground",
          className
        )}
        size="sm"
        variant="ghost"
      />
    }
  >
    {children}
  </CollapsibleTrigger>
);

const disclosureChevron =
  "transition-transform group-data-panel-open/button:rotate-90";

/** Keys plan entries by content, numbering repeats so keys stay unique. */
const keyedEntries = <T extends { content: string }>(entries: readonly T[]) => {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const n = seen.get(entry.content) ?? 0;
    seen.set(entry.content, n + 1);
    return { entry, key: `${entry.content}-${n}` };
  });
};

/** Opens the changes panel on the first of the files, where all of them are listed. */
const openChanges = (files: readonly string[]) => {
  useEditor.getState().setLeftTab("changes");
  const [first] = files;
  if (first) {
    window.dispatchEvent(
      new CustomEvent("ultrapaint:show-diff", { detail: first })
    );
  }
};

/**
 * The end of a turn, in a quiet line: how long it took and, when it changed files, a way to the
 * changes panel where they are listed. It speaks up only when the agent did not finish on its own.
 */
const TurnEnd = ({
  item,
  since,
}: {
  item: Extract<ThreadItem, { kind: "turn_end" }>;
  since: number | undefined;
}) => {
  const note = stopNote(item.stopReason);
  const count = item.changedFiles.length;
  return (
    <div className="flex items-center gap-1 font-body text-muted-foreground/70">
      {note ? (
        <span className="flex items-center gap-1 text-warning">
          <Square className="size-2.5 fill-current" />
          {note}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Check className="size-3" />
          Done
          {since === undefined ? "" : ` in ${formatDuration(item.at - since)}`}
        </span>
      )}
      {count > 0 && (
        <>
          <span>·</span>
          <Button
            className="h-auto p-0 font-body text-muted-foreground/70 hover:text-foreground"
            onClick={() => openChanges(item.changedFiles)}
            size="xs"
            variant="link"
          >
            {count} file{count === 1 ? "" : "s"} changed
          </Button>
        </>
      )}
    </div>
  );
};

const DIFF_SIGNS = { added: "+", removed: "-", same: " " } as const;

const keyOfContent = (content: ToolContent, index: number) =>
  content.type === "diff"
    ? `diff:${content.path}:${index}`
    : `${content.type}:${index}`;

/** A terminal the agent is running: its output arrives while the command is still going. */
const TerminalView = ({
  terminalId,
  threadId,
}: {
  terminalId: string;
  threadId: string;
}) => {
  const output = useAgents(
    (s) => s.terminals[terminalKey(threadId, terminalId)]
  );
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail as it grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [output]);
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-code text-muted-foreground">
      {output ?? "…"}
      <div ref={end} />
    </pre>
  );
};

/** Rows repeat in a diff (a closing brace, a blank line): the count makes each key its own. */
const withKeys = (rows: readonly DiffRow[]) => {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${row.kind}:${row.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...row, key: `${base}:${n}` };
  });
};

/** What an agent's edit changes, worked out from the file before and after. */
const DiffContentView = ({
  content,
}: {
  content: Extract<ToolContent, { type: "diff" }>;
}) => {
  const { added, removed, rows } = useMemo(() => {
    const all = lineDiff(content.oldText ?? "", content.newText);
    return { ...diffCounts(all), rows: withKeys(diffHunks(all)) };
  }, [content.oldText, content.newText]);
  return (
    <div>
      <div className="flex items-center gap-2 px-2 pt-1 font-code text-muted-foreground">
        <span className="truncate">{content.path}</span>
        <span className="ml-auto shrink-0 text-success">+{added}</span>
        <span className="shrink-0 text-destructive">-{removed}</span>
      </div>
      <pre className="max-h-48 select-text overflow-auto px-2 py-1 font-code leading-4">
        {rows.map((row) => (
          <div
            className={cn(
              row.kind === "added" && "bg-success/15 text-success",
              row.kind === "removed" && "bg-destructive/15 text-destructive",
              row.kind === "same" && "text-muted-foreground"
            )}
            key={row.key}
          >
            {`${DIFF_SIGNS[row.kind]}${row.text || " "}`}
          </div>
        ))}
      </pre>
    </div>
  );
};

const ToolContentView = ({
  content,
  threadId,
}: {
  content: ToolContent;
  threadId: string;
}) => {
  if (content.type === "diff") {
    return <DiffContentView content={content} />;
  }
  if (content.type === "terminal") {
    return <TerminalView terminalId={content.terminalId} threadId={threadId} />;
  }
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-code text-muted-foreground">
      {content.text}
    </pre>
  );
};

const Item = ({
  item,
  streaming,
  threadId,
}: {
  item: ThreadItem;
  /** The agent is still appending to this item, so its markdown may be cut mid-token. */
  streaming: boolean;
  threadId: string;
}) => {
  switch (item.kind) {
    case "user":
      return (
        <Message align="end">
          <MessageContent>
            <Bubble align="end" className="max-w-[90%]" variant="secondary">
              <BubbleContent className="select-text whitespace-pre-wrap">
                {item.text}
              </BubbleContent>
            </Bubble>
            {item.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {item.attachments.map((a) => (
                  <Badge key={a} variant="outline">
                    <Paperclip />
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </MessageContent>
        </Message>
      );
    case "agent":
      return (
        <Message>
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent className="select-text">
                <Markdown streaming={streaming}>{item.text}</Markdown>
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      );
    case "thought":
      return (
        <Collapsible>
          <Disclosure className="-ml-2">
            <ChevronRight className={disclosureChevron} />
            thinking
          </Disclosure>
          <CollapsibleContent className="mt-1 select-text border-l pl-2 text-muted-foreground">
            <Markdown className="font-body" streaming={streaming}>
              {item.text}
            </Markdown>
          </CollapsibleContent>
        </Collapsible>
      );
    case "tool": {
      const hasDetails = item.locations.length + item.content.length > 0;
      return (
        <Collapsible className="rounded-md border bg-muted/30">
          <Disclosure className="w-full gap-1.5" disabled={!hasDetails}>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.status === "completed" && "bg-success",
                item.status === "failed" && "bg-destructive",
                item.status === "in_progress" && "animate-pulse bg-brand",
                item.status === "pending" && "bg-muted-foreground"
              )}
            />
            <span className="truncate">{item.title}</span>
            {item.toolKind ? (
              <span className="ml-auto font-body text-muted-foreground/70">
                {item.toolKind}
              </span>
            ) : null}
          </Disclosure>
          <CollapsibleContent>
            <div className="border-t">
              {item.locations.length > 0 && (
                <div className="px-2 py-1 font-code text-muted-foreground">
                  {item.locations.map((l) => (
                    <div key={`${l.path}:${l.line ?? ""}`}>
                      {l.line === undefined ? l.path : `${l.path}:${l.line}`}
                    </div>
                  ))}
                </div>
              )}
              {item.content.map((c, index) => (
                <ToolContentView
                  content={c}
                  key={keyOfContent(c, index)}
                  threadId={threadId}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    }
    case "plan":
      return (
        <div className="rounded-md border px-2 py-1.5">
          <Marker className="mb-1 font-heading-xsmall uppercase">
            <MarkerIcon>
              <ListTodo />
            </MarkerIcon>
            <MarkerContent>Plan</MarkerContent>
          </Marker>
          {keyedEntries(item.entries).map(({ entry, key }) => (
            <div
              className={cn(
                "flex items-start gap-1.5",
                entry.status === "completed" &&
                  "text-muted-foreground line-through"
              )}
              key={key}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      );
    case "permission":
      return <Permission item={item} threadId={threadId} />;
    case "question":
      return <QuestionCard item={item} threadId={threadId} />;
    case "status":
      return (
        <Marker>
          <MarkerContent>{item.text}</MarkerContent>
        </Marker>
      );
    // The end of a turn is laid out by the thread, which knows when the turn began.
    case "turn_end":
      return null;
    default:
      return null;
  }
};

type PermissionItem = Extract<ThreadItem, { kind: "permission" }>;

/**
 * A card that waits on the user, as a question or a permission: neutral like every other card of
 * the thread, with the brand colour kept for its icon while it waits and for what is picked.
 */
const AskCard = ({
  children,
  icon: Icon,
  open,
  title,
}: {
  children: ReactNode;
  icon: LucideIcon;
  open: boolean;
  title: string;
}) => (
  <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 font-body">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", open && "text-brand")} />
      {title}
    </span>
    {children}
  </div>
);

const PermissionOption = ({
  option,
  remember,
  requestId,
  threadId,
}: {
  option: PermissionItem["options"][number];
  remember: boolean;
  requestId: string;
  threadId: string;
}) => {
  const onClick = () =>
    api()
      .request("threads.permission", {
        optionId: option.optionId,
        remember,
        requestId,
        threadId,
      })
      .catch(reportError);
  return (
    <Button
      onClick={onClick}
      size="sm"
      variant={option.kind.startsWith("allow") ? "default" : "outline"}
    >
      {option.name}
    </Button>
  );
};

const Permission = ({
  item,
  threadId,
}: {
  item: PermissionItem;
  threadId: string;
}) => {
  const [remember, setRemember] = useState(false);
  const onRememberChange = (c: boolean) => setRemember(c === true);
  const open = !item.decision;
  return (
    <AskCard
      icon={open ? ShieldQuestion : Check}
      open={open}
      title={open ? "Permission requested" : "Permission"}
    >
      <span
        className={cn(
          open ? "font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        {item.title}
      </span>
      {item.detail ? (
        <pre className="max-h-24 select-text overflow-auto whitespace-pre-wrap rounded-md border bg-background px-2.5 py-1.5 font-code text-muted-foreground">
          {item.detail}
        </pre>
      ) : null}
      {open ? (
        <>
          <Label className="font-normal text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={onRememberChange} />
            Remember for this thread
          </Label>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {item.options.map((o) => (
              <PermissionOption
                key={o.optionId}
                option={o}
                remember={remember}
                requestId={item.requestId}
                threadId={threadId}
              />
            ))}
          </div>
        </>
      ) : (
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Check className="size-3.5 shrink-0" />
          {item.options.find((o) => o.optionId === item.decision)?.name ??
            item.decision}
        </span>
      )}
    </AskCard>
  );
};

/** What an answer reads as once given: each option's label, or the text typed. */
const answerLabel = (question: QuestionOf, answer: Answer | undefined) => {
  const label = (one: string) =>
    question.options.find((o) => o.id === one)?.label ?? one;
  if (answer === undefined || answer.length === 0) {
    return "—";
  }
  return typeof answer === "string"
    ? label(answer)
    : answer.map(label).join(", ");
};

/** The options a question offers past this many have no key of their own. */
const KEYED_OPTIONS = 9;

/**
 * The choices of a question as full-width rows, each with its description under it and, on the
 * right, the key that picks it or the check that says it is picked. An answer typed in the
 * composer stands instead of them, so while there is one none shows as picked.
 */
const QuestionChoices = ({
  draft,
  itemId,
  question,
}: {
  draft: AnswerDraft;
  itemId: string;
  question: QuestionOf;
}) => {
  const typed =
    takesTyping(question) && Boolean(draft.other[question.id]?.trim());
  const chosen = typed ? [] : [draft.picked[question.id] ?? []].flat();
  return (
    <div className="flex flex-col gap-0.5">
      {question.options.map((o, i) => {
        const on = chosen.includes(o.id);
        return (
          <button
            aria-pressed={on}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border border-transparent px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:border-ring",
              on && "bg-accent hover:bg-accent"
            )}
            key={o.id}
            onClick={() => pick(itemId, question, o.id)}
            type="button"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-foreground">{o.label}</span>
              {o.description ? (
                <span className="text-muted-foreground">{o.description}</span>
              ) : null}
            </span>
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground tabular-nums">
              {on ? <Check className="size-3.5 text-brand" /> : null}
              {!on && i < KEYED_OPTIONS ? i + 1 : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** What the card says it is, from asked to answered. */
const cardTitle = (item: QuestionItem) => {
  if (item.answers !== null) {
    return "Answered";
  }
  if (item.outcome === "declined") {
    return "Declined";
  }
  if (item.outcome === "cancelled") {
    return "No longer asked";
  }
  return item.elicitation?.message ?? "The agent asks";
};

/** What is said under a question: its own description, or how it is answered. */
const questionHint = (question: QuestionOf) => {
  if (question.description) {
    return question.description;
  }
  if (question.options.length === 0) {
    return "Type the answer in the box below.";
  }
  return question.multiple ? "Pick one or more." : undefined;
};

/** Whether the thread's agent is at work, so answers that go as a prompt have to wait. */
const useRunning = (threadId: string) =>
  useAgents((s) => {
    const status = s.threads.find((t) => t.id === threadId)?.status;
    return status === "running" || status === "cancelling";
  });

/**
 * Questions put to the user, one at a time: the card shows the question and its choices, and the
 * composer below takes an answer of one's own and steps to the next question, then sends them.
 * When the agent waits for the answers within its turn they are answered (or declined) at once;
 * otherwise they are sent as the next prompt, so they wait until the agent's turn has ended.
 */
const QuestionCard = ({
  item,
  threadId,
}: {
  item: QuestionItem;
  threadId: string;
}) => {
  const running = useRunning(threadId);
  const draft = useAnswers((s) => draftOf(s.drafts, item.id));
  const [collapsed, setCollapsed] = useState(false);
  const open = item.answers === null && item.outcome === undefined;
  if (!open) {
    const answered = item.answers;
    return (
      <AskCard
        icon={answered ? Check : CircleHelp}
        open={false}
        title={cardTitle(item)}
      >
        {item.questions.map((q) => (
          <div className="flex flex-col gap-1" key={q.id}>
            <span className="text-muted-foreground">{q.question}</span>
            <span className="flex items-center gap-2 font-medium text-foreground">
              {answered ? <Check className="size-3.5 shrink-0" /> : null}
              {answerLabel(q, answered?.[q.id])}
            </span>
          </div>
        ))}
      </AskCard>
    );
  }
  const question = item.questions[draft.step] ?? item.questions[0];
  if (!question) {
    return null;
  }
  const count = item.questions.length;
  const waiting = item.elicitation !== undefined;
  const hint = questionHint(question);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 font-body">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">{cardTitle(item)}</span>
        {waiting ? (
          <Button
            disabled={draft.busy}
            onClick={() => declineQuestions(item, threadId)}
            size="xs"
            variant="ghost"
          >
            Decline
          </Button>
        ) : null}
        {count > 1 ? (
          <span className="tabular-nums">
            {draft.step + 1}/{count}
          </span>
        ) : null}
        <Button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the choices" : "Hide the choices"}
          className="text-muted-foreground"
          onClick={() => setCollapsed((c) => !c)}
          size="icon-xs"
          variant="ghost"
        >
          <ChevronDown
            className={cn("transition-transform", collapsed && "-rotate-90")}
          />
        </Button>
      </div>
      <div className="flex flex-col">
        <span className="font-medium text-foreground">
          {question.question}
          {question.optional ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              (optional)
            </span>
          ) : null}
        </span>
        {hint && !collapsed ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {collapsed ? null : (
        <QuestionChoices draft={draft} itemId={item.id} question={question} />
      )}
      {running && !waiting ? (
        <span className="text-muted-foreground">
          The answers can be sent once the agent has finished its turn.
        </span>
      ) : null}
    </div>
  );
};

/**
 * What a prompt carries, from the composer's chips: each node with the file it lives in, each page,
 * and a screenshot when one was asked for.
 */
const collectAttachments = async (
  chips: readonly Chip[],
  shotOf: { frameId: string; name: string } | null
) => {
  const attachments: PromptAttachment[] = [];
  const files = new Set<string>();
  const addFile = (path: string) => {
    if (!files.has(path)) {
      files.add(path);
      attachments.push({ kind: "file", path });
    }
  };
  for (const chip of chips) {
    if (chip.kind === "page") {
      addFile(chip.file);
    } else if (chip.kind === "node") {
      addFile(chip.file);
      attachments.push({
        file: chip.file,
        kind: "selection",
        name: chip.name,
        nodeId: chip.nodeId,
        ...(chip.component ? { component: true } : {}),
      });
    }
  }
  if (shotOf) {
    const dataUrl = await bridgeFor(shotOf.frameId).screenshot();
    if (dataUrl) {
      attachments.push({
        dataUrl,
        kind: "image",
        name: `${shotOf.name} screenshot`,
      });
    }
  }
  return attachments;
};

const ON_OFF = [
  ["on", "off"],
  ["true", "false"],
  ["enabled", "disabled"],
  ["yes", "no"],
];

/** The "on" value of an option that is really a switch (two values like on/off), else null. */
const switchOnValue = (option: ConfigOption): string | null => {
  if (option.options.length !== 2) {
    return null;
  }
  for (const [on, off] of ON_OFF) {
    const on_ = option.options.find(
      (o) => o.value.toLowerCase() === on || o.name.toLowerCase() === on
    );
    const off_ = option.options.find(
      (o) => o.value.toLowerCase() === off || o.name.toLowerCase() === off
    );
    if (on_ && off_) {
      return on_.value;
    }
  }
  return null;
};

const setConfigOption = (threadId: string, optionId: string, value: string) =>
  api()
    .request("threads.setConfigOption", { optionId, threadId, value })
    .catch(reportError);

const currentName = (option: ConfigOption | undefined) =>
  option?.options.find((o) => o.value === option.currentValue)?.name;

const SwitchOptionItem = ({
  option,
  onValue,
  threadId,
}: {
  option: ConfigOption;
  onValue: string;
  threadId: string;
}) => {
  const checked = option.currentValue === onValue;
  const offValue =
    option.options.find((o) => o.value !== onValue)?.value ?? onValue;
  const onCheckedChange = (next: boolean) =>
    setConfigOption(threadId, option.id, next ? onValue : offValue);
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      className="pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
      onCheckedChange={onCheckedChange}
    >
      {option.name}
      <span
        aria-hidden
        className={cn(
          "ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-brand" : "bg-input"
        )}
      >
        <span
          className={cn(
            "size-3 rounded-full bg-white transition-transform",
            checked && "translate-x-3"
          )}
        />
      </span>
    </DropdownMenuCheckboxItem>
  );
};

/**
 * A choice among an option's values, in a submenu. The agent's unnamed default is not offered:
 * the value it stands for carries a badge instead.
 */
const SelectOptionSub = ({
  option,
  threadId,
}: {
  option: ConfigOption;
  threadId: string;
}) => {
  const onValueChange = (value: unknown) =>
    setConfigOption(threadId, option.id, value as string);
  const fallback = defaultChoice(option);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="shrink-0">{option.name}</span>
        <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
          {currentName(option)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn("max-h-80 min-w-48", roomyItems)}>
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={option.currentValue}
        >
          {namedChoices(option).map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="flex min-w-0 flex-col">
                <span>{o.name}</span>
                {o.description ? (
                  <span className="max-w-64 whitespace-normal font-body text-muted-foreground">
                    {o.description}
                  </span>
                ) : null}
              </span>
              {o.value === fallback ? (
                <Badge className="ml-auto" variant="secondary">
                  Default
                </Badge>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/** The agent a thread's next prompt goes to, with its mark by each one. */
const AgentSub = ({ thread }: { thread: Thread }) => {
  const agents = useAgents((s) => s.agents);
  const agent = agents.find((a) => a.id === thread.agentId);
  const busy = thread.status === "running" || thread.status === "cancelling";
  const onAgentChange = (agentId: unknown) => {
    if (agentId !== thread.agentId) {
      api()
        .request("threads.setAgent", {
          agentId: agentId as string,
          threadId: thread.id,
        })
        .catch(reportError);
    }
  };
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="shrink-0">Provider</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3" />
          <span className="truncate">{agent?.name ?? thread.agentId}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn("min-w-48", roomyItems)}>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            onValueChange={onAgentChange}
            value={thread.agentId}
          >
            {agents.map((a) => (
              <DropdownMenuRadioItem
                closeOnClick
                disabled={busy}
                key={a.id}
                value={a.id}
              >
                <AgentIcon agentId={a.id} />
                {a.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/**
 * Agent, model and session options in one menu below the prompt: the provider first, then the
 * model, the effort and the agent's other choices; its switches below a divider. Before the
 * thread's session exists the options are the ones the agent offered last time, applied when it
 * starts.
 */
const ModelPicker = ({ thread }: { thread: Thread }) => {
  const agents = useAgents((s) => s.agents);
  const agent = agents.find((a) => a.id === thread.agentId);
  // Session modes have their own picker next to this one.
  const hasModePicker = (thread.modes?.length ?? 0) > 0;
  // The agent's unnamed default is never shown: the thread starts on the first model it names.
  const options = withNamedChoices(thread.configOptions ?? []).filter(
    (o) => !(hasModePicker && o.category === "mode")
  );
  const model = options.find(isModelOption);
  const effort = options.find(isEffortOption);
  const switches = options.flatMap((o) => {
    const onValue = switchOnValue(o);
    return onValue ? [{ onValue, option: o }] : [];
  });
  const selects = options.filter(
    (o) => !(switchOnValue(o) || isModelOption(o) || o === effort)
  );
  const effortName =
    effort && !switchOnValue(effort) ? currentName(effort) : null;
  const agentName = agent?.name ?? thread.agentId;
  const modelName = model ? currentName(model) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(pickerTrigger, "min-w-0")}
            size="sm"
            title={
              modelName ? `${agentName} · ${modelName}` : `Agent: ${agentName}`
            }
            variant="ghost"
          />
        }
      >
        <AgentIcon agentId={thread.agentId} className="size-3.5" />
        <span className="truncate">{modelName ?? agentName}</span>
        {effortName ? (
          <span className="@max-sm:hidden shrink-0 text-muted-foreground">
            {effortName}
          </span>
        ) : null}
        <ChevronDown
          className="shrink-0 text-muted-foreground"
          data-icon="inline-end"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("w-64", roomyItems)}
        side="top"
      >
        <DropdownMenuGroup>
          <AgentSub thread={thread} />
          {model ? (
            <SelectOptionSub option={model} threadId={thread.id} />
          ) : null}
          {effort && !switchOnValue(effort) ? (
            <SelectOptionSub option={effort} threadId={thread.id} />
          ) : null}
          {selects.map((o) => (
            <SelectOptionSub key={o.id} option={o} threadId={thread.id} />
          ))}
        </DropdownMenuGroup>
        {switches.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {switches.map(({ option, onValue }) => (
                <SwitchOptionItem
                  key={option.id}
                  onValue={onValue}
                  option={option}
                  threadId={thread.id}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Whether the agent is confined to the repository. The scope is the operating system's, so it
 * says which repository, and says so plainly where the platform has no sandbox to offer.
 */
const SandboxBadge = ({ thread }: { thread: Thread }) => {
  const repoPath = useProject((s) => s.info.repoPath);
  if (thread.sandboxed === undefined) {
    return null;
  }
  const repo = repoPath?.split("/").filter(Boolean).at(-1);
  return thread.sandboxed ? (
    <span
      className="flex items-center gap-1 self-start px-1 font-body text-muted-foreground [&_svg]:size-3"
      title={`The agent reads and writes in ${repoPath ?? "the repository"}, its own files, caches and temporary files. The rest of your home directory is closed to it.`}
    >
      <ShieldCheck />
      {repo ?? "repository"}
    </span>
  ) : (
    <span
      className="flex items-center gap-1 self-start px-1 font-body text-warning [&_svg]:size-3"
      title={
        thread.sandboxProblem
          ? `The sandbox on this machine did not start (${thread.sandboxProblem}), so the agent reaches everything you can.`
          : "This machine has no sandbox for agents, so the agent reaches everything you can. Agents are confined on macOS, and on Linux once bubblewrap is installed."
      }
    >
      <ShieldAlert />
      Not scoped
    </span>
  );
};

/** The composer's menus have roomier rows than the editor's. */
const roomyItems =
  "[&_[role^=menuitem]]:min-h-8 [&_[role^=menuitem]]:font-body";

/** The composer's pickers: plain at rest, on the secondary surface while hovered or open. */
const pickerTrigger =
  "shrink gap-1 px-1.5 font-normal hover:bg-secondary aria-expanded:bg-secondary dark:hover:bg-secondary";

/** What each agent's modes let it do, drawn small enough to stand for the mode alone. */
const MODE_ICONS: Record<string, LucideIcon> = {
  acceptEdits: FilePen,
  agent: Sparkles,
  "agent-full-access": ShieldOff,
  auto: Sparkles,
  bypassPermissions: ShieldOff,
  default: Hand,
  plan: NotebookPen,
  "read-only": Eye,
  "workspace-write": FolderPen,
};

const ModeIcon = ({ modeId }: { modeId: string | undefined }) => {
  const Icon = (modeId && MODE_ICONS[modeId]) || Shield;
  return <Icon className="size-3.5" />;
};

const ModePicker = ({ thread }: { thread: Thread }) => {
  const modes = thread.modes ?? [];
  if (modes.length === 0) {
    return null;
  }
  const current = modes.find((m) => m.id === thread.currentModeId);
  const onValueChange = (modeId: unknown) =>
    api()
      .request("threads.setMode", {
        modeId: modeId as string,
        threadId: thread.id,
      })
      .catch(reportError);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(pickerTrigger, "min-w-7 shrink-0")}
            size="sm"
            title={current ? `Mode: ${current.name}` : "Mode"}
            variant="ghost"
          />
        }
      >
        <ModeIcon modeId={current?.id} />
        <span className="@max-sm:hidden truncate">
          {current?.name ?? "Mode"}
        </span>
        <ChevronDown
          className="@max-sm:hidden shrink-0 text-muted-foreground"
          data-icon="inline-end"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("w-60", roomyItems)}
        side="top"
      >
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={thread.currentModeId ?? null}
        >
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <ModeIcon modeId={m.id} />
              <span className="flex min-w-0 flex-col">
                <span>{m.name}</span>
                {m.description ? (
                  <span className="whitespace-normal font-body text-muted-foreground">
                    {m.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** In the prototype the whole canvas is one iframe; on the canvas every page has its own. */
const shotFrameOf = (
  workspace: Workspace,
  canvas: string | null,
  page: Page | undefined
) =>
  workspace === "prototype" && canvas !== null
    ? frameIdOf(canvas)
    : (page?.id ?? "");

const COMMAND_QUERY_RE = /^\/([a-z-]*)$/;

let commandsCache: readonly SlashCommand[] | null = null;

/** The commands a prompt may start with, asked of the server once. */
const useCommands = () => {
  const [commands, setCommands] = useState(commandsCache ?? []);
  useEffect(() => {
    if (commandsCache) {
      return;
    }
    api()
      .request("commands.list", undefined)
      .then((list) => {
        commandsCache = list;
        setCommands(list);
      })
      .catch(() => undefined);
  }, []);
  return commands;
};

const Composer = ({ thread }: { thread: Thread }) => {
  const [text, setText] = useState(() => takeDraft(thread.id));
  const sendKey = useSendKey((s) => s.sendKey);
  // A draft that arrives after the composer is on screen, from a thread started elsewhere.
  useEffect(() => {
    const take = () => {
      const draft = takeDraft(thread.id);
      if (draft) {
        setText(draft);
      }
    };
    take();
    return useDrafts.subscribe((s) => {
      if (s.drafts[thread.id]) {
        take();
      }
    });
  }, [thread.id]);
  const chips = useChips(thread.id);
  /** Implicit context the user took out of this prompt, by chip key. */
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [attachShot, setAttachShot] = useState(false);
  const [busy, setBusy] = useState(false);
  const selection = useEditor((s) => s.selection);
  const activePage = useEditor((s) => s.activePage);
  const pages = useProject((s) => s.pages);
  const page = pages.find((p) => p.id === (selection?.frame ?? activePage));
  const selectedNode = useDocuments((s) =>
    selection
      ? nodeIn(
          s.docs,
          useEditor.getState().canvas,
          selection.frame,
          selection.nodeId
        )
      : null
  );
  // Nothing attached: the selection goes along, shown dashed. The page only when attached.
  const selectedChip =
    selection && selectedNode ? nodeChip(selection, selectedNode) : null;
  const implicit =
    chips.length > 0 ||
    selectedChip === null ||
    dismissed.includes(chipKey(selectedChip))
      ? []
      : [selectedChip];
  const commands = useCommands();
  const [commandIndex, setCommandIndex] = useState(0);
  const workspace = useEditor((s) => s.workspace);
  const canvas = useEditor((s) => s.canvas);
  const shotFrame = shotFrameOf(workspace, canvas, page);
  const running = thread.status === "running" || thread.status === "cancelling";
  const answering = useAnswering(thread.id);

  // While the agent works, what is sent waits in the thread's queue.
  const send = async () => {
    if (!text.trim()) {
      return;
    }
    // `/sync` alone is the editor's: it opens the Sync view rather than starting a turn.
    if (text.trim() === "/sync") {
      setText("");
      showSetup();
      useSync.getState().load();
      return;
    }
    setBusy(true);
    try {
      const attachments = await collectAttachments(
        chips.length > 0 ? chips : implicit,
        attachShot && page ? { frameId: shotFrame, name: page.name } : null
      );
      await api().request("threads.prompt", {
        attachments,
        text,
        threadId: thread.id,
      });
      setText("");
      clearChips(thread.id);
      setDismissed([]);
    } catch (error) {
      reportError(error);
    }
    setBusy(false);
  };

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCommandIndex(0);
  };
  // A `/` at the start offers the commands the server expands, until the name is typed.
  const commandMatch: RegExpExecArray | null = COMMAND_QUERY_RE.exec(text);
  const commandQuery = commandMatch?.[1];
  const offered =
    commandQuery === undefined
      ? []
      : commands.filter((c) => c.name.startsWith(commandQuery.toLowerCase()));
  const complete = (name: string) => setText(`/${name} `);
  /** The command menu's keys: arrows move through it, Tab or Enter picks. Whether it took one. */
  const onMenuKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCommandIndex((i) => (i + step + offered.length) % offered.length);
      return true;
    }
    if ((e.key === "Tab" || e.key === "Enter") && !(e.metaKey || e.ctrlKey)) {
      complete((offered[commandIndex] ?? offered[0])?.name ?? "");
      return true;
    }
    return false;
  };
  const onTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (answering) {
      onAnswerKey(e, answering, thread.id, sendKey, running);
      return;
    }
    if (offered.length > 0 && onMenuKey(e)) {
      e.preventDefault();
      return;
    }
    if (isSendKey(e, sendKey)) {
      e.preventDefault();
      send();
    }
  };
  const cancel = () =>
    api().request("threads.cancel", { threadId: thread.id }).catch(reportError);

  const agentName =
    useAgents((s) => s.agents.find((a) => a.id === thread.agentId)?.name) ??
    "the agent";

  const showShot = Boolean(page && attachShot);
  const attachSelection = () => {
    if (selectedChip) {
      addChip(thread.id, selectedChip);
    }
  };
  const attachPage = () => {
    if (page) {
      addChip(thread.id, pageChip(page));
    }
  };

  return (
    <div className="flex flex-col gap-1.5 p-2">
      <QueuedPrompts
        onEdit={(queued) => setText(queued.text)}
        running={running}
        thread={thread}
      />
      <div className="flex flex-col rounded-xl border bg-input/20 transition-colors focus-within:border-ring dark:bg-input/30">
        {chips.length > 0 || implicit.length > 0 || showShot ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {chips.map((chip) => (
              <AttachmentChip
                chip={chip}
                key={chipKey(chip)}
                onRemove={() => removeChip(thread.id, chipKey(chip))}
              />
            ))}
            {implicit.map((chip) => (
              <AttachmentChip
                chip={chip}
                implicit
                key={chipKey(chip)}
                onRemove={() => setDismissed((d) => [...d, chipKey(chip)])}
              />
            ))}
            {showShot && page ? (
              <ContextChip
                icon={<Camera />}
                label="Screenshot"
                onRemove={() => setAttachShot(false)}
                title={`Screenshot of ${page.name}`}
              />
            ) : null}
          </div>
        ) : null}
        {offered.length > 0 && !answering ? (
          <div
            className="mx-2 mt-2 flex flex-col overflow-hidden rounded-md border bg-popover"
            role="listbox"
          >
            {offered.map((command, i) => (
              <button
                aria-selected={i === commandIndex}
                className={cn(
                  "flex flex-col items-start gap-0.5 px-2 py-1.5 text-left font-body hover:bg-muted",
                  i === commandIndex && "bg-muted"
                )}
                key={command.name}
                onClick={() => complete(command.name)}
                onMouseDown={(e) => e.preventDefault()}
                role="option"
                type="button"
              >
                <span className="font-medium font-mono">
                  /{command.name}
                  {command.argument ? (
                    <span className="ml-1 text-muted-foreground">
                      {command.argument}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {command.description}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {answering ? (
          <AnswerField answering={answering} onKeyDown={onTextKeyDown} />
        ) : (
          <textarea
            className="field-sizing-content max-h-60 min-h-24 w-full resize-none bg-transparent px-3 py-2 font-body outline-none placeholder:text-muted-foreground"
            onChange={onTextChange}
            onKeyDown={onTextKeyDown}
            placeholder={placeholderOf(running, agentName)}
            value={text}
          />
        )}
        <div className="@container flex min-w-0 items-center gap-1 px-1.5 pb-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Add context"
                  className="text-muted-foreground"
                  size="icon-sm"
                  title="Add context"
                  variant="ghost"
                />
              }
            >
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className={cn("w-60", roomyItems)}
              side="top"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  Send along with the prompt
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!selectedChip}
                  onClick={attachSelection}
                >
                  <SquareDashedMousePointer />
                  {selectedNode
                    ? `Attach ${nodeLabel(selectedNode)}`
                    : "Attach the selection"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!page} onClick={attachPage}>
                  <AppWindow />
                  {page ? `Attach the page ${page.name}` : "Attach the page"}
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={attachShot}
                  disabled={!page}
                  onCheckedChange={setAttachShot}
                >
                  <Camera />
                  Screenshot of the page
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModePicker thread={thread} />
          <ModelPicker thread={thread} />
          <div className="flex-1" />
          {answering ? (
            <AnswerButtons
              answering={answering}
              onStop={cancel}
              running={running}
              threadId={thread.id}
            />
          ) : (
            <SendButtons
              canSend={!busy && Boolean(text.trim())}
              onSend={send}
              onStop={cancel}
              running={running}
            />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * What was sent while the agent worked, waiting for its turn to end, oldest first. Each goes when
 * a turn ends by itself; after one that was stopped or failed they wait for Send now. Edit puts
 * one back in the composer, with its attachments.
 */
const QueuedPrompts = ({
  onEdit,
  running,
  thread,
}: {
  onEdit: (queued: QueuedPrompt) => void;
  running: boolean;
  thread: Thread;
}) => {
  const queued = thread.queued ?? [];
  if (queued.length === 0) {
    return null;
  }
  const unqueue = (id: string) =>
    api().request("threads.unqueue", { id, threadId: thread.id });
  const edit = async (id: string) => {
    try {
      const taken = await unqueue(id);
      if (!taken) {
        return;
      }
      for (const attachment of taken.attachments) {
        const chip = chipOfAttachment(attachment);
        if (chip) {
          addChip(thread.id, chip);
        }
      }
      onEdit(taken);
    } catch (error) {
      reportError(error);
    }
  };
  const sendNow = () =>
    api()
      .request("threads.sendQueued", { threadId: thread.id })
      .catch(reportError);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed px-2 py-1.5">
      <div className="flex items-center gap-1.5 font-body text-muted-foreground">
        <Clock className="size-3" />
        <span className="flex-1">
          {running
            ? `${queued.length} waiting for the turn to end`
            : `${queued.length} waiting: the last turn did not finish`}
        </span>
        {running ? null : (
          <Button
            className="h-6 px-2"
            onClick={sendNow}
            size="sm"
            variant="secondary"
          >
            Send now
          </Button>
        )}
      </div>
      {queued.map((q) => (
        <div className="group flex items-start gap-1.5" key={q.id}>
          <span className="line-clamp-2 min-w-0 flex-1 font-body">
            {q.text}
            {q.attachments.length > 0 ? (
              <span className="ml-1 text-muted-foreground">
                · {q.attachments.length} attached
              </span>
            ) : null}
          </span>
          <IconButton
            className="size-6"
            onClick={() => edit(q.id)}
            tooltip="Edit"
          >
            <Pencil />
          </IconButton>
          <IconButton
            className="size-6"
            onClick={() => unqueue(q.id).catch(reportError)}
            tooltip="Remove"
          >
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
};

/** The open question card, what has been given to it, and the question on screen. */
interface Answering {
  asking: QuestionItem;
  draft: AnswerDraft;
  question: QuestionOf;
}

/** An agent's questions waiting for answers take the composer over, one question at a time. */
const useAnswering = (threadId: string): Answering | null => {
  const asking = useAgents((s) => openQuestionOf(s.items[threadId] ?? []));
  const draft = useAnswers((s) =>
    asking ? draftOf(s.drafts, asking.id) : null
  );
  const question = asking?.questions[draft?.step ?? 0] ?? asking?.questions[0];
  return asking && draft && question ? { asking, draft, question } : null;
};

/** The answers can go: all given, and nothing in the way of sending them. */
const canSendAnswers = ({ asking, draft }: Answering, running: boolean) =>
  !(
    draft.busy ||
    // Answers that go as a prompt wait for the agent's turn to end.
    (running && asking.elicitation === undefined)
  ) && asking.questions.every((q) => answeredWell(draft, q));

/** On to the next question, or, on the last one, the answers go. */
const advance = (answering: Answering, threadId: string, running: boolean) => {
  const { asking, draft, question } = answering;
  if (!answeredWell(draft, question)) {
    return;
  }
  if (draft.step < asking.questions.length - 1) {
    setStep(asking, draft.step + 1);
  } else if (canSendAnswers(answering, running)) {
    sendAnswers(asking, threadId);
  }
};

/**
 * The composer's keys while it answers: the send key steps on, and with nothing typed 1–9 pick
 * the question's options, as the card shows.
 */
const onAnswerKey = (
  e: KeyboardEvent<HTMLTextAreaElement>,
  answering: Answering,
  threadId: string,
  sendKey: SendKey,
  running: boolean
) => {
  const { asking, draft, question } = answering;
  if (isSendKey(e, sendKey)) {
    e.preventDefault();
    advance(answering, threadId, running);
    return;
  }
  const typed = draft.other[question.id] ?? "";
  const digit = Number(e.key);
  const option =
    Number.isInteger(digit) && digit >= 1
      ? question.options[digit - 1]
      : undefined;
  if (option && !typed && !(e.metaKey || e.ctrlKey || e.altKey)) {
    e.preventDefault();
    pick(asking.id, question, option.id);
  }
};

const answerPlaceholder = (question: QuestionOf) => {
  if (question.options.length === 0) {
    return "Type your answer…";
  }
  return question.allowOther
    ? "Type your own answer, or leave this blank to use the option picked"
    : "Pick an option above, or press its number";
};

/** The composer's box while it answers: an answer of one's own to the question on screen. */
const AnswerField = ({
  answering: { asking, draft, question },
  onKeyDown,
}: {
  answering: Answering;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) => {
  const typed = draft.other[question.id] ?? "";
  return (
    <textarea
      aria-invalid={notANumber(question, typed) || undefined}
      className="field-sizing-content max-h-60 min-h-24 w-full resize-none bg-transparent px-3 py-2 font-body outline-none placeholder:text-muted-foreground aria-invalid:text-destructive"
      inputMode={
        question.value === "number" || question.value === "integer"
          ? "decimal"
          : undefined
      }
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
        if (takesTyping(question)) {
          setOther(asking.id, question, e.target.value);
        }
      }}
      onKeyDown={onKeyDown}
      placeholder={answerPlaceholder(question)}
      readOnly={!takesTyping(question)}
      value={typed}
    />
  );
};

/** A click on a step button leaves the focus where it was, so typing goes on in the composer. */
const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/** Back a question, on to the next, and on the last one Send answers; Stop while the agent works. */
const AnswerButtons = ({
  answering,
  onStop,
  running,
  threadId,
}: {
  answering: Answering;
  onStop: () => void;
  running: boolean;
  threadId: string;
}) => {
  const { asking, draft, question } = answering;
  const last = draft.step >= asking.questions.length - 1;
  const ready = last
    ? canSendAnswers(answering, running)
    : answeredWell(draft, question);
  return (
    <>
      {running ? (
        <Button
          aria-label="Stop"
          onClick={onStop}
          size="icon-sm"
          title="Stop"
          variant="outline"
        >
          <Square />
        </Button>
      ) : null}
      {draft.step > 0 ? (
        <Button
          onClick={() => setStep(asking, draft.step - 1)}
          onMouseDown={keepFocus}
          size="sm"
          variant="outline"
        >
          Previous
        </Button>
      ) : null}
      <Button
        disabled={!ready}
        onClick={() => advance(answering, threadId, running)}
        onMouseDown={keepFocus}
        size="sm"
        title={shortcutLabel("⌘↩")}
      >
        {last ? "Send answers" : "Next question"}
      </Button>
    </>
  );
};

const placeholderOf = (running: boolean, agentName: string) =>
  running
    ? "Queue a follow-up…"
    : `Ask ${agentName} to change the design, or type / for commands…`;

/** Send, or queue while the agent works, next to Stop. */
const SendButtons = ({
  canSend,
  onSend,
  onStop,
  running,
}: {
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
}) => (
  <>
    {running ? (
      <Button onClick={onStop} size="sm" variant="outline">
        <Square data-icon="inline-start" /> Stop
      </Button>
    ) : null}
    <Button
      aria-label={running ? "Queue" : "Send"}
      className="rounded-full"
      disabled={!canSend}
      onClick={onSend}
      size="icon-sm"
      title={
        running
          ? `Queue for when the turn ends (${shortcutLabel("⌘↩")})`
          : `Send (${shortcutLabel("⌘↩")})`
      }
    >
      {running ? <ListPlus /> : <ArrowUp />}
    </Button>
  </>
);

const chipTitle = (chip: Chip) => {
  if (chip.kind === "node") {
    return `${chip.name} in ${chip.file}`;
  }
  return chip.kind === "page" ? `Page file: ${chip.file}` : chip.name;
};

/**
 * An attachment of the next prompt. A node takes its selection colour, purple for a component;
 * the context sent because nothing was attached is dashed, and removing it keeps it out of this
 * prompt.
 */
const AttachmentChip = ({
  chip,
  implicit = false,
  onRemove,
}: {
  chip: Chip;
  implicit?: boolean;
  onRemove: () => void;
}) => {
  const component = chip.kind === "node" && chip.component;
  const element = chip.kind === "node" && !chip.component;
  return (
    <span
      className={cn(
        "flex h-5.5 min-w-0 items-center gap-1 rounded-md border pr-0.5 pl-1.5 font-body leading-4 [&_svg]:size-3 [&_svg]:shrink-0",
        implicit && "border-dashed text-muted-foreground",
        !implicit && component && "border-component/60 bg-component/15",
        !implicit && element && "border-selection/60 bg-selection/10",
        !(implicit || component || element) && "bg-background/40"
      )}
      title={
        implicit
          ? "Sent with the prompt because nothing else is attached"
          : chipTitle(chip)
      }
    >
      {chip.kind === "page" ? (
        <AppWindow className="text-muted-foreground" />
      ) : (
        <SquareDashedMousePointer
          className={cn(
            component && "text-component",
            element && "text-selection"
          )}
        />
      )}
      <span className="max-w-32 truncate">{chip.name}</span>
      <button
        aria-label={`Remove ${chip.name}`}
        className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onRemove}
        type="button"
      >
        <X />
      </button>
    </span>
  );
};

/** Context sent with the prompt; removing it keeps it out until re-added from the + menu. */
const ContextChip = ({
  icon,
  label,
  title,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  onRemove: () => void;
}) => (
  <span
    className="flex h-5 min-w-0 items-center gap-1 rounded-md border bg-background/40 pr-0.5 pl-1.5 font-body leading-4 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    title={title}
  >
    {icon}
    <span className="max-w-32 truncate">{label}</span>
    <button
      aria-label={`Remove ${label}`}
      className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onRemove}
      type="button"
    >
      <X />
    </button>
  </span>
);
