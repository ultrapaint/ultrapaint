import type { Comment, CommentReply } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  ArrowUp,
  Check,
  CircleCheck,
  Cog,
  Ellipsis,
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
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Segmented } from "../components/segmented.tsx";
import { initialsOf } from "../lib/initials.ts";
import {
  type CommentDraft,
  type CommentLayout,
  commentFrame,
  commentLayoutOf,
  deleteComment,
  deleteReply,
  hasSpot,
  holdsCard,
  postDraft,
  replyTo,
  startComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { drawnRootOf, nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { useProject } from "../state/project.ts";
import { UNZOOM } from "./camera.ts";
import { frameOf } from "./editor-frame.ts";
import { SendToAgent } from "./send-to-agent.tsx";

/** The pin's shape as a cursor: its point, bottom left, is where the comment lands. */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21V12a9 9 0 1 1 9 9Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
export const commentCursor = `url("data:image/svg+xml,${encodeURIComponent(PIN_SVG)}") 3 21, crosshair`;

/** A tick once resolved, a cog on a behaviour note, else the author's initials. */
const AvatarMark = ({
  comment,
}: {
  comment: {
    author: string | null;
    kind?: Comment["kind"];
    resolved?: boolean;
  };
}) => {
  if (comment.resolved) {
    return <Check className="size-3.5" />;
  }
  return comment.kind === "behaviour" ? (
    <Cog className="size-3.5" />
  ) : (
    initialsOf(comment.author)
  );
};

/**
 * The round mark of who wrote a comment, or a behaviour note's cog in a rounded square: the
 * panel's list, the card and the pin all carry it. `inverse` is the pin's: it stands out on any
 * design under it.
 */
export const CommentAvatar = ({
  className,
  comment,
  inverse = false,
}: {
  className?: string;
  comment: {
    author: string | null;
    kind?: Comment["kind"];
    resolved?: boolean;
  };
  inverse?: boolean;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex size-6 shrink-0 items-center justify-center rounded-full font-body-small-medium",
      inverse
        ? "bg-foreground text-background"
        : "bg-secondary text-secondary-foreground",
      comment.kind === "behaviour" && "rounded-md",
      className
    )}
  >
    <AvatarMark comment={comment} />
  </span>
);

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
 * Starts a comment where a frame was clicked: on a page's frame, one of its views or the
 * prototype's (which `pageId` says the page of), pinned on the innermost element there; on a node's
 * beside the pages, pinned on that node, which it moves with as long as the node is there
 * (ADR 0097).
 */
export const placeComment = (
  frame: string,
  at: { x: number; y: number },
  pageId?: string
) => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  if (frameRefOf(frame).kind === "node") {
    startComment(frame, at, drawnRootOf(docs, canvas, frame));
    return;
  }
  // The prototype's frame is no frame of the canvas: the nodes it draws are the page's.
  const pageFrame = pageId ?? frame;
  const id = frameOf(frame).hitTest(Math.round(at.x), Math.round(at.y)).at(-1);
  const node = id ? nodeIn(docs, canvas, pageFrame, id) : null;
  startComment(frame, at, node, pageId);
};

/** Starts a comment at a point of the canvas itself, on no page and no node (ADR 0097). */
export const placeCanvasComment = (at: { x: number; y: number }) =>
  startComment(null, at);

// The card and the pins take their own pointer events: the canvas must not start a drag, and
// the frame under them must not pick an element.
const stop = (e: ReactPointerEvent) => e.stopPropagation();

/** The open canvas's comment layout, kept up with its pages, their views and its nodes. */
const useCommentLayout = (): CommentLayout => {
  const canvas = useEditor((s) => s.canvas);
  const frames = useEditor((s) => s.frames);
  const docs = useDocuments((s) => s.docs);
  const pages = useProject((s) => s.pages);
  return useMemo(
    () => commentLayoutOf(canvas, pages, frames, docs),
    [canvas, pages, frames, docs]
  );
};

/**
 * The comments one frame of the page canvas draws, or the canvas itself (`frameId` null): each
 * comment is drawn in one place alone (`commentFrame`), and so is the one being written.
 */
export const FrameComments = ({ frameId }: { frameId: string | null }) => {
  const layout = useCommentLayout();
  const all = useComments((s) => s.comments);
  const draft = useComments((s) =>
    s.draft?.frame === frameId ? s.draft : null
  );
  const comments = useMemo(
    () => all.filter((c) => commentFrame(c, layout) === frameId),
    [all, layout, frameId]
  );
  return (
    <CommentPins
      comments={comments}
      draft={draft}
      frameId={frameId ?? undefined}
    />
  );
};

/**
 * How high what holds the open card, or the comment being written, stacks on the page canvas: over
 * the frames, their selection, every pin (`Anchor`, `z-20` at most) and a frame's outline drawn
 * past its edges (`SelectionChrome`, `z-30`), which all rise out of a frame that is not lifted
 * (ADR 0097).
 */
export const CARD_LIFT = 40;

/**
 * The comments of the canvas itself, beside the pages (ADR 0097), in the canvas's own pixels.
 * Their pins stack among the frames' as theirs do; while one of them is open or being written,
 * the card is over everything.
 */
export const CanvasComments = () => {
  const lifted = useComments((s) => holdsCard(s, null));
  return (
    <div
      className="absolute top-0 left-0 size-0"
      style={lifted ? { zIndex: CARD_LIFT } : undefined}
    >
      <FrameComments frameId={null} />
    </div>
  );
};

/** The comments of the page the prototype shows, from whichever of its frames they were left in. */
export const PrototypeComments = ({
  frameId,
  inv,
  page,
}: {
  frameId: string;
  inv: number;
  page: Page;
}) => {
  const all = useComments((s) => s.comments);
  // The prototype's one frame shows every page in turn: a draft is drawn on the page it was begun on.
  const draft = useComments((s) =>
    s.draft?.frame === frameId && s.draft.pageId === page.id ? s.draft : null
  );
  const comments = useMemo(
    () => all.filter((c) => c.page === page.path),
    [all, page.path]
  );
  return <CommentPins comments={comments} draft={draft} inv={inv} />;
};

/**
 * Pins, the open card and the comment being written, for one place: drawn in its own pixels and
 * scaled back by `inv` so they keep their size at any zoom.
 */
const CommentPins = ({
  comments,
  draft,
  frameId,
  inv,
}: {
  /** The comments of the place, resolved ones and ones without a spot included. */
  comments: readonly Comment[];
  draft: CommentDraft | null;
  /** The frame drawn in, whose elements' places a note without a spot is drawn at. */
  frameId?: string;
  /** The prototype's own scale; on the canvas, the canvas's zoom (`--inv`). */
  inv?: number;
}) => {
  const visible = useComments((s) => s.visible);
  const open = useComments((s) => s.open);
  const rects = useEditor((s) =>
    frameId === undefined ? undefined : s.rects[frameId]
  );
  if (!visible) {
    return null;
  }
  // A resolved comment is gone from the canvas, and one without a spot is the page's own, in its
  // toolbar (ADR 0085): either is drawn only while its card is open.
  const shown = comments.filter(
    (c) => (!c.resolved && hasSpot(c)) || c.id === open
  );
  return (
    <>
      {shown.map((comment) => {
        // A note without a spot, open, is drawn at its element when it has one, else the corner.
        const at =
          !hasSpot(comment) && comment.nodeId !== null
            ? rects?.[comment.nodeId]
            : undefined;
        return (
          <Anchor
            inv={inv}
            key={comment.id}
            raised={comment.id === open}
            x={at?.x ?? comment.x}
            y={at?.y ?? comment.y}
          >
            <Pin comment={comment} open={comment.id === open} />
            {comment.id === open ? <Card comment={comment} /> : null}
          </Anchor>
        );
      })}
      {draft ? (
        <Anchor inv={inv} raised x={draft.x} y={draft.y}>
          <span className={cn(PIN, "size-8 bg-primary")} />
          <Composer onPage={draft.pageId !== null} />
        </Anchor>
      ) : null}
    </>
  );
};

/**
 * A point of the page that what it holds is drawn from, at screen size. The open card and a pin
 * the pointer is over sit above the other pins.
 */
const Anchor = ({
  x,
  y,
  inv,
  raised = false,
  children,
}: {
  x: number;
  y: number;
  inv: number | undefined;
  raised?: boolean;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "absolute size-0",
      raised ? "z-20" : "z-10 has-[:hover]:z-20"
    )}
    style={{
      left: x,
      top: y,
      transform: inv === undefined ? UNZOOM : `scale(${inv})`,
      transformOrigin: "0 0",
    }}
  >
    {children}
  </div>
);

/**
 * A pin's teardrop, its point at the spot it was left on: a surface of the chrome over the design,
 * lifted off it as a popover is, so it reads on any page.
 */
const PIN =
  "absolute bottom-0 left-0 rounded-full rounded-bl-none shadow-overlay ring-1 ring-black/10 dark:ring-white/10";

/** The comment's mark on the page. Hovering it previews the text; clicking opens the card. */
const Pin = ({ comment, open }: { comment: Comment; open: boolean }) => {
  const toggle = () => useComments.getState().setOpen(open ? null : comment.id);
  return (
    <button
      aria-label={`Comment by ${comment.author ?? "someone"}: ${comment.text}`}
      className={cn(
        // At rest a teardrop around the avatar. The preview opens into a card with the same
        // sharp corner on the spot, rounded like the card rather than stretched into a pill.
        PIN,
        "group flex min-h-8 w-max min-w-8 cursor-pointer items-center gap-2 p-1 text-popover-foreground outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring",
        open
          ? "bg-primary"
          : "bg-popover hover:items-start hover:rounded-xl hover:rounded-bl-none hover:p-2 hover:pr-3",
        comment.resolved && "opacity-60"
      )}
      onClick={toggle}
      onContextMenu={(e) =>
        openMenuAt(e, { commentId: comment.id, kind: "comment" })
      }
      onPointerDown={stop}
      type="button"
    >
      <CommentAvatar
        className={cn(open && "bg-primary-foreground text-primary")}
        comment={comment}
        inverse
      />
      {open ? null : (
        <span className="hidden max-w-56 flex-col items-start gap-0.5 text-left group-hover:flex">
          <span className="flex h-6 items-center gap-1.5">
            <span className="truncate font-body-medium">
              {comment.kind === "behaviour"
                ? "Behaviour note"
                : (comment.author ?? "Someone")}
            </span>
            <span className="shrink-0 font-body-small text-muted-foreground">
              {relativeTime(comment.createdAt)}
              {comment.replies.length > 0
                ? ` · ${repliesLabel(comment.replies.length)}`
                : ""}
            </span>
          </span>
          <span className="line-clamp-2 whitespace-pre-wrap font-body">
            {comment.text}
          </span>
        </span>
      )}
    </button>
  );
};

const cardClass =
  "absolute top-[-32px] left-10 flex w-[22rem] cursor-default flex-col gap-3 rounded-lg bg-popover p-3 font-body text-popover-foreground shadow-overlay ring-1 ring-border";

/** The open comment, beside its pin: read, edit, resolve or delete it without leaving the page. */
const Card = ({ comment }: { comment: Comment }) => {
  const [editing, setEditing] = useState(false);
  const close = () => useComments.getState().setOpen(null);
  const toggleResolved = () =>
    updateComment(comment.id, { resolved: !comment.resolved });
  const remove = async () => {
    const ok = await confirmDialog({
      confirmLabel: "Delete comment",
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
        <CommentAvatar
          comment={{ author: comment.author, kind: comment.kind }}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <CutText className="truncate font-body-medium">
            {comment.kind === "behaviour"
              ? "Behaviour note"
              : (comment.author ?? "Someone")}
          </CutText>
          <span className="shrink-0 font-body-small text-muted-foreground">
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        <div className="-mr-1 flex shrink-0 items-center text-muted-foreground">
          <SendToAgent comment={comment} />
          <IconButton
            onClick={toggleResolved}
            size="icon-sm"
            tooltip={comment.resolved ? "Reopen" : "Resolve"}
          >
            {comment.resolved ? <Undo2 /> : <CircleCheck />}
          </IconButton>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="More"
                        size="icon-sm"
                        variant="ghost"
                      />
                    }
                  />
                }
              >
                <Ellipsis />
              </TooltipTrigger>
              <TooltipContent>More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={remove} variant="destructive">
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton onClick={close} size="icon-sm" tooltip="Close">
            <X />
          </IconButton>
        </div>
      </div>
      <div className="-mt-2 flex flex-col gap-1 pl-8">
        {comment.element ? (
          <span className="truncate font-code text-muted-foreground">
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
      </div>
      {comment.replies.length > 0 ? (
        // The canvas leaves the wheel alone over this, so a long thread scrolls.
        <div
          className="-mx-3 flex max-h-72 flex-col gap-3 overflow-y-auto px-3"
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
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words font-body">
        {comment.text}
      </p>
      <SendToAgent
        className="hidden text-muted-foreground group-hover/root:flex aria-expanded:flex"
        comment={comment}
        single
        small
      />
    </div>
  ) : (
    <p className="whitespace-pre-wrap break-words font-body">{comment.text}</p>
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
    <CommentAvatar comment={{ author: reply.author }} />
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-6 items-center gap-1.5">
        <span className="truncate font-body-medium">
          {reply.author ?? "Someone"}
        </span>
        <span className="flex-1 truncate font-body-small text-muted-foreground">
          {relativeTime(reply.createdAt)}
        </span>
        <SendToAgent
          className="hidden text-muted-foreground group-hover/reply:flex aria-expanded:flex"
          comment={comment}
          reply={reply}
          small
        />
        <IconButton
          className="hidden text-muted-foreground group-hover/reply:flex"
          onClick={() => deleteReply(comment.id, reply.id)}
          size="icon-xs"
          tooltip="Delete reply"
        >
          <Trash2 />
        </IconButton>
      </div>
      <p className="whitespace-pre-wrap break-words font-body">{reply.text}</p>
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
        className="max-h-32 min-h-8 py-1.5 pr-9 font-body"
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
 * Where a new comment is written, next to the spot it was placed on: a comment on the design, or,
 * on a page, a behaviour note (ADR 0030), what the code must do that the design cannot show. The
 * canvas beside the pages is implemented as no page, so a comment there is a comment.
 */
const Composer = ({ onPage }: { onPage: boolean }) => {
  const cancel = () => useComments.getState().setDraft(null);
  const [chosen, setKind] = useState<"comment" | "behaviour">("comment");
  const kind = onPage ? chosen : "comment";
  return (
    <div className={cardClass} onPointerDown={stop}>
      {onPage ? (
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
      ) : null}
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
