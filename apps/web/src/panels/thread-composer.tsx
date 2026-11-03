/**
 * Where a prompt is written: the composer with its chips, slash commands and attachments, and the
 * prompts queued while the agent works.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import { parseCommand } from "@ultrapaint/contracts/tasks";
import type {
  PromptAttachment,
  QueuedPrompt,
  Thread,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  AppWindow,
  ArrowUp,
  BookText,
  Camera,
  Component,
  ListPlus,
  Palette,
  Pencil,
  Plus,
  SquareDashedMousePointer,
  Type,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { frameOf } from "../canvas/editor-frame.ts";
import { frameIdOf } from "../canvas/prototype.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { useBoardChip } from "../lib/add-to-chat.ts";
import { boardChipLabel } from "../lib/board-chip.ts";
import { chordLabel } from "../lib/keys.ts";
import { attachImages, pastedImages } from "../lib/pasted-images.ts";
import { threadView } from "../lib/thread-view.ts";
import { useAgents } from "../state/agents.ts";
import {
  addChip,
  attachmentsOf,
  type Chip,
  chipKey,
  chipOfAttachment,
  clearChips,
  isPlace,
  nodeChip,
  pageChip,
  removeChip,
  useChips,
} from "../state/attachments.ts";
import { api } from "../state/connection.ts";
import { showSetup } from "../state/design-system-setup.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor, type Workspace } from "../state/editor.ts";
import { takeRequest, useRequest } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { isSendKey, useSendKey } from "../state/send-key.ts";
import { useSlashCommands } from "../state/slash-commands.ts";
import { useSync } from "../state/sync.ts";
import { ModelPicker, ModePicker } from "./thread-pickers.tsx";
import {
  AnswerButtons,
  AnswerField,
  composerText,
  OpenQuestion,
  onAnswerKey,
  StopButton,
  useAnswering,
} from "./thread-questions.tsx";

/**
 * What a prompt carries, from the composer's chips, and a screenshot when one was asked for.
 */
const collectAttachments = async (
  chips: readonly Chip[],
  shotOf: { frameId: string; name: string } | null
): Promise<PromptAttachment[]> => {
  const attachments = attachmentsOf(chips);
  const dataUrl = shotOf ? await frameOf(shotOf.frameId).screenshot() : null;
  return shotOf && dataUrl
    ? [
        ...attachments,
        { dataUrl, kind: "image", name: `${shotOf.name} screenshot` },
      ]
    : attachments;
};

/** `/sync` with no source asks where the sync stands, which the editor shows: its Sync view. */
const opensSync = (text: string) => {
  const parsed = parseCommand(text);
  return (
    parsed?._tag === "Request" &&
    parsed.request._tag === "Sync" &&
    parsed.request.source === undefined
  );
};

/** In the prototype the whole canvas is one frame; on the canvas every page has its own. */
const shotFrameOf = (
  workspace: Workspace,
  canvas: string | null,
  page: Page | undefined
) =>
  workspace === "prototype" && canvas !== null
    ? frameIdOf(canvas)
    : (page?.id ?? "");

const COMMAND_QUERY_RE = /^\/([\w-]*)$/;

/**
 * The commands a prompt may start with: the editor's, read once for every composer, then the
 * ones the thread's agent says its session has (`create_plan`), which go to it as typed.
 */
const useCommands = (thread: Thread) => {
  const commands = useSlashCommands((s) => s.commands);
  useEffect(() => {
    if (!useSlashCommands.getState().loaded) {
      useSlashCommands.getState().load();
    }
  }, []);
  const { agentCommands } = thread;
  return useMemo(() => {
    const own = new Set(commands.map((c) => c.name));
    return [
      ...commands,
      ...(agentCommands ?? []).filter((c) => !own.has(c.name)),
    ];
  }, [commands, agentCommands]);
};

export const Composer = ({ thread }: { thread: Thread }) => {
  const [text, setText] = useState(
    () => takeRequest({ draft: thread.id }) ?? ""
  );
  const sendKey = useSendKey((s) => s.sendKey);
  // A draft that arrives after the composer is on screen, from a thread started elsewhere.
  useRequest({ draft: thread.id }, setText);
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
  // Nothing attached but images: the selection goes along, shown dashed, or on a board what is
  // picked there. The page only when attached.
  const boardChip = useBoardChip();
  const selectedChip =
    (selection && selectedNode ? nodeChip(selection, selectedNode) : null) ??
    boardChip;
  // Pictures show as themselves, over the chips of the places the prompt is about.
  const images = chips.filter(isImage);
  const places = chips.filter(isPlace);
  const implicit =
    places.length > 0 ||
    selectedChip === null ||
    dismissed.includes(chipKey(selectedChip))
      ? []
      : [selectedChip];
  const commands = useCommands(thread);
  const [commandIndex, setCommandIndex] = useState(0);
  const workspace = useEditor((s) => s.workspace);
  const canvas = useEditor((s) => s.canvas);
  const shotFrame = shotFrameOf(workspace, canvas, page);
  const running = threadView(thread).busy;
  const answering = useAnswering(thread.id);

  // While the agent works, what is sent waits in the thread's queue. One prompt at a time: a
  // screenshot to attach can take a while, and Enter again meanwhile must not send it twice.
  const send = async () => {
    const sent = text;
    if (busy || !sent.trim()) {
      return;
    }
    // Where the sync stands is the editor's to show: the Sync view opens rather than a turn.
    if (opensSync(sent)) {
      setText("");
      showSetup();
      useSync.getState().load();
      return;
    }
    setBusy(true);
    const sentChips = chips;
    try {
      const attachments = await collectAttachments(
        [...chips, ...implicit],
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
  // A `/` at the start offers the commands, the server's and the agent's, until the name is typed.
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
  // An image on the clipboard is attached rather than pasted as text.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedImages(e.clipboardData);
    if (pasted.length > 0) {
      e.preventDefault();
      attachImages(thread.id, pasted);
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
    <div className="flex flex-col gap-2 px-2 pb-2">
      <QueuedPrompts
        onEdit={(queued) => setText(queued.text)}
        running={running}
        thread={thread}
      />
      <OpenQuestion answering={answering} threadId={thread.id} />
      <div className="flex flex-col rounded-lg border border-transparent bg-muted transition-colors duration-100 hover:border-input has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/25">
        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-2 pt-2">
            {images.map((chip) => (
              <ImageThumb
                chip={chip}
                key={chipKey(chip)}
                onRemove={() => removeChip(thread.id, chipKey(chip))}
              />
            ))}
          </div>
        ) : null}
        {places.length > 0 || implicit.length > 0 || showShot ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {places.map((chip) => (
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
                label={`Screenshot of ${page.name}`}
                onRemove={() => setAttachShot(false)}
              />
            ) : null}
          </div>
        ) : null}
        {offered.length > 0 && !answering ? (
          <div
            className="mx-1 mt-1 flex max-h-56 flex-col overflow-y-auto border-b pb-1"
            role="listbox"
          >
            {offered.map((command, i) => (
              <button
                aria-selected={i === commandIndex}
                className={cn(
                  "flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  i === commandIndex && "bg-accent"
                )}
                key={command.name}
                onClick={() => complete(command.name)}
                onMouseDown={(e) => e.preventDefault()}
                role="option"
                type="button"
              >
                <span className="font-code text-foreground">
                  /{command.name}
                  {command.argument ? (
                    <span className="ml-1.5 text-muted-foreground">
                      {command.argument}
                    </span>
                  ) : null}
                </span>
                <span className="font-small text-muted-foreground">
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
            aria-label="Prompt"
            className={composerText}
            onChange={onTextChange}
            onKeyDown={onTextKeyDown}
            onPaste={onPaste}
            placeholder={placeholderOf(running, agentName)}
            value={text}
          />
        )}
        <div className="@container flex min-w-0 items-center gap-0.5 p-1.5 pt-0">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="Attach"
                        className="text-muted-foreground"
                        size="icon"
                        variant="ghost"
                      />
                    }
                  />
                }
              >
                <Plus />
              </TooltipTrigger>
              <TooltipContent>Attach</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-64" side="top">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={!selectedChip}
                  onClick={attachSelection}
                >
                  <SquareDashedMousePointer />
                  <span className="truncate">{attachLabel(selectedChip)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!page} onClick={attachPage}>
                  <AppWindow />
                  <span className="truncate">
                    {page ? `Attach the page ${page.name}` : "Attach the page"}
                  </span>
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
          <div className="min-w-1 flex-1" />
          <div className="flex shrink-0 items-center gap-1.5">
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
    <section
      aria-label="Queued prompts"
      className="flex flex-col gap-1 rounded-lg border px-3 py-2"
    >
      <div className="flex min-h-6 items-center gap-2 font-small text-muted-foreground">
        <span className="min-w-0 flex-1">
          {running
            ? `${queued.length} queued, sent when this turn ends`
            : `${queued.length} queued: the last turn didn’t finish`}
        </span>
        {running ? null : (
          <Button onClick={sendNow} size="sm" variant="secondary">
            Send now
          </Button>
        )}
      </div>
      <ol className="flex flex-col">
        {queued.map((q) => (
          <li
            className="group/queued -mx-1.5 flex items-start gap-1 rounded-md py-1 pl-1.5 hover:bg-accent"
            key={q.id}
          >
            <span className="min-w-0 flex-1 truncate font-body" title={q.text}>
              {q.text}
              {q.attachments.length > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {q.attachments.length} attached
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center pr-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover/queued:opacity-100">
              <IconButton
                onClick={() => edit(q.id)}
                size="icon-sm"
                tooltip="Edit"
              >
                <Pencil />
              </IconButton>
              <IconButton
                onClick={() => unqueue(q.id).catch(reportError)}
                size="icon-sm"
                tooltip="Remove"
              >
                <X />
              </IconButton>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const placeholderOf = (running: boolean, agentName: string) =>
  running ? "Queue a follow-up…" : `Ask ${agentName}, or type / for commands…`;

/**
 * Send; while the agent works, Stop, and Queue beside it once there is something to queue. One
 * round button at the composer's corner in each case, so the pickers keep their width.
 */
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
}) => {
  const label = running ? "Queue" : "Send";
  return (
    <>
      {running ? <StopButton onStop={onStop} /> : null}
      {running && !canSend ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={label}
                className="rounded-full"
                disabled={!canSend}
                onClick={onSend}
                size="icon"
              />
            }
          >
            {running ? <ListPlus /> : <ArrowUp />}
          </TooltipTrigger>
          <TooltipContent>
            {label} <Kbd>{chordLabel("mod+enter")}</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
};

const chipTitle = (chip: Chip) => {
  if (chip.kind === "board") {
    return `${boardChipLabel(chip)} · ${chip.file}`;
  }
  if (chip.kind === "image") {
    return chip.name;
  }
  return chip.kind === "node" ? `${chip.name} · ${chip.file}` : chip.file;
};

/** The + menu's entry that attaches what is selected, or picked on a board. */
const attachLabel = (chip: Chip | null) => {
  if (chip?.kind === "board") {
    return `Attach ${boardChipLabel(chip)}`;
  }
  return chip ? `Attach ${chip.name}` : "Attach the selection";
};

/** A board's chip's icon: a palette for tokens, type for a text style, a component, a page of text. */
const BoardIcon = ({ chip }: { chip: Chip & { kind: "board" } }) => {
  switch (chip.pick) {
    case "textStyle":
      return <Type />;
    case "guideline":
      return <BookText />;
    case "systemComponent":
    case "appComponent":
      return <Component />;
    default:
      return <Palette />;
  }
};

/** The icon a chip leads with: a page, a component, an element, a board's pick. */
const ChipIcon = ({ chip, component }: { chip: Chip; component: boolean }) => {
  if (chip.kind === "board") {
    return <BoardIcon chip={chip} />;
  }
  if (chip.kind === "page") {
    return <AppWindow />;
  }
  return component ? <Component /> : <SquareDashedMousePointer />;
};

type ImageChip = Extract<Chip, { kind: "image" }>;

const isImage = (chip: Chip): chip is ImageChip => chip.kind === "image";

/** A picture sent with the next prompt, as itself; its × shows over its corner on hover. */
const ImageThumb = ({
  chip,
  onRemove,
}: {
  chip: ImageChip;
  onRemove: () => void;
}) => (
  <span
    className="group/thumb relative size-14 shrink-0"
    title={chipTitle(chip)}
  >
    <img
      alt={chip.name}
      className="size-full rounded-md object-cover outline outline-black/10 -outline-offset-1 dark:outline-white/10"
      height={56}
      src={chip.dataUrl}
      width={56}
    />
    <button
      aria-label={`Remove ${chip.name}`}
      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 outline-none transition-opacity duration-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/thumb:opacity-100 [&_svg]:size-3"
      onClick={onRemove}
      type="button"
    >
      <X />
    </button>
  </span>
);

/** The chips' look: a raised neutral tag in the composer's well; dashed when only implied. */
const chipClass =
  "flex h-6 min-w-0 items-center gap-1 rounded-md pr-0.5 pl-1.5 font-small [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A chip's ×, muted until the pointer is on it. */
const ChipRemove = ({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) => (
  <button
    aria-label={`Remove ${name}`}
    className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
    onClick={onRemove}
    type="button"
  >
    <X />
  </button>
);

/**
 * An attachment of the next prompt: a raised tag with its icon, an element, a component, a page
 * or a board's pick. The context sent because nothing was attached (the selection) is dashed,
 * and removing it keeps it out of this prompt.
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
  const component =
    (chip.kind === "node" && chip.component) ||
    (chip.kind === "board" &&
      (chip.pick === "systemComponent" || chip.pick === "appComponent"));
  const name = chip.kind === "board" ? boardChipLabel(chip) : chip.name;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              chipClass,
              implicit
                ? "border border-input border-dashed text-muted-foreground"
                : "bg-background text-foreground shadow-xs [&>svg]:text-muted-foreground"
            )}
          />
        }
      >
        <ChipIcon chip={chip} component={component} />
        <span className="max-w-48 truncate">{name}</span>
        <ChipRemove name={name} onRemove={onRemove} />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {implicit ? "The selection, sent with the prompt" : chipTitle(chip)}
      </TooltipContent>
    </Tooltip>
  );
};

/** Context sent with the prompt; removing it keeps it out until re-added from the + menu. */
const ContextChip = ({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) => (
  <span
    className={cn(
      chipClass,
      "bg-background text-foreground shadow-xs [&>svg]:text-muted-foreground"
    )}
  >
    {icon}
    <span className="max-w-48 truncate">{label}</span>
    <ChipRemove name={label} onRemove={onRemove} />
  </span>
);
