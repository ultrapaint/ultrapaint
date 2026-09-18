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
import { useAgents } from "../state/agents.ts";
import { type SendTarget, sendToAgent } from "../state/comments.ts";
import { useEditor } from "../state/editor.ts";

/** The chat lives in the vibe workspace; this is the way there from a toast. */
const openChat = (threadId: string) => {
  const editor = useEditor.getState();
  if (editor.workspace !== "vibe") {
    editor.setWorkspace("vibe");
  }
  editor.setLeftTab("chat");
  useAgents.getState().open(threadId);
};

const send = async (
  comment: Comment,
  target: SendTarget,
  reply: CommentReply | undefined
) => {
  const thread = await sendToAgent(comment, target, reply);
  if (!thread) {
    return;
  }
  // A session started from here is the one the chat shows next.
  if ("agentId" in target) {
    useAgents.getState().open(thread.id);
  }
  toast.success(`Sent to ${thread.title}`, {
    action: { label: "Open chat", onClick: () => openChat(thread.id) },
  });
};

// The agents are only listed once the chat has been opened; the menu may come first.
const loadAgents = (open: boolean) => {
  if (open && useAgents.getState().agents.length === 0) {
    useAgents.getState().load();
  }
};

/**
 * Hands a comment to an agent: the whole thread, or with `reply` that one message. It goes to
 * the session in use, or starts a new one with whichever agent is picked.
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
  const agents = useAgents((s) => s.agents);
  const current = useAgents((s) => s.threads.find((t) => t.id === s.current));
  const busy =
    current?.status === "running" || current?.status === "cancelling";
  const whole = !(reply || single) && comment.replies.length > 0;
  // The first comment alone is the comment without the thread under it.
  const sent = single ? { ...comment, replies: [] } : comment;
  const label = whole ? "Send the thread to an agent" : "Send to an agent";
  return (
    <DropdownMenu onOpenChange={loadAgents}>
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
              current && send(sent, { threadId: current.id }, reply)
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
          <DropdownMenuLabel>New session with</DropdownMenuLabel>
          {agents.length === 0 ? (
            <DropdownMenuItem disabled>Loading agents…</DropdownMenuItem>
          ) : (
            agents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => send(sent, { agentId: agent.id }, reply)}
              >
                <Bot />
                {agent.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
