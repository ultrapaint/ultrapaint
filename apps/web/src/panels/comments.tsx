import type { Comment } from "@ultrapaint/contracts/comments";
import { cn } from "cn";
import {
  CheckCheck,
  CircleCheck,
  Eye,
  EyeOff,
  MessageCircle,
  Undo2,
} from "lucide-react";
import type { MouseEvent } from "react";
import { Kbd } from "@/components/ui/kbd";
import { initialOf, relativeTime, repliesLabel } from "../canvas/comments.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import {
  revealComment,
  updateComment,
  useComments,
} from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { pagesOfSpace, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const toggleVisible = () => useComments.getState().toggleVisible();

/** Every comment of the open space, page by page, newest first. */
export const Comments = () => {
  const configured = useProject((s) => s.info.configured);
  const space = useEditor((s) => s.space);
  // Subscribed to so the page names follow a page being renamed.
  useProject((s) => s.pages);
  const comments = useComments((s) => s.comments);
  const visible = useComments((s) => s.visible);
  const showResolved = useComments((s) => s.showResolved);

  if (!configured) {
    return <SetupEmpty />;
  }

  const resolvedCount = comments.filter((c) => c.resolved).length;
  const listed = comments.filter((c) => showResolved || !c.resolved);
  const pages = pagesOfSpace(space);
  const groups = new Map<string, Comment[]>();
  for (const comment of [...listed].sort((a, b) => b.createdAt - a.createdAt)) {
    groups.set(comment.page, [...(groups.get(comment.page) ?? []), comment]);
  }
  const toggleResolved = () =>
    useComments.getState().setShowResolved(!showResolved);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {comments.length - resolvedCount} open
          {resolvedCount > 0 ? ` · ${resolvedCount} resolved` : ""}
        </span>
        <IconButton
          aria-pressed={showResolved}
          className={cn(showResolved && "bg-muted text-foreground")}
          onClick={toggleResolved}
          tooltip={showResolved ? "Hide resolved" : "Show resolved"}
        >
          <CheckCheck />
        </IconButton>
        <IconButton
          onClick={toggleVisible}
          tooltip={
            <>
              {visible ? "Hide comments" : "Show comments"} <Kbd>⇧C</Kbd>
            </>
          }
        >
          {visible ? <Eye /> : <EyeOff />}
        </IconButton>
      </div>
      {listed.length === 0 ? (
        <PanelEmpty icon={<MessageCircle />}>
          {comments.length === 0 ? (
            <>
              No comments yet. Pick the comment tool <Kbd>C</Kbd> and click
              anywhere on a page.
            </>
          ) : (
            "Every comment is resolved."
          )}
        </PanelEmpty>
      ) : (
        [...groups].map(([pagePath, items]) => {
          const page = pages.find((p) => p.path === pagePath);
          return (
            <div className="border-b py-1" key={pagePath}>
              <div className="truncate px-3 py-1 font-medium text-[11px] text-muted-foreground">
                {page?.route ?? `${pagePath} (removed)`}
              </div>
              {items.map((comment) => (
                <Item comment={comment} key={comment.id} />
              ))}
            </div>
          );
        })
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
        "group relative flex gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50",
        open && "bg-brand/20 hover:bg-brand/20",
        comment.resolved && "opacity-60"
      )}
    >
      {/* The whole row opens the comment; the resolve button sits on top of it. */}
      <button
        aria-label={`Open comment: ${comment.text}`}
        className="absolute inset-0"
        onClick={reveal}
        onContextMenu={(e) =>
          openMenuAt(e, { commentId: comment.id, kind: "comment" })
        }
        type="button"
      />
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full rounded-bl-none bg-brand font-semibold text-[10px] text-brand-foreground">
        {initialOf(comment.author)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-medium text-foreground">
            {comment.author ?? "Someone"}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-foreground/90">
          {comment.text}
        </p>
        {comment.element || comment.replies.length > 0 ? (
          <span className="flex min-w-0 gap-2 text-[10px] text-muted-foreground">
            {comment.replies.length > 0 ? (
              <span className="shrink-0">
                {repliesLabel(comment.replies.length)}
              </span>
            ) : null}
            {comment.element ? (
              <span className="truncate font-mono">{`<${comment.element}>`}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <IconButton
        className="relative hidden shrink-0 group-hover:flex"
        onClick={toggleResolved}
        size="icon-sm"
        tooltip={comment.resolved ? "Reopen" : "Resolve"}
      >
        {comment.resolved ? <Undo2 /> : <CircleCheck />}
      </IconButton>
    </div>
  );
};
