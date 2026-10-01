import type { Comment, CommentReply } from "@ultrapaint/contracts/comments";
import { cn } from "cn";
import { Bot, MessageSquarePlus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openChat } from "../lib/thread-actions.ts";
import { useAgents } from "../state/agents.ts";
import { type SendTarget, sendToAgent } from "../state/comments.ts";

/** Sends a comment, or one message of it, and says where it went. */
export const sendComment = async (
  comment: Comment,
  target: SendTarget,
  reply: CommentReply | undefined
) => {
  const thread = await sendToAgent(comment, target, reply);
  if (!thread) {
    return;
  }
  // A session started from here is the one the chat shows next.
  if ("newThread" in target) {
    useAgents.getState().open(thread.id);
  }
  toast.success(`Sent to ${thread.title}`, {
    action: { label: "Open chat", onClick: () => openChat(thread.id) },
  });
};

/**
 * Hands a comment to an agent: the whole thread, or with `reply` that one message. It goes to
 * the session in use, or starts a new one with the chat's default agent, which the thread can
 * switch in its composer.
 */
export const SendToAgent = ({
  comment,
  reply,
  className,
  single = false,
  small = false,
}: {
  className?: string;
  comment: Comment;
  reply?: CommentReply;
  /** Only the first comment of a thread, without its replies. */
  single?: boolean;
  /** The size of the per-message actions rather than the card's. */
  small?: boolean;
}) => {
  const current = useAgents((s) => s.threads.find((t) => t.id === s.current));
  const busy =
    current?.status === "running" || current?.status === "cancelling";
  const whole = !(reply || single) && comment.replies.length > 0;
  // The first comment alone is the comment without the thread under it.
  const sent = single ? { ...comment, replies: [] } : comment;
  const label = whole ? "Send the thread to an agent" : "Send to an agent";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={label}
            className={className}
            size={small ? "icon-xs" : "icon-sm"}
            title={label}
            variant="ghost"
          />
        }
      >
        <Send />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {whole ? "Send the whole thread to" : "Send this comment to"}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!current || busy}
            onClick={() =>
              current && sendComment(sent, { threadId: current.id }, reply)
            }
          >
            <MessageSquarePlus />
            <span className="flex min-w-0 flex-col">
              <span>Current session</span>
              <span
                className={cn(
                  "truncate text-[10px] text-muted-foreground",
                  busy && "text-warning"
                )}
              >
                {current
                  ? `${current.title}${busy ? " · still working" : ""}`
                  : "No session yet"}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => sendComment(sent, { newThread: true }, reply)}
          >
            <Bot />
            New thread
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
