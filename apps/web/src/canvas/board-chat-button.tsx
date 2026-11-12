/**
 * A board's agent button, on its inspector's title: it adds what is picked on the board to the
 * open chat, takes it out again, or with ⌘ starts a new one (ADR 0045, B11). On the canvas the
 * selection has its own (`ask-agent`, ADR 0086).
 */
import type { BoardAttachment } from "@ultrapaint/contracts/threads";
import {
  MessageSquareText,
  MessageSquareX,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { addChipsToChat } from "../lib/add-to-chat.ts";
import { useAgents } from "../state/agents.ts";
import { chipKey, removeChip, useAttachments } from "../state/attachments.ts";

/** ⌘ on a Mac, Ctrl elsewhere: the key that sends an element to a new chat. */
const withMod = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  e.metaKey || e.ctrlKey;

/**
 * Whether the pointer is over an agent button, and whether ⌘ is held while it is: the moment the
 * button offers a new chat. The pointer says which keys were down when it arrived; the keyboard
 * follows them while it stays.
 */
const useNewChatHover = () => {
  const [hovered, setHovered] = useState(false);
  const [mod, setMod] = useState(false);
  useEffect(() => {
    if (!hovered) {
      return;
    }
    const onKey = (e: KeyboardEvent) => setMod(withMod(e));
    // A key released while the window is in the background never reaches keyup.
    const blur = () => setMod(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", blur);
    };
  }, [hovered]);
  const onPointer = (e: ReactPointerEvent) => {
    setHovered(true);
    setMod(withMod(e));
  };
  return {
    handlers: {
      onPointerEnter: onPointer,
      onPointerLeave: () => setHovered(false),
      onPointerMove: onPointer,
    },
    hovered,
    newChat: hovered && mod,
  };
};

/** The plus on an agent button while ⌘ is held, in its corner so the button keeps its width. */
const NewChatBadge = () => (
  <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-agent text-agent-foreground ring-2 ring-popover">
    <Plus className="size-2.5" strokeWidth={3} />
  </span>
);

/** What a click on an agent button does, which is also how the button looks. */
type ChatAction = "add" | "new" | "open" | "remove";

const chatAction = (
  newChat: boolean,
  attached: boolean,
  started: boolean
): ChatAction => {
  if (newChat) {
    return "new";
  }
  if (attached) {
    return "remove";
  }
  return started ? "open" : "add";
};

const AGENT_BUTTON =
  "relative flex h-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Solid to add, to the open thread or a new one; outlined when attached to the open thread, which a
 * click undoes; tinted when a thread was started on it, which a click opens.
 */
const LOOK: Record<ChatAction, string> = {
  add: "bg-agent text-agent-foreground hover:bg-agent/85",
  new: "bg-agent text-agent-foreground hover:bg-agent/85",
  open: "bg-agent/10 text-agent hover:bg-agent/20",
  remove: "border border-agent bg-agent/15 text-agent hover:bg-agent/25",
};

/** The icon says what a click does: the cross only once the pointer is on a button that removes. */
const ChatIcon = ({
  action,
  hovered,
}: {
  action: ChatAction;
  hovered: boolean;
}) => {
  if (action === "remove" && hovered) {
    return <MessageSquareX className="size-3.5" />;
  }
  if (action === "remove" || action === "open") {
    return <MessageSquareText className="size-3.5" />;
  }
  return <Sparkles className="size-3.5" />;
};

/**
 * What is picked on a board to the chat, or back out of the open thread's composer once it is in
 * it; with ⌘ held, to a new thread.
 */
export const BoardChatButton = ({ chip }: { chip: BoardAttachment }) => {
  const current = useAgents((s) => s.current);
  const key = chipKey(chip);
  const attached = useAttachments(
    (s) =>
      current !== null &&
      (s.byThread[current] ?? []).some((c) => chipKey(c) === key)
  );
  const { handlers, hovered, newChat } = useNewChatHover();
  const action = chatAction(newChat, attached, false);
  const onClick = (e: ReactMouseEvent) => {
    if (withMod(e)) {
      addChipsToChat([chip], { newThread: true });
    } else if (attached && current !== null) {
      removeChip(current, key);
    } else {
      addChipsToChat([chip]);
    }
  };
  const label = {
    add: "Add to chat",
    new: "Add to a new chat",
    open: "Add to chat",
    remove: "Remove from chat",
  }[action];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className={cn(AGENT_BUTTON, "w-7", LOOK[action])}
            onClick={onClick}
            type="button"
            {...handlers}
          />
        }
      >
        <ChatIcon action={action} hovered={hovered} />
        {action === "new" ? <NewChatBadge /> : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
