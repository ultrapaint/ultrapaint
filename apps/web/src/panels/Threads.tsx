import type { PromptAttachment, Thread, ThreadItem } from "@ultrapaint/contracts";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Image,
  Loader2,
  Paperclip,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { bridgeFor } from "../canvas/bridge.ts";
import { Button, Empty, IconButton, Select } from "../components/ui.tsx";
import { cn } from "../lib/cn.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

export const Threads = () => {
  const configured = useProject((s) => s.info.configured);
  const { agents, threads, current, items } = useAgents();
  const thread = threads.find((t) => t.id === current) ?? null;
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!configured) return;
    useAgents.getState().bind();
    void useAgents.getState().load();
  }, [configured]);

  if (!configured) return <Empty>Configure a repository first</Empty>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-line border-b px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <Select
            value={current}
            placeholder="No thread"
            options={threads.map((t) => ({
              value: t.id,
              label: `${t.title} · ${agents.find((a) => a.id === t.agentId)?.name ?? t.agentId}`,
            }))}
            onChange={(v) => useAgents.getState().open(v)}
          />
        </div>
        <IconButton title="New thread" onClick={() => setCreating((c) => !c)}>
          <Plus className="size-3.5" />
        </IconButton>
        {thread && (
          <IconButton
            title="Delete thread"
            onClick={() =>
              confirm("Delete this thread?") &&
              api().request("threads.delete", { threadId: thread.id }).catch(reportError)
            }
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
      {creating && (
        <div className="flex flex-col gap-1 border-line border-b bg-panel-2 p-2">
          <span className="text-ink-3">Start a thread with</span>
          {agents.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              className="justify-start"
              onClick={async () => {
                setCreating(false);
                try {
                  const t = await api().request("threads.create", { agentId: a.id });
                  await useAgents.getState().open(t.id);
                } catch (error) {
                  reportError(error);
                }
              }}
            >
              <Bot className="size-3.5" /> {a.name}
              {a.authHint && (
                <span className="ml-auto truncate text-[10px] text-ink-3">
                  {a.builtIn ? "built-in" : "custom"}
                </span>
              )}
            </Button>
          ))}
        </div>
      )}
      {thread ? (
        <ThreadView thread={thread} items={items[thread.id] ?? []} />
      ) : (
        <Empty>
          <Bot className="size-6" />
          Create a thread to work with an agent. Threads run in parallel, each with its own agent.
        </Empty>
      )}
    </div>
  );
};

const ThreadView = ({ thread, items }: { thread: Thread; items: readonly ThreadItem[] }) => {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <>
      <ThreadOptions thread={thread} />
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Item key={item.id} item={item} threadId={thread.id} />
          ))}
          {thread.status === "running" && (
            <div className="flex items-center gap-1.5 text-ink-3">
              <Loader2 className="size-3 animate-spin" /> working…
            </div>
          )}
          {thread.status === "starting" && (
            <div className="flex items-center gap-1.5 text-ink-3">
              <Loader2 className="size-3 animate-spin" /> starting agent…
            </div>
          )}
          {thread.status === "error" && (
            <div className="rounded bg-danger/10 p-2 text-danger">{thread.error}</div>
          )}
        </div>
      </div>
      <Composer thread={thread} />
    </>
  );
};

const ThreadOptions = ({ thread }: { thread: Thread }) => {
  const options = thread.configOptions ?? [];
  if (!thread.modes?.length && options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border-line border-b px-2 py-1.5">
      {thread.modes && thread.modes.length > 0 && (
        <div className="w-32">
          <Select
            className="h-6 text-[11px]"
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
          <Select
            className="h-6 text-[11px]"
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

const Item = ({ item, threadId }: { item: ThreadItem; threadId: string }) => {
  const [open, setOpen] = React.useState(false);
  switch (item.kind) {
    case "user":
      return (
        <div className="self-end rounded-lg bg-accent/20 px-2.5 py-1.5 text-ink">
          <div className="whitespace-pre-wrap">{item.text}</div>
          {item.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.attachments.map((a) => (
                <span key={a} className="rounded bg-panel-3 px-1 text-[10px] text-ink-2">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "agent":
      return <div className="whitespace-pre-wrap text-ink">{item.text}</div>;
    case "thought":
      return (
        <div className="text-ink-3">
          <button
            type="button"
            className="flex items-center gap-1"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}{" "}
            thinking
          </button>
          {open && (
            <div className="mt-1 whitespace-pre-wrap border-line border-l pl-2 text-[11px]">
              {item.text}
            </div>
          )}
        </div>
      );
    case "tool":
      return (
        <div className="rounded border border-line bg-panel-2 px-2 py-1">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left"
            onClick={() => setOpen((o) => !o)}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.status === "completed" && "bg-ok",
                item.status === "failed" && "bg-danger",
                item.status === "in_progress" && "animate-pulse bg-accent",
                item.status === "pending" && "bg-ink-3",
              )}
            />
            <span className="truncate text-ink-2">{item.title}</span>
            {item.toolKind && (
              <span className="ml-auto text-[10px] text-ink-3">{item.toolKind}</span>
            )}
          </button>
          {open && (item.content.length > 0 || item.locations.length > 0) && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-3">
              {[...item.locations, ...item.content].join("\n")}
            </pre>
          )}
        </div>
      );
    case "plan":
      return (
        <div className="rounded border border-line px-2 py-1">
          <div className="mb-1 text-[10px] text-ink-3 uppercase">Plan</div>
          {item.entries.map((e, i) => (
            <div
              key={`${i}-${e.content}`}
              className={cn(
                "flex items-start gap-1.5",
                e.status === "completed" && "text-ink-3 line-through",
              )}
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-ink-3" />
              <span>{e.content}</span>
            </div>
          ))}
        </div>
      );
    case "permission":
      return <Permission item={item} threadId={threadId} />;
    case "status":
      return <div className="text-ink-3">{item.text}</div>;
    case "turn_end":
      return (
        <div className="border-line border-t pt-1 text-ink-3">
          <div>
            Turn ended · {item.stopReason}
            {item.changedFiles.length > 0 &&
              ` · ${item.changedFiles.length} file${item.changedFiles.length === 1 ? "" : "s"} changed`}
          </div>
          {item.changedFiles.map((f) => (
            <button
              key={f}
              type="button"
              className="block truncate font-mono text-[10px] text-accent hover:underline"
              onClick={() => {
                useEditor.getState().setLeftTab("changes");
                window.dispatchEvent(new CustomEvent("ultrapaint:show-diff", { detail: f }));
              }}
            >
              {f}
            </button>
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
    <div
      className={cn(
        "rounded border px-2 py-1.5",
        item.decision ? "border-line" : "border-accent bg-accent/10",
      )}
    >
      <div className="font-medium text-ink">
        {item.decision ? "Permission" : "Permission requested"}
      </div>
      <div className="text-ink-2">{item.title}</div>
      {item.detail && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-3">
          {item.detail}
        </pre>
      )}
      {item.decision ? (
        <div className="mt-1 flex items-center gap-1 text-ink-3">
          <Check className="size-3" />{" "}
          {item.options.find((o) => o.optionId === item.decision)?.name ?? item.decision}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1">
          <div className="flex flex-wrap gap-1">
            {item.options.map((o) => (
              <Button
                key={o.optionId}
                size="xs"
                variant={o.kind.startsWith("allow") ? "solid" : "outline"}
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
          <label className="flex items-center gap-1 text-ink-3">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />{" "}
            remember for this thread
          </label>
        </div>
      )}
    </div>
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

  return (
    <div className="border-line border-t p-2">
      <div className="mb-1 flex flex-wrap gap-1">
        {screen && (
          <Chip
            active={attachScreen}
            onClick={() => setAttachScreen((v) => !v)}
            icon={<Paperclip className="size-3" />}
          >
            {screen.name}
          </Chip>
        )}
        {selection?.source && (
          <Chip
            active={attachSelection}
            onClick={() => setAttachSelection((v) => !v)}
            icon={<Paperclip className="size-3" />}
          >
            {inspect?.name ?? "selection"}:{selection.source.line}
          </Chip>
        )}
        {screen && (
          <Chip
            active={attachShot}
            onClick={() => setAttachShot((v) => !v)}
            icon={<Image className="size-3" />}
          >
            screenshot
          </Chip>
        )}
      </div>
      <textarea
        className="min-h-16 w-full resize-none rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
        placeholder={`Ask ${useAgents.getState().agents.find((a) => a.id === thread.agentId)?.name ?? "the agent"}… (⌘↩ to send)`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="mt-1 flex justify-end gap-1">
        {running ? (
          <Button
            variant="outline"
            onClick={() =>
              api().request("threads.cancel", { threadId: thread.id }).catch(reportError)
            }
          >
            <Square className="size-3" /> Stop
          </Button>
        ) : (
          <Button
            variant="solid"
            disabled={busy || !text.trim() || thread.status === "starting"}
            onClick={send}
          >
            Send
          </Button>
        )}
      </div>
    </div>
  );
};

const Chip = ({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px]",
      active ? "border-accent/60 bg-accent/15 text-ink" : "border-line text-ink-3 line-through",
    )}
  >
    {icon}
    <span className="max-w-32 truncate">{children}</span>
    {active ? null : <X className="size-2.5" />}
  </button>
);
