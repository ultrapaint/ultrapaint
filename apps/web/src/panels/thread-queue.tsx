/**
 * The prompts queued while the agent works (ADR 0137), at the end of the chat: each a dashed,
 * unfilled bubble (not sent yet) with Send now, Edit and Remove under it, in view at rest. Send
 * now puts it into the agent's turn, in place of a review round, or starts a turn with it; Edit
 * opens it in the composer, the whole queue waiting meanwhile; a grip drags it to another place.
 * Past three, the first two show and the rest fold.
 */
import {
  isBusy,
  isStopping,
  type QueuedPrompt,
  type Thread,
} from "@ultrapaint/contracts/threads";
import { ArrowUp, ChevronDown, GripVertical, Pencil, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import {
  cancelQueuedEdit,
  editQueued,
  lostQueuedEdit,
  useQueuedEdit,
} from "../state/queued-edit.ts";

/** How many prompts show before the rest fold, and how many show then. */
const SHOWN = 3;
const FOLDED_TO = 2;

/** Sends a queued prompt now: into the turn, in place of the review, or as a turn of its own. */
export const sendNow = (threadId: string, id?: string) =>
  api().request("threads.sendQueued", { id, threadId }).catch(reportError);

/** What Send now does, said in its tooltip. */
const sendNowTip = (thread: Thread) => {
  if (thread.status === "reviewing") {
    return "Stop the review and send this";
  }
  return isBusy(thread.status)
    ? "Send into the running turn"
    : "Start a turn with this prompt";
};

const Thumbs = ({ queued }: { queued: QueuedPrompt }) => {
  const pictures = queued.attachments.flatMap((a) =>
    a.kind === "image" ? [a] : []
  );
  if (pictures.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1 pt-1.5">
      {pictures.map((p) => (
        <img
          alt={p.name}
          className="size-8 rounded-sm border object-cover"
          height={32}
          key={p.name}
          src={p.dataUrl}
          width={32}
        />
      ))}
    </div>
  );
};

/** Edit, then Remove: what any queued prompt not being edited here offers. */
const EditAndRemove = ({
  queued,
  threadId,
}: {
  queued: QueuedPrompt;
  threadId: string;
}) => (
  <>
    <IconButton
      className="text-muted-foreground"
      label="Edit queued prompt"
      onClick={() => editQueued(threadId, queued.id)}
      size="icon-sm"
      tooltip="Edit in the composer"
    >
      <Pencil />
    </IconButton>
    <IconButton
      className="text-muted-foreground"
      label="Remove queued prompt"
      onClick={() =>
        api()
          .request("threads.unqueue", { id: queued.id, threadId })
          .catch(reportError)
      }
      size="icon-sm"
      tooltip="Remove from queue"
    >
      <X />
    </IconButton>
  </>
);

/** A line under a bubble saying what is happening to it, at the size of its actions. */
const Note = ({ children }: { children: string }) => (
  <span className="flex h-6 items-center font-body text-muted-foreground">
    {children}
  </span>
);

/**
 * What is under a bubble: its actions, or what is happening to it. Being edited here, Cancel; being
 * edited in a window that no longer has it open (closed, reloaded), Cancel lets the queue go on
 * and Edit takes it into this composer, so an edit never holds the queue out of reach.
 */
const Actions = ({
  canSend,
  editingHere,
  queued,
  thread,
}: {
  canSend: boolean;
  editingHere: boolean;
  queued: QueuedPrompt;
  thread: Thread;
}) => {
  if (editingHere || queued.editing) {
    return (
      <>
        <Note>{editingHere ? "Editing in the composer" : "Being edited"}</Note>
        <Button
          aria-label="Cancel editing the queued prompt"
          className="text-muted-foreground"
          onClick={() =>
            editingHere
              ? cancelQueuedEdit(thread.id)
              : api()
                  .request("threads.editQueued", {
                    edit: { action: "cancel" },
                    id: queued.id,
                    threadId: thread.id,
                  })
                  .catch(reportError)
          }
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
        {editingHere ? null : (
          <IconButton
            className="text-muted-foreground"
            label="Edit queued prompt"
            onClick={() => editQueued(thread.id, queued.id)}
            size="icon-sm"
            tooltip="Edit in the composer"
          >
            <Pencil />
          </IconButton>
        )}
      </>
    );
  }
  if (queued.steering) {
    return (
      <>
        <Note>Steer · waiting to be read</Note>
        <EditAndRemove queued={queued} threadId={thread.id} />
      </>
    );
  }
  return (
    <>
      {canSend ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="text-muted-foreground"
                onClick={() => sendNow(thread.id, queued.id)}
                size="sm"
                variant="ghost"
              />
            }
          >
            <ArrowUp data-icon="inline-start" />
            Send now
          </TooltipTrigger>
          <TooltipContent>{sendNowTip(thread)}</TooltipContent>
        </Tooltip>
      ) : null}
      <EditAndRemove queued={queued} threadId={thread.id} />
    </>
  );
};

export const QueuedPrompts = ({ thread }: { thread: Thread }) => {
  const queued = thread.queued ?? [];
  const edit = useQueuedEdit(thread.id);
  const [all, setAll] = useState(false);
  /** The prompt being dragged, while one is. */
  const [dragging, setDragging] = useState<string | null>(null);
  // The prompt being edited left the queue some other way: the composer is told.
  const editedId = edit?.id;
  const stillQueued = queued.some((q) => q.id === editedId);
  useEffect(() => {
    if (editedId !== undefined && !stillQueued) {
      lostQueuedEdit(thread.id);
    }
  }, [editedId, stillQueued, thread.id]);
  if (queued.length === 0) {
    return null;
  }
  const canSend = !isStopping(thread.status);
  const folded = queued.length > SHOWN && !all;
  const shown = folded ? queued.slice(0, FOLDED_TO) : queued;
  const move = (id: string, before: string | null) =>
    api()
      .request("threads.moveQueued", { before, id, threadId: thread.id })
      .catch(reportError);
  /**
   * A prompt let go on another: before it when dropped on its upper half, after it on its lower,
   * so the end of the queue can be reached too.
   */
  const dropOn = (e: DragEvent<HTMLLIElement>, index: number) => {
    const id = dragging;
    setDragging(null);
    const target = queued[index];
    if (id === null || !target || id === target.id) {
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    const before = after ? (queued[index + 1]?.id ?? null) : target.id;
    if (before !== id) {
      move(id, before);
    }
  };
  /** ⌥↑ and ⌥↓ on a grip move its prompt a place. */
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) {
      return;
    }
    e.preventDefault();
    const id = queued[index]?.id;
    if (id === undefined) {
      return;
    }
    if (e.key === "ArrowUp" && index > 0) {
      move(id, queued[index - 1]?.id ?? null);
    } else if (e.key === "ArrowDown" && index < queued.length - 1) {
      move(id, queued[index + 2]?.id ?? null);
    }
  };
  return (
    <section
      aria-label={
        queued.length === 1
          ? "1 queued prompt"
          : `${queued.length} queued prompts`
      }
      className="flex flex-col items-end gap-3"
    >
      <ol className="flex w-full flex-col gap-4">
        {shown.map((q, index) => {
          const editingHere = q.id === editedId;
          return (
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the drop target of a drag; the grip is the row's control
            <li
              aria-label={`Queued prompt ${index + 1} of ${queued.length}, not sent`}
              className={cn(
                "group/queued flex flex-col items-end gap-0.5 pl-8",
                dragging === q.id && "opacity-50"
              )}
              key={q.id}
              onDragOver={(e) => {
                if (dragging !== null) {
                  e.preventDefault();
                }
              }}
              onDrop={(e) => dropOn(e, index)}
            >
              <div className="relative max-w-full">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        aria-label="Move queued prompt"
                        className="absolute top-1 -left-7 flex size-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 pointer-coarse:opacity-100 outline-none transition-opacity duration-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/queued:opacity-100"
                        draggable
                        onDragEnd={() => setDragging(null)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", q.text);
                          setDragging(q.id);
                        }}
                        onKeyDown={(e) => onGripKey(e, index)}
                        type="button"
                      />
                    }
                  >
                    <GripVertical className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>Drag to reorder, or ⌥↑ ⌥↓</TooltipContent>
                </Tooltip>
                <div
                  className={cn(
                    "rounded-lg border border-foreground/25 border-dashed px-3 py-2 font-body",
                    editingHere && "border-ring border-solid"
                  )}
                >
                  <p className="line-clamp-4 select-text whitespace-pre-wrap break-words">
                    {q.text}
                  </p>
                  <Thumbs queued={q} />
                </div>
              </div>
              <div className="-mr-1 flex items-center gap-0.5">
                <Actions
                  canSend={canSend}
                  editingHere={editingHere}
                  queued={q}
                  thread={thread}
                />
              </div>
            </li>
          );
        })}
      </ol>
      {queued.length > SHOWN ? (
        <Button
          className="text-muted-foreground"
          onClick={() => setAll((a) => !a)}
          size="sm"
          variant="ghost"
        >
          {all ? "Show fewer" : `Show all ${queued.length} queued`}
          <ChevronDown
            className={cn("transition-transform", all && "rotate-180")}
            data-icon="inline-end"
          />
        </Button>
      ) : null}
    </section>
  );
};
