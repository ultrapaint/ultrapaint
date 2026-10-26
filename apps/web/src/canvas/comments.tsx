import type { Comment, CommentReply } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";
import { cn } from "cn";
import {
  ArrowUp,
  Check,
  CircleCheck,
  Cog,
  Pencil,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Segmented } from "../components/segmented.tsx";
import {
  deleteComment,
  deleteReply,
  postDraft,
  replyTo,
  startComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor, useInv } from "../state/editor.ts";
import { bridgeFor } from "./bridge.ts";
import { SendToAgent } from "./send-to-agent.tsx";

/** The pin's shape as a cursor: its point, bottom left, is where the comment lands. */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21V12a9 9 0 1 1 9 9Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
export const commentCursor = `url("data:image/svg+xml,${encodeURIComponent(PIN_SVG)}") 3 21, crosshair`;

export const initialOf = (author: string | null) =>
  (author?.trim()[0] ?? "?").toUpperCase();

const timeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const repliesLabel = (count: number) =>
  count === 1 ? "1 reply" : `${count} replies`;

/** "3 minutes ago", "yesterday": how long ago a comment was written. */
export const relativeTime = (at: number, now = Date.now()) => {
  const seconds = Math.round((at - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return timeFormat.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

/**
 * Starts a comment where a page was clicked, then pins it on the innermost element there once
 * the preview has said which that is. `frame` is the preview the page is drawn in.
 */
export const placeComment = async (
  frame: string,
  pageId: string,
  at: { x: number; y: number }
) => {
  const draft = startComment(pageId, at);
  const id = (await bridgeFor(frame).hitTest(draft.x, draft.y)).at(-1);
  const node = id
    ? nodeIn(
        useDocuments.getState().docs,
        useEditor.getState().canvas,
        pageId,
        id
      )
    : null;
  // Only if the draft is still this one: another click may have moved it meanwhile.
  if (node && useComments.getState().draft === draft) {
    startComment(pageId, at, node);
  }
};

// The card and the pins take their own pointer events: the canvas must not start a drag, and
// the frame under them must not pick an element.
const stop = (e: ReactPointerEvent) => e.stopPropagation();

/**
 * Pins, the open card and the comment being written, for one page. Drawn in the page's own
 * pixels and scaled back by `inv` so they keep their size at any zoom.
 */
export const FrameComments = ({
  inv: own,
  page,
}: {
  /** The prototype's own scale; on the canvas, the canvas's zoom. */
  inv?: number;
  page: Page;
}) => {
  const canvasInv = useInv();
  const inv = own ?? canvasInv;
  const visible = useComments((s) => s.visible);
  const open = useComments((s) => s.open);
  const draft = useComments((s) =>
    s.draft?.pageId === page.id ? s.draft : null
  );
  const all = useComments((s) => s.comments);
  if (!visible) {
    return null;
  }
  // A resolved comment is gone from the canvas, unless the panel asked to show it.
  const shown = all.filter(
    (c) => c.page === page.path && (!c.resolved || c.id === open)
  );
  return (
    <>
      {shown.map((comment) => (
        <Anchor inv={inv} key={comment.id} x={comment.x} y={comment.y}>
          <Pin comment={comment} open={comment.id === open} />
          {comment.id === open ? <Card comment={comment} /> : null}
        </Anchor>
      ))}
      {draft ? (
        <Anchor inv={inv} x={draft.x} y={draft.y}>
          <span className="absolute bottom-0 left-0 flex size-7 items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-brand shadow-black/40 shadow-md" />
          <Composer />
        </Anchor>
      ) : null}
    </>
  );
};

/** A point of the page that what it holds is drawn from, at screen size. */
const Anchor = ({
  x,
  y,
  inv,
  children,
}: {
  x: number;
  y: number;
  inv: number;
  children: ReactNode;
}) => (
  <div
    className="absolute z-10 size-0"
    style={{
      left: x,
      top: y,
      transform: `scale(${inv})`,
      transformOrigin: "0 0",
    }}
  >
    {children}
  </div>
);

/** What a pin shows: a tick once resolved, a cog on a behaviour note, the author's initial. */
const PinMark = ({ comment }: { comment: Comment }) => {
  if (comment.resolved) {
    return <Check className="size-3" />;
  }
  return comment.kind === "behaviour" ? (
    <Cog className="size-3" />
  ) : (
    initialOf(comment.author)
  );
};

/** The comment's mark on the page. Hovering it previews the text; clicking opens the card. */
const Pin = ({ comment, open }: { comment: Comment; open: boolean }) => {
  const toggle = () => useComments.getState().setOpen(open ? null : comment.id);
  return (
    <button
      aria-label={`Comment by ${comment.author ?? "someone"}: ${comment.text}`}
      className={cn(
        // At rest a teardrop around the avatar. The preview opens into a card with the same
        // sharp corner on the spot, rounded like the card rather than stretched into a pill.
        "group absolute bottom-0 left-0 flex min-h-7 w-max min-w-7 cursor-pointer items-center gap-2 rounded-[14px] rounded-bl-none border-2 border-white bg-sidebar p-0.5 text-sidebar-foreground shadow-black/40 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open
          ? "bg-brand text-brand-foreground"
          : "hover:items-start hover:rounded-xl hover:rounded-bl-none hover:py-1.5 hover:pr-3 hover:pl-1.5",
        comment.resolved && "opacity-60"
      )}
      onClick={toggle}
      onContextMenu={(e) =>
        openMenuAt(e, { commentId: comment.id, kind: "comment" })
      }
      onPointerDown={stop}
      type="button"
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full bg-brand font-body font-semibold text-brand-foreground leading-4",
          comment.kind === "behaviour" && "rounded-sm bg-component",
          open && "bg-brand-foreground text-brand"
        )}
      >
        <PinMark comment={comment} />
      </span>
      {open ? null : (
        <span className="hidden max-w-56 flex-col items-start gap-0.5 text-left font-body leading-4 group-hover:flex">
          <span className="font-medium">
            {comment.kind === "behaviour"
              ? "Behaviour note"
              : (comment.author ?? "Comment")}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {relativeTime(comment.createdAt)}
              {comment.replies.length > 0
                ? ` · ${repliesLabel(comment.replies.length)}`
                : ""}
            </span>
          </span>
          <span className="line-clamp-2 whitespace-pre-wrap">
            {comment.text}
          </span>
        </span>
      )}
    </button>
  );
};

const cardClass =
  "absolute top-[-28px] left-9 flex w-80 cursor-default flex-col gap-2 rounded-lg border bg-popover p-2.5 text-popover-foreground font-body shadow-black/40 shadow-xl";

/** The open comment, beside its pin: read, edit, resolve or delete it without leaving the page. */
const Card = ({ comment }: { comment: Comment }) => {
  const [editing, setEditing] = useState(false);
  const close = () => useComments.getState().setOpen(null);
  const toggleResolved = () =>
    updateComment(comment.id, { resolved: !comment.resolved });
  const remove = async () => {
    const ok = await confirmDialog({
      confirmLabel: "Delete",
      description: "The comment is removed for everyone.",
      destructive: true,
      title: "Delete this comment?",
    });
    if (ok) {
      deleteComment(comment.id);
    }
  };
  const save = (text: string) => {
    setEditing(false);
    if (text.trim() && text.trim() !== comment.text) {
      updateComment(comment.id, { text });
    }
  };
  return (
    <div className={cardClass} onPointerDown={stop}>
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand font-body font-semibold text-brand-foreground leading-4">
          {initialOf(comment.author)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">
            {comment.author ?? "Someone"}
          </span>
          <span className="font-body text-muted-foreground">
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        <SendToAgent comment={comment} />
        <IconButton
          onClick={toggleResolved}
          size="icon-sm"
          tooltip={comment.resolved ? "Reopen" : "Resolve"}
        >
          {comment.resolved ? <Undo2 /> : <CircleCheck />}
        </IconButton>
        <IconButton
          onClick={() => setEditing(true)}
          size="icon-sm"
          tooltip="Edit"
        >
          <Pencil />
        </IconButton>
        <IconButton onClick={remove} size="icon-sm" tooltip="Delete">
          <Trash2 />
        </IconButton>
        <IconButton onClick={close} size="icon-sm" tooltip="Close">
          <X />
        </IconButton>
      </div>
      {comment.element ? (
        <span className="self-start rounded bg-muted px-1.5 py-0.5 font-code text-muted-foreground">
          {`<${comment.element}>`}
        </span>
      ) : null}
      {editing ? (
        <TextInput
          initial={comment.text}
          onCancel={() => setEditing(false)}
          onSubmit={save}
          submitLabel="Save"
        />
      ) : (
        <CommentText comment={comment} />
      )}
      {comment.replies.length > 0 ? (
        // The canvas leaves the wheel alone over this, so a long thread scrolls.
        <div
          className="-mx-2.5 flex max-h-72 flex-col gap-2.5 overflow-y-auto border-t px-2.5 pt-2.5"
          data-canvas-scroll
        >
          {comment.replies.map((reply) => (
            <Reply comment={comment} key={reply.id} reply={reply} />
          ))}
        </div>
      ) : null}
      <ReplyInput commentId={comment.id} />
    </div>
  );
};

/** The first comment's text. In a thread it can go to an agent alone, as a reply can. */
const CommentText = ({ comment }: { comment: Comment }) =>
  comment.replies.length > 0 ? (
    <div className="group/root flex items-start gap-1.5">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {comment.text}
      </p>
      <SendToAgent
        className="-my-0.5 hidden group-hover/root:flex aria-expanded:flex"
        comment={comment}
        single
        small
      />
    </div>
  ) : (
    <p className="whitespace-pre-wrap break-words">{comment.text}</p>
  );

/** One answer in the thread, sent to an agent or deleted from its own row. */
const Reply = ({
  comment,
  reply,
}: {
  comment: Comment;
  reply: CommentReply;
}) => (
  <div className="group/reply flex gap-2">
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-body font-semibold text-foreground leading-4">
      {initialOf(reply.author)}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex h-5 items-center gap-1.5">
        <span className="truncate font-medium">
          {reply.author ?? "Someone"}
        </span>
        <span className="flex-1 truncate font-body text-muted-foreground">
          {relativeTime(reply.createdAt)}
        </span>
        <SendToAgent
          className="hidden group-hover/reply:flex aria-expanded:flex"
          comment={comment}
          reply={reply}
          small
        />
        <IconButton
          className="hidden group-hover/reply:flex"
          onClick={() => deleteReply(comment.id, reply.id)}
          size="icon-xs"
          tooltip="Delete reply"
        >
          <Trash2 />
        </IconButton>
      </div>
      <p className="whitespace-pre-wrap break-words">{reply.text}</p>
    </div>
  </div>
);

/**
 * Answers the thread from the card itself. Enter sends and Shift+Enter breaks the line; Escape
 * closes the card, as it does anywhere else on the canvas.
 */
const ReplyInput = ({ commentId }: { commentId: string }) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim() || sending) {
      return;
    }
    setSending(true);
    if (await replyTo(commentId, text)) {
      setText("");
    }
    setSending(false);
  };
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) =>
    setText(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      useComments.getState().setOpen(null);
    }
  };
  return (
    <div className="relative">
      <Textarea
        aria-label="Reply"
        autoFocus
        className="max-h-32 min-h-8 py-1.5 pr-9"
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Reply"
        rows={1}
        value={text}
      />
      <IconButton
        className="absolute right-1 bottom-1"
        disabled={!text.trim() || sending}
        onClick={send}
        size="icon-sm"
        tooltip="Send"
        variant="default"
      >
        <ArrowUp />
      </IconButton>
    </div>
  );
};

/**
 * Where a new comment is written, next to the spot it was placed on: a comment on the design, or
 * a behaviour note (ADR 0030), what the code must do that the design cannot show.
 */
const Composer = () => {
  const cancel = () => useComments.getState().setDraft(null);
  const [kind, setKind] = useState<"comment" | "behaviour">("comment");
  return (
    <div className={cardClass} onPointerDown={stop}>
      <Segmented
        onChange={setKind}
        options={[
          { label: "Comment", value: "comment" as const },
          {
            label: "Behaviour note",
            title:
              "What the code must do that the design cannot show: it goes to the code when the page is implemented",
            value: "behaviour" as const,
          },
        ]}
        value={kind}
      />
      <TextInput
        onCancel={cancel}
        onSubmit={(text) => postDraft(text, kind)}
        placeholder={
          kind === "behaviour"
            ? "Only admins can delete; disabled until the form is valid…"
            : "Add a comment"
        }
        submitLabel="Post"
      />
    </div>
  );
};

/** Enter submits and Shift+Enter breaks the line; Escape gives up. */
const TextInput = ({
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
  placeholder?: string;
  submitLabel: string;
}) => {
  const [text, setText] = useState(initial);
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) =>
    setText(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(text);
    }
    if (e.key === "Escape") {
      // The window's Escape would close the card as well.
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        className="max-h-40 min-h-14"
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        value={text}
      />
      <div className="flex justify-end gap-1">
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={!text.trim()}
          onClick={() => onSubmit(text)}
          size="sm"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};
