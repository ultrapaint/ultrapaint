import type { Comment } from "@ultrapaint/contracts/comments";
import { cn } from "cn";
import {
  Check,
  CheckCheck,
  CircleCheck,
  Eye,
  EyeOff,
  MessageCircle,
  Undo2,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  CommentAvatar,
  relativeTime,
  repliesLabel,
} from "../canvas/comments.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import {
  revealComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const toggleVisible = () => useComments.getState().toggleVisible();

/** The panel's title on the rail's side (ADR 0058), with how many are open and its actions. */
const CommentsHeading = ({ children }: { children?: ReactNode }) => (
  <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-3">
    <h2 className="shrink-0 font-heading-xsmall">Comments</h2>
    {children}
  </div>
);

/** Every comment of the open canvas, page by page, newest first. */
export const Comments = () => {
  const configured = useProject((s) => s.info.configured);
  const canvas = useEditor((s) => s.canvas);
  // Subscribed to so the page names follow a page being renamed.
  useProject((s) => s.pages);
  const comments = useComments((s) => s.comments);
  const visible = useComments((s) => s.visible);
  const showResolved = useComments((s) => s.showResolved);

  if (!configured) {
    return (
      <div className="flex h-full flex-col">
        <CommentsHeading />
        <NoFolder />
      </div>
    );
  }

  const resolvedCount = comments.filter((c) => c.resolved).length;
  const listed = comments.filter((c) => showResolved || !c.resolved);
  const pages = pagesOfCanvas(canvas);
  const groups = new Map<string, Comment[]>();
  for (const comment of [...listed].sort((a, b) => b.createdAt - a.createdAt)) {
    groups.set(comment.page, [...(groups.get(comment.page) ?? []), comment]);
  }
  const toggleResolved = () =>
    useComments.getState().setShowResolved(!showResolved);

  return (
    <div className="flex h-full flex-col">
      <CommentsHeading>
        <span className="min-w-0 flex-1 truncate font-small text-muted-foreground tabular-nums">
          {comments.length === 0
            ? null
            : `${comments.length - resolvedCount} open${resolvedCount > 0 ? ` · ${resolvedCount} resolved` : ""}`}
        </span>
        <IconButton
          aria-pressed={showResolved}
          className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
          onClick={toggleResolved}
          tooltip={showResolved ? "Hide resolved" : "Show resolved"}
        >
          <CheckCheck />
        </IconButton>
        <IconButton
          className="text-muted-foreground"
          label={visible ? "Hide comments" : "Show comments"}
          onClick={toggleVisible}
          tooltip={
            <>
              {visible ? "Hide comments" : "Show comments"}{" "}
              <CommandKeys id="toggleComments" />
            </>
          }
        >
          {visible ? <Eye /> : <EyeOff />}
        </IconButton>
      </CommentsHeading>
      {listed.length === 0 ? (
        <PanelEmpty
          action={
            comments.length > 0 ? (
              <Button onClick={toggleResolved} size="sm" variant="secondary">
                Show resolved
              </Button>
            ) : null
          }
          icon={<MessageCircle />}
          title={comments.length === 0 ? "No comments yet" : "All resolved"}
        >
          {comments.length === 0 ? (
            <>
              Pick the comment tool <CommandKeys id="tool:comment" /> and click
              on a page to leave one.
            </>
          ) : (
            "Resolved comments are hidden here and on the canvas."
          )}
        </PanelEmpty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-2">
          {[...groups].map(([pagePath, items]) => {
            const page = pages.find((p) => p.path === pagePath);
            return (
              <section className="flex flex-col px-2" key={pagePath}>
                <h3 className="flex h-9 items-end gap-1.5 truncate px-2 pb-1.5 font-small text-muted-foreground">
                  {page ? (
                    <>
                      <span className="truncate">{page.name}</span>
                      {page.route ? (
                        <span className="truncate font-code">{page.route}</span>
                      ) : null}
                    </>
                  ) : (
                    `${pagePath} (removed)`
                  )}
                </h3>
                {items.map((comment) => (
                  <Item comment={comment} key={comment.id} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Item = ({ comment }: { comment: Comment }) => {
  const open = useComments((s) => s.open === comment.id);
  const reveal = () => revealComment(comment);
  const toggleResolved = (e: MouseEvent) => {
    e.stopPropagation();
    updateComment(comment.id, { resolved: !comment.resolved });
  };
  return (
    <div
      className={cn(
        "group relative flex gap-2.5 rounded-md p-2 transition-colors duration-100 has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring",
        open ? "bg-accent" : "hover:bg-accent/50"
      )}
    >
      {/* The whole row opens the comment; the resolve button sits on top of it. */}
      <button
        aria-label={`Open comment: ${comment.text}`}
        className="absolute inset-0 rounded-md outline-none"
        onClick={reveal}
        onContextMenu={(e) =>
          openMenuAt(e, { commentId: comment.id, kind: "comment" })
        }
        type="button"
      />
      <CommentAvatar comment={{ author: comment.author, kind: comment.kind }} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-6 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-label",
              comment.resolved && "text-muted-foreground"
            )}
          >
            {comment.kind === "behaviour"
              ? "Behaviour note"
              : (comment.author ?? "Someone")}
          </span>
          <span className="shrink-0 font-small text-muted-foreground">
            {relativeTime(comment.createdAt)}
          </span>
          {comment.resolved ? (
            <Check
              aria-label="Resolved"
              className="size-3.5 shrink-0 text-success"
            />
          ) : null}
        </div>
        <p
          className={cn(
            "line-clamp-3 whitespace-pre-wrap break-words font-body",
            comment.resolved && "text-muted-foreground"
          )}
        >
          {comment.text}
        </p>
        {comment.element || comment.replies.length > 0 ? (
          <span className="flex min-w-0 gap-2 pt-0.5 font-small text-muted-foreground">
            {comment.replies.length > 0 ? (
              <span className="shrink-0">
                {repliesLabel(comment.replies.length)}
              </span>
            ) : null}
            {comment.element ? (
              <span className="truncate font-code">{`<${comment.element}>`}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <IconButton
        className="invisible relative -my-0.5 shrink-0 text-muted-foreground group-focus-within:visible group-hover:visible"
        onClick={toggleResolved}
        size="icon-sm"
        tooltip={comment.resolved ? "Reopen" : "Resolve"}
      >
        {comment.resolved ? <Undo2 /> : <CircleCheck />}
      </IconButton>
    </div>
  );
};
