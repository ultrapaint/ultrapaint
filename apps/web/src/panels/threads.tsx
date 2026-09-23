import type { Page } from "@ultrapaint/contracts/pages";
import type {
  PromptAttachment,
  Thread,
  ThreadItem,
  ToolContent,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  AppWindow,
  ArrowUp,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ListTodo,
  Paperclip,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Square,
  SquareDashedMousePointer,
  Trash2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
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
import { Spinner } from "@/components/ui/spinner";
import { bridgeFor } from "../canvas/bridge.ts";
import { frameIdOf } from "../canvas/prototype.tsx";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import {
  type DiffRow,
  diffCounts,
  diffHunks,
  lineDiff,
} from "../lib/line-diff.ts";
import { terminalKey, useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { type Selection, useEditor, type Workspace } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

const openThread = (threadId: string) => useAgents.getState().open(threadId);

/** Prompt text carried into a thread created from another thread's composer. */
const drafts = new Map<string, string>();
const takeDraft = (threadId: string) => {
  const draft = drafts.get(threadId) ?? "";
  drafts.delete(threadId);
  return draft;
};

const createThread = async (agentId: string, draft = "") => {
  try {
    const t = await api().request("threads.create", { agentId });
    if (draft) {
      drafts.set(t.id, draft);
    }
    await useAgents.getState().open(t.id);
  } catch (error) {
    reportError(error);
  }
};

export const Threads = () => {
  const configured = useProject((s) => s.info.configured);
  const { agents, threads, current, items } = useAgents();
  const thread = threads.find((t) => t.id === current) ?? null;

  useEffect(() => {
    if (!configured) {
      return;
    }
    useAgents.getState().bind();
    useAgents.getState().load();
  }, [configured]);

  if (!configured) {
    return <PanelEmpty>Configure a repository first</PanelEmpty>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <OptionSelect
            onChange={openThread}
            options={threads.map((t) => ({
              label: `${t.title} · ${agents.find((a) => a.id === t.agentId)?.name ?? t.agentId}`,
              value: t.id,
            }))}
            placeholder="No thread"
            value={current}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="New thread"
                size="icon"
                title="New thread"
                variant="ghost"
              />
            }
          >
            <Plus />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Start a thread with</DropdownMenuLabel>
              {agents.map((a) => (
                <AgentMenuItem agent={a} key={a.id} />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {thread ? <DeleteThreadButton thread={thread} /> : null}
      </div>
      {thread ? (
        <ThreadView items={items[thread.id] ?? []} thread={thread} />
      ) : (
        <PanelEmpty icon={<Bot />}>
          Create a thread to work with an agent. Threads run in parallel, each
          with its own agent.
        </PanelEmpty>
      )}
    </div>
  );
};

type Agent = ReturnType<typeof useAgents.getState>["agents"][number];

const AgentMenuItem = ({ agent }: { agent: Agent }) => {
  const onClick = () => createThread(agent.id);
  return (
    <DropdownMenuItem onClick={onClick}>
      <Bot />
      {agent.name}
      {agent.authHint ? (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {agent.builtIn ? "built-in" : "custom"}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
};

const DeleteThreadButton = ({ thread }: { thread: Thread }) => {
  const onClick = async () => {
    const ok = await confirmDialog({
      confirmLabel: "Delete",
      description: `“${thread.title}” and its history are removed.`,
      destructive: true,
      title: "Delete this thread?",
    });
    if (ok) {
      api()
        .request("threads.delete", { threadId: thread.id })
        .catch(reportError);
    }
  };
  return (
    <IconButton onClick={onClick} tooltip="Delete thread">
      <Trash2 />
    </IconButton>
  );
};

const ThreadView = ({
  thread,
  items,
}: {
  thread: Thread;
  items: readonly ThreadItem[];
}) => (
  <>
    {/* Keyed by thread so each one opens scrolled to its latest message. */}
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      key={`scroller:${thread.id}`}
    >
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-2 p-2">
            {items.map((item, index) => (
              <MessageScrollerItem key={item.id} messageId={item.id}>
                <Item
                  item={item}
                  streaming={
                    thread.status === "running" && index === items.length - 1
                  }
                  threadId={thread.id}
                />
              </MessageScrollerItem>
            ))}
            {(thread.status === "running" || thread.status === "starting") && (
              <Marker>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent>
                  {thread.status === "running" ? "working…" : "starting agent…"}
                </MarkerContent>
              </Marker>
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
    <Composer key={`composer:${thread.id}`} thread={thread} />
  </>
);

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

const ChangedFileButton = ({ file }: { file: string }) => {
  const onClick = () => {
    useEditor.getState().setLeftTab("changes");
    window.dispatchEvent(
      new CustomEvent("ultrapaint:show-diff", { detail: file })
    );
  };
  return (
    <Button
      className="max-w-full justify-start px-0 font-mono text-brand"
      onClick={onClick}
      size="xs"
      variant="link"
    >
      <span className="truncate">{file}</span>
    </Button>
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
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-mono text-[10px] text-muted-foreground">
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
      <div className="flex items-center gap-2 px-2 pt-1 font-mono text-[10px] text-muted-foreground">
        <span className="truncate">{content.path}</span>
        <span className="ml-auto shrink-0 text-success">+{added}</span>
        <span className="shrink-0 text-destructive">-{removed}</span>
      </div>
      <pre className="max-h-48 select-text overflow-auto px-2 py-1 font-mono text-[10px] leading-4">
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
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-mono text-[10px] text-muted-foreground">
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
            <Markdown className="text-[11px]/relaxed" streaming={streaming}>
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
              <span className="ml-auto text-[10px] text-muted-foreground/70">
                {item.toolKind}
              </span>
            ) : null}
          </Disclosure>
          <CollapsibleContent>
            <div className="border-t">
              {item.locations.length > 0 && (
                <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
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
          <Marker className="mb-1 text-[10px] uppercase">
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
    case "status":
      return (
        <Marker>
          <MarkerContent>{item.text}</MarkerContent>
        </Marker>
      );
    case "turn_end":
      return (
        <div className="flex flex-col items-start">
          <Marker variant="separator">
            <MarkerContent>
              Turn ended · {item.stopReason}
              {item.changedFiles.length > 0 &&
                ` · ${item.changedFiles.length} file${item.changedFiles.length === 1 ? "" : "s"} changed`}
            </MarkerContent>
          </Marker>
          {item.changedFiles.map((f) => (
            <ChangedFileButton file={f} key={f} />
          ))}
        </div>
      );
    default:
      return null;
  }
};

type PermissionItem = Extract<ThreadItem, { kind: "permission" }>;

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
  return (
    <Alert className={cn(!item.decision && "border-brand bg-brand/10")}>
      <ShieldQuestion />
      <AlertTitle>
        {item.decision ? "Permission" : "Permission requested"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>{item.title}</span>
        {item.detail ? (
          <pre className="max-h-24 select-text overflow-auto whitespace-pre-wrap font-mono text-[10px]">
            {item.detail}
          </pre>
        ) : null}
        {item.decision ? (
          <span className="flex items-center gap-1">
            <Check className="size-3" />
            {item.options.find((o) => o.optionId === item.decision)?.name ??
              item.decision}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
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
            <Label className="font-normal">
              <Checkbox checked={remember} onCheckedChange={onRememberChange} />
              remember for this thread
            </Label>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
};

/** Gathers the context the composer attaches to a prompt. */
const collectAttachments = async ({
  fileOf,
  selectionSource,
  selectionName,
  shotOf,
}: {
  fileOf: Page | null;
  selectionSource: Selection["source"];
  selectionName: string;
  /** The page and the iframe showing it: the prototype has one for the whole space. */
  shotOf: { frameId: string; name: string } | null;
}) => {
  const attachments: PromptAttachment[] = [];
  if (fileOf) {
    attachments.push({ kind: "file", path: fileOf.file });
  }
  if (selectionSource) {
    attachments.push({
      col: selectionSource.col,
      file: selectionSource.file,
      kind: "selection",
      line: selectionSource.line,
      name: selectionName,
    });
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

type ConfigOption = NonNullable<Thread["configOptions"]>[number];

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

const EFFORT_RE = /effort|thought|thinking|reasoning/i;

const isModelOption = (o: ConfigOption) =>
  o.category === "model" || o.id === "model";
const isEffortOption = (o: ConfigOption) =>
  o.category === "thought_level" || EFFORT_RE.test(o.id);

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

const SelectOptionSub = ({
  option,
  threadId,
}: {
  option: ConfigOption;
  threadId: string;
}) => {
  const onValueChange = (value: unknown) =>
    setConfigOption(threadId, option.id, value as string);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {option.name}
        <span className="ml-auto max-w-32 truncate text-muted-foreground">
          {currentName(option)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 min-w-48">
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={option.currentValue}
        >
          {option.options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="flex min-w-0 flex-col">
                <span>{o.name}</span>
                {o.description ? (
                  <span className="max-w-64 whitespace-normal text-[10px] text-muted-foreground leading-snug">
                    {o.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/**
 * Agent, model and session options in one menu below the prompt, Cursor-style: switches first,
 * then the other choices, the model last; the agent itself at the bottom.
 */
const ModelPicker = ({ thread, draft }: { thread: Thread; draft: string }) => {
  const agents = useAgents((s) => s.agents);
  const agent = agents.find((a) => a.id === thread.agentId);
  // Session modes have their own picker next to this one.
  const hasModePicker = (thread.modes?.length ?? 0) > 0;
  const options = (thread.configOptions ?? []).filter(
    (o) => !(hasModePicker && o.category === "mode")
  );
  const model = options.find(isModelOption);
  const effort = options.find(isEffortOption);
  const switches = options.flatMap((o) => {
    const onValue = switchOnValue(o);
    return onValue ? [{ onValue, option: o }] : [];
  });
  const selects = options.filter(
    (o) => !(switchOnValue(o) || isModelOption(o))
  );
  const onAgentChange = (agentId: unknown) => {
    if (agentId !== thread.agentId) {
      // A session belongs to one agent: another agent means another thread.
      createThread(agentId as string, draft);
    }
  };
  const effortName =
    effort && !switchOnValue(effort) ? currentName(effort) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="min-w-0 gap-1 px-1.5 font-normal text-muted-foreground hover:text-foreground"
            size="sm"
            variant="ghost"
          />
        }
      >
        <span className="truncate text-foreground">
          {currentName(model) ?? agent?.name ?? thread.agentId}
        </span>
        {effortName ? (
          <span className="shrink-0 text-muted-foreground">{effortName}</span>
        ) : null}
        <ChevronDown className="shrink-0" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top">
        {switches.length > 0 && (
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
        )}
        {selects.length > 0 && (
          <DropdownMenuGroup>
            {selects.map((o) => (
              <SelectOptionSub key={o.id} option={o} threadId={thread.id} />
            ))}
          </DropdownMenuGroup>
        )}
        {model ? (
          <DropdownMenuGroup>
            <SelectOptionSub option={model} threadId={thread.id} />
          </DropdownMenuGroup>
        ) : null}
        {options.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Agent
            <span className="ml-auto max-w-32 truncate text-muted-foreground">
              {agent?.name ?? thread.agentId}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px]">
                Another agent starts a new thread
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={onAgentChange}
                value={thread.agentId}
              >
                {agents.map((a) => (
                  <DropdownMenuRadioItem key={a.id} value={a.id}>
                    <Bot />
                    {a.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Whether the agent is confined to the repository. The scope is the operating system's, so it
 * says which repository, and says so plainly where the platform has no sandbox to offer.
 */
const ScopeChip = ({ thread }: { thread: Thread }) => {
  const repoPath = useProject((s) => s.info.repoPath);
  if (thread.sandboxed === undefined) {
    return null;
  }
  const repo = repoPath?.split("/").filter(Boolean).at(-1);
  return thread.sandboxed ? (
    <span
      className="flex items-center gap-1 rounded-full px-2 text-muted-foreground text-xs [&_svg]:size-3"
      title={`The agent reads and writes in ${repoPath ?? "the repository"}, its own files, caches and temporary files. The rest of your home directory is closed to it.`}
    >
      <ShieldCheck />
      {repo ? `Scoped to ${repo}` : "Scoped to the repository"}
    </span>
  ) : (
    <span
      className="flex items-center gap-1 rounded-full px-2 text-warning text-xs [&_svg]:size-3"
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
            className="min-w-0 gap-1 rounded-full bg-muted px-2 font-normal"
            size="sm"
            variant="ghost"
          />
        }
      >
        <span className="truncate">{current?.name ?? "Mode"}</span>
        <ChevronDown
          className="shrink-0 text-muted-foreground"
          data-icon="inline-end"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" side="top">
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={thread.currentModeId ?? null}
        >
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <span className="flex min-w-0 flex-col">
                <span>{m.name}</span>
                {m.description ? (
                  <span className="whitespace-normal text-[10px] text-muted-foreground leading-snug">
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

/** In the prototype the whole space is one iframe; on the canvas every page has its own. */
const shotFrameOf = (
  workspace: Workspace,
  space: string | null,
  page: Page | undefined
) =>
  workspace === "prototype" && space !== null
    ? frameIdOf(space)
    : (page?.id ?? "");

const Composer = ({ thread }: { thread: Thread }) => {
  const [text, setText] = useState(() => takeDraft(thread.id));
  const [attachPage, setAttachPage] = useState(true);
  const [attachSelection, setAttachSelection] = useState(true);
  const [attachShot, setAttachShot] = useState(false);
  const [busy, setBusy] = useState(false);
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const activePage = useEditor((s) => s.activePage);
  const pages = useProject((s) => s.pages);
  const page = pages.find((p) => p.id === (selection?.pageId ?? activePage));
  const workspace = useEditor((s) => s.workspace);
  const space = useEditor((s) => s.space);
  const shotFrame = shotFrameOf(workspace, space, page);
  const running = thread.status === "running" || thread.status === "cancelling";

  const send = async () => {
    if (!text.trim() || running) {
      return;
    }
    setBusy(true);
    const context = {
      fileOf: attachPage && page ? page : null,
      selectionName: inspect?.name ?? "element",
      selectionSource: attachSelection && selection ? selection.source : null,
      shotOf:
        attachShot && page ? { frameId: shotFrame, name: page.name } : null,
    };
    try {
      const attachments = await collectAttachments(context);
      await api().request("threads.prompt", {
        attachments,
        text,
        threadId: thread.id,
      });
      setText("");
    } catch (error) {
      reportError(error);
    }
    setBusy(false);
  };

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>) =>
    setText(e.target.value);
  const onTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };
  const cancel = () =>
    api().request("threads.cancel", { threadId: thread.id }).catch(reportError);

  const agentName =
    useAgents((s) => s.agents.find((a) => a.id === thread.agentId)?.name) ??
    "the agent";

  const selectionSource = selection?.source ?? null;
  const showPage = Boolean(page && attachPage);
  const showSelection = Boolean(selectionSource && attachSelection);
  const showShot = Boolean(page && attachShot);

  return (
    <div className="p-2">
      <div className="flex flex-col rounded-xl border bg-input/20 transition-colors focus-within:border-ring dark:bg-input/30">
        {showPage || showSelection || showShot ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {showPage && page ? (
              <ContextChip
                icon={<AppWindow />}
                label={page.name}
                onRemove={() => setAttachPage(false)}
                title={`Page file: ${page.file}`}
              />
            ) : null}
            {showSelection && selectionSource ? (
              <ContextChip
                icon={<SquareDashedMousePointer />}
                label={`${inspect?.name ?? "Selection"} :${selectionSource.line}`}
                onRemove={() => setAttachSelection(false)}
                title={`Selected element: ${selectionSource.file}:${selectionSource.line}`}
              />
            ) : null}
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
        <textarea
          className="field-sizing-content max-h-60 min-h-24 w-full resize-none bg-transparent px-3 py-2 text-xs/relaxed outline-none placeholder:text-muted-foreground"
          onChange={onTextChange}
          onKeyDown={onTextKeyDown}
          placeholder={`Ask ${agentName} to change the design…`}
          value={text}
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
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
            <DropdownMenuContent align="start" className="w-56" side="top">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  Send along with the prompt
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={attachPage}
                  disabled={!page}
                  onCheckedChange={setAttachPage}
                >
                  <AppWindow />
                  Page file
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={attachSelection}
                  disabled={!selectionSource}
                  onCheckedChange={setAttachSelection}
                >
                  <SquareDashedMousePointer />
                  Selected element
                </DropdownMenuCheckboxItem>
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
          <ModelPicker draft={text} thread={thread} />
          <div className="flex-1" />
          <ScopeChip thread={thread} />
          {running ? (
            <Button onClick={cancel} size="sm" variant="outline">
              <Square data-icon="inline-start" /> Stop
            </Button>
          ) : (
            <Button
              aria-label="Send"
              className="rounded-full"
              disabled={busy || !text.trim() || thread.status === "starting"}
              onClick={send}
              size="icon-sm"
              title="Send (⌘↩)"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
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
    className="flex h-5 min-w-0 items-center gap-1 rounded-md border bg-background/40 pr-0.5 pl-1.5 text-[11px] [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
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
