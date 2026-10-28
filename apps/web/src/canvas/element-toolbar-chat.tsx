/**
 * The element toolbar's chat button: it adds what is selected to the open chat, takes it out
 * again, opens the chat it is in, or with ⌘ starts a new one.
 */

import { cn } from "cn";
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
import { addToChat, removeFromChat } from "../lib/add-to-chat.ts";
import { isAttached } from "../lib/chat-link.ts";
import { useAgents } from "../state/agents.ts";
import { useAttachments } from "../state/attachments.ts";
import type { Selection } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useChatLink } from "./selection-tag.tsx";

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

/** The plus on an agent button while ⌘ is held, in its corner so the toolbar keeps its width. */
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
  "relative flex h-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";

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
 * Add to chat, in the agents' colour. Once attached to the open thread, a click takes the element
 * back out; once a thread was started on it, a click opens that thread. With ⌘ held it goes to a
 * new thread, whatever it is in already.
 */
export const ChatButton = ({ selection }: { selection: Selection }) => {
  const link = useChatLink();
  const { handlers, hovered, newChat } = useNewChatHover();
  const action = chatAction(newChat, link?.attached ?? false, link !== null);
  const onClick = (e: ReactMouseEvent) => {
    if (withMod(e)) {
      addToChat(selection, { newThread: true });
    } else if (link?.attached) {
      removeFromChat(selection);
    } else if (link) {
      showLeftPanel({ chat: link.thread.id });
    } else {
      addToChat(selection);
    }
  };
  const title = link?.thread.title ?? "";
  const label = {
    add: "Add to chat",
    new: "Add to a new chat",
    open: `Open “${title}”`,
    remove: `Remove from “${title}”`,
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

/**
 * All the selected elements to the chat, or back out of it once every one is attached to the
 * open thread; with ⌘ held, all of them to a new thread.
 */
export const GroupChatButton = ({
  targets,
}: {
  targets: readonly Selection[];
}) => {
  const current = useAgents((s) => s.current);
  const allAttached = useAttachments((s) =>
    targets.every((t) => isAttached(s.byThread, current, t))
  );
  const { handlers, hovered, newChat } = useNewChatHover();
  const action = chatAction(newChat, allAttached, false);
  const onClick = (e: ReactMouseEvent) => {
    if (withMod(e)) {
      addToChat(targets, { newThread: true });
    } else if (allAttached) {
      removeFromChat(targets);
    } else {
      addToChat(targets);
    }
  };
  const count = targets.length;
  const label = {
    add: `Add ${count} to chat`,
    new: `Add ${count} to a new chat`,
    open: `Add ${count} to chat`,
    remove: `Remove ${count} from chat`,
  }[action];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className={cn(
              AGENT_BUTTON,
              "gap-1.5 px-2 font-body font-medium",
              LOOK[action]
            )}
            onClick={onClick}
            type="button"
            {...handlers}
          />
        }
      >
        <ChatIcon action={action} hovered={hovered} />
        {count}
        {action === "new" ? <NewChatBadge /> : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
