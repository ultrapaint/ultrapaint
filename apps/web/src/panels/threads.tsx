import type { Screen } from "@ultrapaint/contracts/screens";
import type {
  PromptAttachment,
  Thread,
  ThreadItem,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Image,
  ListTodo,
  Paperclip,
  Plus,
  ShieldQuestion,
  Square,
  Trash2,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
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
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
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
import { Toggle } from "@/components/ui/toggle";
import { bridgeFor } from "../canvas/bridge.ts";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

const openThread = (threadId: string) => useAgents.getState().open(threadId);

const createThread = async (agentId: string) => {
  try {
    const t = await api().request("threads.create", { agentId });
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
    <ThreadOptions thread={thread} />
    {/* Keyed by thread so each one opens scrolled to its latest message. */}
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      key={thread.id}
    >
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-2 p-2">
            {items.map((item) => (
              <MessageScrollerItem key={item.id} messageId={item.id}>
                <Item item={item} threadId={thread.id} />
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
    <Composer thread={thread} />
  </>
);

type ConfigOption = NonNullable<Thread["configOptions"]>[number];

const ConfigOptionSelect = ({
  option,
  threadId,
}: {
  option: ConfigOption;
  threadId: string;
}) => {
  const onChange = (value: string) =>
    api()
      .request("threads.setConfigOption", {
        optionId: option.id,
        threadId,
        value,
      })
      .catch(reportError);
  return (
    <div className="w-32" title={option.name}>
      <OptionSelect
        onChange={onChange}
        options={option.options.map((x) => ({ label: x.name, value: x.value }))}
        size="sm"
        value={option.currentValue}
      />
    </div>
  );
};

const ThreadOptions = ({ thread }: { thread: Thread }) => {
  const options = thread.configOptions ?? [];
  const setMode = (modeId: string) =>
    api()
      .request("threads.setMode", { modeId, threadId: thread.id })
      .catch(reportError);
  if (!thread.modes?.length && options.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1 border-b px-2 py-1.5">
      {thread.modes && thread.modes.length > 0 && (
        <div className="w-32">
          <OptionSelect
            onChange={setMode}
            options={thread.modes.map((m) => ({ label: m.name, value: m.id }))}
            size="sm"
            value={thread.currentModeId ?? null}
          />
        </div>
      )}
      {options.map((o) => (
        <ConfigOptionSelect key={o.id} option={o} threadId={thread.id} />
      ))}
    </div>
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

const Item = ({ item, threadId }: { item: ThreadItem; threadId: string }) => {
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
              <BubbleContent className="select-text whitespace-pre-wrap">
                {item.text}
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
          <CollapsibleContent className="mt-1 select-text whitespace-pre-wrap border-l pl-2 text-[11px] text-muted-foreground">
            {item.text}
          </CollapsibleContent>
        </Collapsible>
      );
    case "tool": {
      const details = [...item.locations, ...item.content];
      return (
        <Collapsible className="rounded-md border bg-muted/30">
          <Disclosure
            className="w-full gap-1.5"
            disabled={details.length === 0}
          >
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
            <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap border-t px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {details.join("\n")}
            </pre>
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
  fileOf: Screen | null;
  selectionSource: Selection["source"];
  selectionName: string;
  shotOf: Screen | null;
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
    const dataUrl = await bridgeFor(shotOf.id).screenshot();
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

const Composer = ({ thread }: { thread: Thread }) => {
  const [text, setText] = useState("");
  const [attachScreen, setAttachScreen] = useState(true);
  const [attachSelection, setAttachSelection] = useState(true);
  const [attachShot, setAttachShot] = useState(false);
  const [busy, setBusy] = useState(false);
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const activeScreen = useEditor((s) => s.activeScreen);
  const screens = useProject((s) => s.screens);
  const screen = screens.find(
    (s) => s.id === (selection?.screenId ?? activeScreen)
  );
  const running = thread.status === "running" || thread.status === "cancelling";

  const send = async () => {
    if (!text.trim() || running) {
      return;
    }
    setBusy(true);
    const context = {
      fileOf: attachScreen && screen ? screen : null,
      selectionName: inspect?.name ?? "element",
      selectionSource: attachSelection && selection ? selection.source : null,
      shotOf: attachShot && screen ? screen : null,
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

  return (
    <div className="border-t p-2">
      <InputGroup>
        <InputGroupTextarea
          className="max-h-40 min-h-14"
          onChange={onTextChange}
          onKeyDown={onTextKeyDown}
          placeholder={`Ask ${agentName}… (⌘↩ to send)`}
          value={text}
        />
        <InputGroupAddon align="block-end" className="flex-wrap">
          {screen && (
            <Chip
              icon={<Paperclip />}
              onPressedChange={setAttachScreen}
              pressed={attachScreen}
            >
              {screen.name}
            </Chip>
          )}
          {selection?.source ? (
            <Chip
              icon={<Paperclip />}
              onPressedChange={setAttachSelection}
              pressed={attachSelection}
            >
              {inspect?.name ?? "selection"}:{selection.source.line}
            </Chip>
          ) : null}
          {screen && (
            <Chip
              icon={<Image />}
              onPressedChange={setAttachShot}
              pressed={attachShot}
            >
              screenshot
            </Chip>
          )}
          {running ? (
            <InputGroupButton
              className="ml-auto"
              onClick={cancel}
              size="sm"
              variant="outline"
            >
              <Square /> Stop
            </InputGroupButton>
          ) : (
            <InputGroupButton
              aria-label="Send"
              className="ml-auto rounded-full"
              disabled={busy || !text.trim() || thread.status === "starting"}
              onClick={send}
              size="icon-xs"
              title="Send (⌘↩)"
              variant="default"
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
};

/** Attachment toggle: pressed means the context is sent along with the prompt. */
const Chip = ({
  pressed,
  onPressedChange,
  icon,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <Toggle
    className={cn(
      "h-5 min-w-0 rounded-full px-1.5 font-normal",
      !pressed && "text-muted-foreground line-through"
    )}
    onPressedChange={onPressedChange}
    pressed={pressed}
    size="sm"
    variant="outline"
  >
    {icon}
    <span className="max-w-28 truncate">{children}</span>
  </Toggle>
);
