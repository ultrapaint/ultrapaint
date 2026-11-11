/**
 * Where a prompt is written: the composer with its chips, slash commands and attachments, and the
 * prompts queued while the agent works.
 */
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { Page } from "@ultrapaint/contracts/pages";
import { parseCommand } from "@ultrapaint/contracts/tasks";
import type {
  PromptAttachment,
  QueuedPrompt,
  Thread,
} from "@ultrapaint/contracts/threads";
import {
  AppWindow,
  ArrowUp,
  BookText,
  Camera,
  Component,
  FilePlus,
  FileText,
  ListPlus,
  Palette,
  Paperclip,
  Pencil,
  SquareDashedMousePointer,
  Type,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { frameOf } from "../canvas/editor-frame.ts";
import { frameIdOf } from "../canvas/prototype.tsx";
import { ChipTag } from "../components/chip.tsx";
import { composerBox, composerText } from "../components/composer-style.ts";
import { CutText } from "../components/cut-text.tsx";
import { FileDropBox, FilesInput } from "../components/file-drop.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { ImageThumb } from "../components/image-thumb.tsx";
import { useImplicitChip } from "../lib/add-to-chat.ts";
import { pastedImages, sizeLabel } from "../lib/attach-files.ts";
import { boardChipLabel } from "../lib/board-chip.ts";
import type { ImageChip } from "../lib/file-chips.ts";
import { threadView } from "../lib/thread-view.ts";
import {
  addChip,
  attachFiles,
  attachmentsOf,
  type Chip,
  chipKey,
  chipOfAttachment,
  clearChips,
  dismissChip,
  pageChip,
  removeChip,
  useChips,
} from "../state/attachments.ts";
import { api } from "../state/connection.ts";
import { showSetup } from "../state/design-system-setup.ts";
import { setDraft, useDraft } from "../state/drafts.ts";
import { useEditor, type Workspace } from "../state/editor.ts";
import { useRequest } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { isSendKey, useSendKey } from "../state/send-key.ts";
import { useSlashCommands } from "../state/slash-commands.ts";
import { useSync } from "../state/sync.ts";
import { ReviewChip } from "./review-level.tsx";
import { ModelPicker } from "./thread-pickers.tsx";
import {
  AnswerButtons,
  AnswerField,
  OpenQuestion,
  onAnswerKey,
  SendKeyHint,
  StopButton,
  useAnswering,
} from "./thread-questions.tsx";

/**
 * What a prompt carries, from the composer's chips, and a screenshot when one was asked for. A
 * screenshot that can't be taken stops the prompt, which would otherwise go without what its chip
 * promised.
 */
const collectAttachments = async (
  chips: readonly Chip[],
  shotOf: { frameId: string; name: string } | null
): Promise<PromptAttachment[]> => {
  const attachments = attachmentsOf(chips);
  if (!shotOf) {
    return attachments;
  }
  const dataUrl = await frameOf(shotOf.frameId).screenshot();
  if (!dataUrl) {
    throw new Error(`The screenshot of ${shotOf.name} couldn’t be taken`);
  }
  return [
    ...attachments,
    { dataUrl, kind: "image", name: `${shotOf.name} screenshot` },
  ];
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
 * A queued prompt put back in the composer over what is typed there: its text, a blank line,
 * then the draft, which nothing else would bring back. Its text alone over an empty draft.
 */
const overDraft = (queued: string, draft: string) =>
  draft.trim() === "" ? queued : `${queued}\n\n${draft}`;

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
  // The draft is the thread's, kept while the chat is closed or another one is open.
  const text = useDraft(thread.id);
  const setText = (next: string | ((current: string) => string)) =>
    setDraft(thread.id, next);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Counts the drafts written in from elsewhere (a starter, a task), each placed for typing on. */
  const [placed, setPlaced] = useState(0);
  const sendKey = useSendKey((s) => s.sendKey);
  // A draft asked for, as the composer mounts or while it is on screen (a starter, a thread
  // started elsewhere): it lands with the caret at its end, to be added to.
  useRequest({ draft: thread.id }, (draft) => {
    setText(draft);
    setPlaced((n) => n + 1);
  });
  useEffect(() => {
    const el = field.current;
    if (placed === 0 || !el) {
      return;
    }
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [placed]);
  const chips = useChips(thread.id);
  const [attachShot, setAttachShot] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Why the last send didn't go, said under the composer until the next one. */
  const [failed, setFailed] = useState<string | null>(null);
  const selection = useEditor((s) => s.selection);
  const activePage = useEditor((s) => s.activePage);
  const pages = useProject((s) => s.pages);
  const page = pages.find((p) => p.id === (selection?.frame ?? activePage));
  // Nothing attached but images: the selection goes along, shown dashed, or on a board what is
  // picked there. The page only when attached.
  const { implicit, selected: selectedChip } = useImplicitChip(thread.id);
  // Pictures show as themselves, over the chips of the places the prompt is about and its files.
  const images = chips.filter(isImage);
  const tags = chips.filter((chip) => !isImage(chip));
  const sentWith = implicit ? [...chips, implicit] : chips;
  const workspace = useEditor((s) => s.workspace);
  const canvas = useEditor((s) => s.canvas);
  const shotFrame = shotFrameOf(workspace, canvas, page);
  const running = threadView(thread).busy;
  const answering = useAnswering(thread.id);
  const menu = useCommandMenu(thread, text, setText, answering === null);

  // While the agent works, what is sent waits in the thread's queue. One prompt at a time: a
  // screenshot to attach can take a while, and Enter again meanwhile must not send it twice.
  // Send with nothing typed puts the caret in the prompt, where what is missing goes.
  const send = async () => {
    const sent = text;
    if (busy) {
      return;
    }
    if (!sent.trim()) {
      field.current?.focus();
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
    setFailed(null);
    const sentChips = chips;
    try {
      const attachments = await collectAttachments(
        sentWith,
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
    } catch (error) {
      // A folder that is no longer one is the editor's to say; any other failure is this
      // prompt's, said under it with the draft kept to try again.
      if (error instanceof RequestError && error.code === "not_configured") {
        reportError(error);
      } else {
        setFailed(error instanceof Error ? error.message : String(error));
      }
    }
    setBusy(false);
  };

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    menu.reset();
  };
  const onTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (answering) {
      onAnswerKey(e, answering, thread.id, sendKey, running);
      return;
    }
    if (menu.onKey(e)) {
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
      attachFiles(thread.id, pasted);
    }
  };
  const cancel = () =>
    api().request("threads.cancel", { threadId: thread.id }).catch(reportError);

  const showShot = Boolean(page && attachShot);

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <QueuedPrompts
        onEdit={(queued) => setText((draft) => overDraft(queued.text, draft))}
        running={running}
        thread={thread}
      />
      <FileDropBox
        className={composerBox}
        data-composer
        hint="Drop to attach"
        onFiles={(dropped) => attachFiles(thread.id, dropped)}
      >
        {/* An agent's question is the composer's own top: answered below it, sent from its bar. */}
        <OpenQuestion answering={answering} threadId={thread.id} />
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
        {tags.length > 0 || implicit || showShot ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {tags.map((chip) => (
              <AttachmentChip
                chip={chip}
                key={chipKey(chip)}
                onRemove={() => removeChip(thread.id, chipKey(chip))}
              />
            ))}
            {implicit ? (
              <AttachmentChip
                chip={implicit}
                implicit
                key={chipKey(implicit)}
                onRemove={() => dismissChip(thread.id, chipKey(implicit))}
              />
            ) : null}
            {showShot && page ? (
              <ChipTag
                icon={<Camera />}
                name={`Screenshot of ${page.name}`}
                onRemove={() => setAttachShot(false)}
                tip={`Screenshot of ${page.name}`}
              />
            ) : null}
          </div>
        ) : null}
        <CommandList menu={menu} />
        {answering ? (
          <AnswerField answering={answering} onKeyDown={onTextKeyDown} />
        ) : (
          // The commands' list is the prompt's: the arrows move through it while the caret stays.
          <textarea
            aria-activedescendant={menu.activeId}
            aria-autocomplete="list"
            aria-controls={menu.id}
            aria-expanded={menu.offered.length > 0}
            aria-label="Prompt"
            className={composerText}
            onChange={onTextChange}
            onKeyDown={onTextKeyDown}
            onPaste={onPaste}
            placeholder={placeholderOf(running)}
            ref={field}
            role="combobox"
            value={text}
          />
        )}
        <div className="@container flex min-w-0 items-center gap-1 p-2 pt-0">
          <ModelPicker thread={thread} />
          <ReviewChip thread={thread} />
          <div className="min-w-1 flex-1" />
          <div className="flex shrink-0 items-center gap-1">
            <AttachMenu
              attachShot={attachShot}
              onAttachShot={setAttachShot}
              page={page}
              selectedChip={selectedChip}
              threadId={thread.id}
            />
            {answering ? (
              <AnswerButtons
                answering={answering}
                onStop={cancel}
                running={running}
                threadId={thread.id}
              />
            ) : (
              <SendButtons
                busy={busy}
                canSend={Boolean(text.trim())}
                onSend={send}
                onStop={cancel}
                running={running}
              />
            )}
          </div>
        </div>
      </FileDropBox>
      {failed ? (
        <SendFailed busy={busy} message={failed} onRetry={send} />
      ) : null}
    </div>
  );
};

type CommandMenu = ReturnType<typeof useCommandMenu>;

/**
 * The slash commands offered as the prompt is typed: a `/` at the start offers the commands, the
 * server's and the agent's, until the name is typed or Escape closes the list for that query. The
 * list is the prompt's (a combobox): the arrows move through it while the caret stays.
 */
const useCommandMenu = (
  thread: Thread,
  text: string,
  setText: (text: string) => void,
  open: boolean
) => {
  const commands = useCommands(thread);
  const [index, setIndex] = useState(0);
  /** The query Escape closed the list on; it opens again once the query changes. */
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const id = useId();
  const match: RegExpExecArray | null = COMMAND_QUERY_RE.exec(text);
  const query = match?.[1];
  const offered =
    query === undefined || query === closedFor || !open
      ? []
      : commands.filter((c) => c.name.startsWith(query.toLowerCase()));
  const complete = (name: string) => setText(`/${name} `);
  const optionId = (i: number) => `${id}-${i}`;
  const shown = offered.length > 0;
  /** The list's keys: arrows move through it, Tab or Enter picks, Escape closes it. Whether it took one. */
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shown) {
      return false;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setIndex((i) => (i + step + offered.length) % offered.length);
    } else if (
      (e.key === "Tab" || e.key === "Enter") &&
      !(e.metaKey || e.ctrlKey)
    ) {
      complete((offered[index] ?? offered[0])?.name ?? "");
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setClosedFor(query ?? null);
    } else {
      return false;
    }
    return true;
  };
  return {
    /** The option the arrows are on, for the prompt to say. */
    activeId: shown ? optionId(index) : undefined,
    complete,
    id,
    index,
    offered,
    onKey,
    optionId,
    reset: () => setIndex(0),
  };
};

/** The commands offered, over the prompt, the one the arrows are on filled. */
const CommandList = ({ menu }: { menu: CommandMenu }) =>
  menu.offered.length > 0 ? (
    <div
      className="mx-1 mt-1 flex max-h-56 flex-col overflow-y-auto border-b pb-1"
      id={menu.id}
      role="listbox"
    >
      {menu.offered.map((command, i) => (
        <button
          aria-selected={i === menu.index}
          className={cn(
            "flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent",
            i === menu.index && "bg-accent"
          )}
          id={menu.optionId(i)}
          key={command.name}
          onClick={() => menu.complete(command.name)}
          onMouseDown={(e) => e.preventDefault()}
          role="option"
          tabIndex={-1}
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
          <span className="font-body-small text-muted-foreground">
            {command.description}
          </span>
        </button>
      ))}
    </div>
  ) : null;

/**
 * Attach, beside Send: what there is to attach (the selection, the page shown, its screenshot),
 * each drawn only when there is one, then pictures or files from disk.
 */
const AttachMenu = ({
  attachShot,
  onAttachShot,
  page,
  selectedChip,
  threadId,
}: {
  attachShot: boolean;
  onAttachShot: (on: boolean) => void;
  page: Page | undefined;
  selectedChip: Chip | null;
  threadId: string;
}) => {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
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
            <Paperclip />
          </TooltipTrigger>
          <TooltipContent>Attach</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72" side="top">
          {selectedChip || page ? (
            <>
              <DropdownMenuGroup>
                {selectedChip ? (
                  <DropdownMenuItem
                    onClick={() => addChip(threadId, selectedChip)}
                  >
                    <SquareDashedMousePointer />
                    <span className="truncate">
                      {attachLabel(selectedChip)}
                    </span>
                  </DropdownMenuItem>
                ) : null}
                {page ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => addChip(threadId, pageChip(page))}
                    >
                      <AppWindow />
                      <span className="truncate">
                        Attach the page {page.name}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuCheckboxItem
                      checked={attachShot}
                      onCheckedChange={onAttachShot}
                    >
                      <Camera />
                      Attach a screenshot of the page
                    </DropdownMenuCheckboxItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={() => picker.current?.click()}>
            <FilePlus />
            Attach pictures or files…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FilesInput
        onFiles={(picked) => attachFiles(threadId, picked)}
        ref={picker}
      />
    </>
  );
};

/** Why a prompt didn't go, under the composer on a red tint, with the draft kept to try again. */
const SendFailed = ({
  busy,
  message,
  onRetry,
}: {
  busy: boolean;
  message: string;
  onRetry: () => void;
}) => (
  <div
    className="flex items-start gap-2 rounded-lg bg-destructive/10 py-1 pr-1 pl-3 text-destructive"
    role="alert"
  >
    <span className="min-w-0 flex-1 py-1 font-body-small">{message}</span>
    <Button disabled={busy} onClick={onRetry} size="sm" variant="ghost">
      Try again
    </Button>
  </div>
);

/**
 * What was sent while the agent worked, waiting for its turn to end, oldest first. Each goes when
 * a turn ends by itself; after one that was stopped or failed they wait for Send now. Edit puts
 * one back in the composer, its text over what is typed there and its attachments beside the
 * draft's (`overDraft`).
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
      <div className="flex min-h-6 items-center gap-2 font-body-small text-muted-foreground">
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
            <CutText className="min-w-0 flex-1 truncate font-body" tip={q.text}>
              {q.text}
              {q.attachments.length > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {q.attachments.length} attached
                </span>
              ) : null}
            </CutText>
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

/** The thread's header names its agent, so the prompt's placeholder says what to write. */
const placeholderOf = (running: boolean) =>
  running ? "Queue a follow-up…" : "Describe a change, or type / for commands…";

/**
 * Send; while the agent works, Stop, and Queue beside it once there is something to queue. One
 * button at the composer's corner in each case, so the pickers keep their width. Send is never
 * drawn off: with nothing typed it puts the caret in the prompt, and while a prompt goes (its
 * screenshot taken, the request on its way) it spins.
 */
const SendButtons = ({
  busy,
  canSend,
  onSend,
  onStop,
  running,
}: {
  busy: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
}) => {
  const label = running ? "Queue" : "Send";
  let icon = running ? <ListPlus /> : <ArrowUp />;
  if (busy) {
    icon = <Spinner />;
  }
  return (
    <>
      {running ? <StopButton onStop={onStop} /> : null}
      {running && !(canSend || busy) ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-busy={busy}
                aria-label={label}
                onClick={onSend}
                size="icon"
              />
            }
          >
            {icon}
          </TooltipTrigger>
          <TooltipContent>
            {label} <SendKeyHint />
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
  if (chip.kind === "text") {
    return `${chip.name} · ${sizeLabel(chip.size)}`;
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

/** The icon a chip leads with: a page, a component, an element, a board's pick, a file. */
const ChipIcon = ({ chip, component }: { chip: Chip; component: boolean }) => {
  if (chip.kind === "board") {
    return <BoardIcon chip={chip} />;
  }
  if (chip.kind === "text") {
    return <FileText />;
  }
  if (chip.kind === "page") {
    return <AppWindow />;
  }
  return component ? <Component /> : <SquareDashedMousePointer />;
};

const isImage = (chip: Chip): chip is ImageChip => chip.kind === "image";

/**
 * An attachment of the next prompt: a raised tag with its icon, an element, a component, a page
 * or a board's pick, its whole name and file in its tooltip. The context sent because nothing was
 * attached (the selection) is dashed, and removing it keeps it out of this prompt.
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
  return (
    <ChipTag
      icon={<ChipIcon chip={chip} component={component} />}
      implicit={implicit}
      name={chip.kind === "board" ? boardChipLabel(chip) : chip.name}
      onRemove={onRemove}
      tip={
        implicit
          ? `${chipTitle(chip)}, sent with the prompt as it is selected`
          : chipTitle(chip)
      }
    />
  );
};
