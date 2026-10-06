/**
 * Where a prompt is written: the composer with its chips, slash commands and attachments, and the
 * prompts queued while the agent works.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import type {
  PromptAttachment,
  QueuedPrompt,
  SlashCommand,
  Thread,
} from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  AppWindow,
  ArrowUp,
  Camera,
  Clock,
  ListPlus,
  Pencil,
  Plus,
  Square,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bridgeFor } from "../canvas/bridge.ts";
import { frameIdOf } from "../canvas/prototype.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { shortcutLabel } from "../lib/keys.ts";
import { takeDraft, useDrafts } from "../lib/start-thread.ts";
import { useAgents } from "../state/agents.ts";
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
import { showSetup } from "../state/design-system-setup.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor, type Workspace } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { isSendKey, useSendKey } from "../state/send-key.ts";
import { useSync } from "../state/sync.ts";
import { ModelPicker, ModePicker, roomyItems } from "./thread-pickers.tsx";
import {
  AnswerButtons,
  AnswerField,
  OpenQuestion,
  onAnswerKey,
  useAnswering,
} from "./thread-questions.tsx";

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

export const Composer = ({ thread }: { thread: Thread }) => {
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

  // While the agent works, what is sent waits in the thread's queue. One prompt at a time: a
  // screenshot to attach can take a while, and Enter again meanwhile must not send it twice.
  const send = async () => {
    const sent = text;
    if (busy || !sent.trim()) {
      return;
    }
    // `/sync` alone is the editor's: it opens the Sync view rather than starting a turn.
    if (sent.trim() === "/sync") {
      setText("");
      showSetup();
      useSync.getState().load();
      return;
    }
    setBusy(true);
    const sentChips = chips;
    try {
      const attachments = await collectAttachments(
        chips.length > 0 ? chips : implicit,
        attachShot && page ? { frameId: shotFrame, name: page.name } : null
      );
      await api().request("threads.prompt", {
        attachments,
        text: sent,
        threadId: thread.id,
      });
      // What was typed while it went is the next prompt, and stays.
      setText((current) => (current === sent ? "" : current));
      clearChips(thread.id, sentChips);
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
      <OpenQuestion answering={answering} threadId={thread.id} />
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
