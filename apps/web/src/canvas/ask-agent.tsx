/**
 * The agent's button on the selection (ADR 0086): on its top-left edge, shown while the pointer is
 * over what is selected, an icon until the pointer is on it. Pressed, it opens a popover to ask
 * for a change, which starts a chat of its own with the selection attached; the person typed and
 * sent the prompt, so it runs (ADR 0074). The same popover adds the selection to the open chat,
 * takes it back out, or opens the chat it was started in.
 */
import {
  ArrowUp,
  MessageSquarePlus,
  MessageSquareText,
  MessageSquareX,
  Sparkles,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { composerBox, composerText } from "../components/composer-style.ts";
import { addToChat, removeFromChat } from "../lib/add-to-chat.ts";
import { chatLinkOf, isAttached } from "../lib/chat-link.ts";
import { useAgents } from "../state/agents.ts";
import {
  attachmentsOf,
  chipOfSelection,
  fileOfFrame,
  useAttachments,
} from "../state/attachments.ts";
import { api } from "../state/connection.ts";
import type { Selection } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError } from "../state/project.ts";

/**
 * Sends `text` in a new chat with the selection attached, and opens the chat. The chat is named
 * from its first prompt, as one started in the Agents panel is.
 */
export const askInNewChat = async (
  targets: readonly Selection[],
  text: string
) => {
  const chips = targets.flatMap((t) => chipOfSelection(t) ?? []);
  try {
    const thread = await api().request("threads.create", {});
    await showLeftPanel({ chat: thread, draft: "" });
    await api().request("threads.prompt", {
      attachments: attachmentsOf(chips),
      text: text.trim(),
      threadId: thread.id,
    });
  } catch (error) {
    reportError(error);
  }
};

/** A row of the popover under the prompt: an action on the open chat. */
const ChatRow = ({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) => (
  <button
    className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left font-body-medium outline-none transition-colors duration-100 hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    onClick={onClick}
    type="button"
  >
    {icon}
    <span className="min-w-0 truncate">{children}</span>
  </button>
);

/**
 * What the popover offers on the open chat: the selection added to it or taken back out, and for
 * one element started in another chat, that chat. Nothing when no chat is open.
 */
const ChatRows = ({
  close,
  targets,
}: {
  close: () => void;
  targets: readonly Selection[];
}) => {
  const threads = useAgents((s) => s.threads);
  const current = useAgents((s) => s.current);
  const byThread = useAttachments((s) => s.byThread);
  const [only] = targets;
  const link =
    only && targets.length === 1
      ? chatLinkOf(threads, byThread, current, only, fileOfFrame(only.frame))
      : null;
  const open = threads.find((t) => t.id === current) ?? null;
  const attached =
    targets.length > 0 &&
    targets.every((t) => isAttached(byThread, current, t));
  const started = link !== null && !link.attached ? link.thread : null;
  const act = (run: () => unknown) => () => {
    run();
    close();
  };
  if (!(open || started)) {
    return null;
  }
  return (
    <div className="-mx-1 flex flex-col gap-0.5">
      {open && attached ? (
        <ChatRow
          icon={<MessageSquareX />}
          onClick={act(() => removeFromChat([...targets]))}
        >
          Remove from “{open.title}”
        </ChatRow>
      ) : null}
      {open && !attached ? (
        <ChatRow
          icon={<MessageSquarePlus />}
          onClick={act(() => addToChat([...targets]))}
        >
          Add to “{open.title}”
        </ChatRow>
      ) : null}
      {started && started.id !== open?.id ? (
        <ChatRow
          icon={<MessageSquareText />}
          onClick={act(() => showLeftPanel({ chat: started.id }))}
        >
          Open “{started.title}”
        </ChatRow>
      ) : null}
    </div>
  );
};

/** The prompt: Enter sends, Shift+Enter breaks the line, Escape closes. */
const AskField = ({
  close,
  subject,
  targets,
}: {
  close: () => void;
  /** What the change is to, as the placeholder says it: an element's name, "3 elements". */
  subject: string;
  targets: readonly Selection[];
}) => {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim()) {
      return;
    }
    askInNewChat(targets, text);
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className={composerBox}>
      <textarea
        aria-label={`Ask for a change to ${subject}`}
        autoFocus
        className={cn(composerText, "min-h-10")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Ask for a change to ${subject}`}
        rows={1}
        value={text}
      />
      <div className="flex justify-end px-1.5 pb-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label="Send in a new chat"
                className={cn(
                  "flex size-6 items-center justify-center rounded-full outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/25",
                  text.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-foreground/10 text-muted-foreground"
                )}
                onClick={send}
                type="button"
              />
            }
          >
            <ArrowUp className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Send in a new chat</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

/**
 * The button and its popover. `open` is the parent's, which keeps the button shown while the
 * popover is up; `onHover` tells it the pointer is on the button.
 */
export const AskAgent = ({
  onHover,
  onOpenChange,
  open,
  subject,
  targets,
}: {
  onHover: (over: boolean) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  subject: string;
  targets: readonly Selection[];
}) => {
  const close = () => onOpenChange(false);
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  aria-label="Ask an agent"
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md text-agent outline-none transition-colors duration-100 hover:bg-agent hover:text-agent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    open && "bg-agent text-agent-foreground"
                  )}
                  // A press here is not a press on the canvas or the frame under it.
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={() => onHover(true)}
                  onPointerLeave={() => onHover(false)}
                  type="button"
                />
              }
            />
          }
        >
          <Sparkles className="size-4" strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent>Ask an agent</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-80 gap-1.5 p-1.5"
        // The canvas must not take the popover's presses, nor its wheel.
        data-canvas-scroll
        onPointerDown={(e) => e.stopPropagation()}
        // Away from the selection, which the button sits left of: the element stays in view.
        side="left"
      >
        <AskField close={close} subject={subject} targets={targets} />
        <ChatRows close={close} targets={targets} />
      </PopoverContent>
    </Popover>
  );
};
