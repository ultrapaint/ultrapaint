import type { PromptAttachment, Thread, ThreadItem } from "@ultrapaint/contracts";
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
import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { cn } from "../lib/utils.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

export const Threads = () => {
  const configured = useProject((s) => s.info.configured);
  const { agents, threads, current, items } = useAgents();
  const thread = threads.find((t) => t.id === current) ?? null;

  React.useEffect(() => {
    if (!configured) return;
    useAgents.getState().bind();
    void useAgents.getState().load();
  }, [configured]);

  if (!configured) return <PanelEmpty>Configure a repository first</PanelEmpty>;

  const create = async (agentId: string) => {
    try {
      const t = await api().request("threads.create", { agentId });
      await useAgents.getState().open(t.id);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <OptionSelect
            value={current}
            placeholder="No thread"
            options={threads.map((t) => ({
              value: t.id,
              label: `${t.title} · ${agents.find((a) => a.id === t.agentId)?.name ?? t.agentId}`,
            }))}
            onChange={(v) => useAgents.getState().open(v)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="New thread" title="New thread" />
            }
          >
            <Plus />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Start a thread with</DropdownMenuLabel>
              {agents.map((a) => (
                <DropdownMenuItem key={a.id} onClick={() => create(a.id)}>
                  <Bot />
                  {a.name}
                  {a.authHint && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {a.builtIn ? "built-in" : "custom"}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {thread && (
          <IconButton
            tooltip="Delete thread"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Delete this thread?",
                description: `“${thread.title}” and its history are removed.`,
                confirmLabel: "Delete",
                destructive: true,
              });
              if (ok) api().request("threads.delete", { threadId: thread.id }).catch(reportError);
            }}
          >
            <Trash2 />
          </IconButton>
        )}
      </div>
      {thread ? (
        <ThreadView thread={thread} items={items[thread.id] ?? []} />
      ) : (
        <PanelEmpty icon={<Bot />}>
          Create a thread to work with an agent. Threads run in parallel, each with its own agent.
        </PanelEmpty>
      )}
    </div>
  );
};

const ThreadView = ({ thread, items }: { thread: Thread; items: readonly ThreadItem[] }) => (
  <>
    <ThreadOptions thread={thread} />
    {/* Keyed by thread so each one opens scrolled to its latest message. */}
    <MessageScrollerProvider key={thread.id} autoScroll defaultScrollPosition="end">
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
                <AlertDescription className="whitespace-pre-wrap">{thread.error}</AlertDescription>
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

const ThreadOptions = ({ thread }: { thread: Thread }) => {
  const options = thread.configOptions ?? [];
  if (!thread.modes?.length && options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border-b px-2 py-1.5">
      {thread.modes && thread.modes.length > 0 && (
        <div className="w-32">
          <OptionSelect
            size="sm"
            value={thread.currentModeId ?? null}
            options={thread.modes.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(modeId) =>
              api().request("threads.setMode", { threadId: thread.id, modeId }).catch(reportError)
            }
          />
        </div>
      )}
      {options.map((o) => (
        <div key={o.id} className="w-32" title={o.name}>
          <OptionSelect
            size="sm"
            value={o.currentValue}
            options={o.options.map((x) => ({ value: x.value, label: x.name }))}
            onChange={(value) =>
              api()
                .request("threads.setConfigOption", { threadId: thread.id, optionId: o.id, value })
                .catch(reportError)
            }
          />
        </div>
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
  children: React.ReactNode;
}) => (
  <CollapsibleTrigger
    disabled={disabled}
    render={
      <Button
        variant="ghost"
        size="sm"
        className={cn("justify-start font-normal text-muted-foreground", className)}
      />
    }
  >
    {children}
  </CollapsibleTrigger>
);

const disclosureChevron = "transition-transform group-data-panel-open/button:rotate-90";

const Item = ({ item, threadId }: { item: ThreadItem; threadId: string }) => {
  switch (item.kind) {
    case "user":
      return (
        <Message align="end">
          <MessageContent>
            <Bubble variant="secondary" align="end" className="max-w-[90%]">
              <BubbleContent className="select-text whitespace-pre-wrap">{item.text}</BubbleContent>
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
              <BubbleContent className="select-text whitespace-pre-wrap">{item.text}</BubbleContent>
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
          <Disclosure className="w-full gap-1.5" disabled={details.length === 0}>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.status === "completed" && "bg-success",
                item.status === "failed" && "bg-destructive",
                item.status === "in_progress" && "animate-pulse bg-brand",
                item.status === "pending" && "bg-muted-foreground",
              )}
            />
            <span className="truncate">{item.title}</span>
            {item.toolKind && (
              <span className="ml-auto text-[10px] text-muted-foreground/70">{item.toolKind}</span>
            )}
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
          {item.entries.map((e, i) => (
            <div
              key={`${i}-${e.content}`}
              className={cn(
                "flex items-start gap-1.5",
                e.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <span>{e.content}</span>
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
            <Button
              key={f}
              variant="link"
              size="xs"
              className="max-w-full justify-start px-0 font-mono text-brand"
              onClick={() => {
                useEditor.getState().setLeftTab("changes");
                window.dispatchEvent(new CustomEvent("ultrapaint:show-diff", { detail: f }));
              }}
            >
              <span className="truncate">{f}</span>
            </Button>
          ))}
        </div>
      );
  }
};

const Permission = ({
  item,
  threadId,
}: {
  item: Extract<ThreadItem, { kind: "permission" }>;
  threadId: string;
}) => {
  const [remember, setRemember] = React.useState(false);
  return (
    <Alert className={cn(!item.decision && "border-brand bg-brand/10")}>
      <ShieldQuestion />
      <AlertTitle>{item.decision ? "Permission" : "Permission requested"}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>{item.title}</span>
        {item.detail && (
          <pre className="max-h-24 select-text overflow-auto whitespace-pre-wrap font-mono text-[10px]">
            {item.detail}
          </pre>
        )}
        {item.decision ? (
          <span className="flex items-center gap-1">
            <Check className="size-3" />
            {item.options.find((o) => o.optionId === item.decision)?.name ?? item.decision}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {item.options.map((o) => (
                <Button
                  key={o.optionId}
                  size="sm"
                  variant={o.kind.startsWith("allow") ? "default" : "outline"}
                  onClick={() =>
                    api()
                      .request("threads.permission", {
                        threadId,
                        requestId: item.requestId,
                        optionId: o.optionId,
                        remember,
                      })
                      .catch(reportError)
                  }
                >
                  {o.name}
                </Button>
              ))}
            </div>
            <Label className="font-normal">
              <Checkbox checked={remember} onCheckedChange={(c) => setRemember(c === true)} />
              remember for this thread
            </Label>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
};

const Composer = ({ thread }: { thread: Thread }) => {
  const [text, setText] = React.useState("");
  const [attachScreen, setAttachScreen] = React.useState(true);
  const [attachSelection, setAttachSelection] = React.useState(true);
  const [attachShot, setAttachShot] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const activeScreen = useEditor((s) => s.activeScreen);
  const screens = useProject((s) => s.screens);
  const screen = screens.find((s) => s.id === (selection?.screenId ?? activeScreen));
  const running = thread.status === "running" || thread.status === "cancelling";

  const send = async () => {
    if (!text.trim() || running) return;
    setBusy(true);
    try {
      const attachments: PromptAttachment[] = [];
      if (attachScreen && screen) attachments.push({ kind: "file", path: screen.file });
      if (attachSelection && selection?.source) {
        attachments.push({
          kind: "selection",
          file: selection.source.file,
          line: selection.source.line,
          col: selection.source.col,
          name: inspect?.name ?? "element",
        });
      }
      if (attachShot && screen) {
        const dataUrl = await bridgeFor(screen.id).screenshot();
        if (dataUrl)
          attachments.push({ kind: "image", dataUrl, name: `${screen.name} screenshot` });
      }
      await api().request("threads.prompt", { threadId: thread.id, text, attachments });
      setText("");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const agentName =
    useAgents.getState().agents.find((a) => a.id === thread.agentId)?.name ?? "the agent";

  return (
    <div className="border-t p-2">
      <InputGroup>
        <InputGroupTextarea
          className="max-h-40 min-h-14"
          placeholder={`Ask ${agentName}… (⌘↩ to send)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="flex-wrap">
          {screen && (
            <Chip pressed={attachScreen} onPressedChange={setAttachScreen} icon={<Paperclip />}>
              {screen.name}
            </Chip>
          )}
          {selection?.source && (
            <Chip
              pressed={attachSelection}
              onPressedChange={setAttachSelection}
              icon={<Paperclip />}
            >
              {inspect?.name ?? "selection"}:{selection.source.line}
            </Chip>
          )}
          {screen && (
            <Chip pressed={attachShot} onPressedChange={setAttachShot} icon={<Image />}>
              screenshot
            </Chip>
          )}
          {running ? (
            <InputGroupButton
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() =>
                api().request("threads.cancel", { threadId: thread.id }).catch(reportError)
              }
            >
              <Square /> Stop
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-xs"
              className="ml-auto rounded-full"
              aria-label="Send"
              title="Send (⌘↩)"
              disabled={busy || !text.trim() || thread.status === "starting"}
              onClick={send}
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
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Toggle
    variant="outline"
    size="sm"
    pressed={pressed}
    onPressedChange={onPressedChange}
    className={cn(
      "h-5 min-w-0 rounded-full px-1.5 font-normal",
      !pressed && "text-muted-foreground line-through",
    )}
  >
    {icon}
    <span className="max-w-28 truncate">{children}</span>
  </Toggle>
);
