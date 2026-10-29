/**
 * Draws the context menu `state/context-menu.ts` asks for: the entries of its target, at the
 * pointer or against the element it was opened from. Mounted once, beside the dialogs.
 */

import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
  Bot,
  BotMessageSquare,
  Check,
  CircleCheck,
  ClipboardPaste,
  Code,
  Columns3,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Eye,
  EyeOff,
  FileCode,
  FilePlus2,
  Focus,
  FolderInput,
  Group,
  Lock,
  LockOpen,
  type LucideIcon,
  Maximize,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  MonitorSmartphone,
  Paintbrush,
  Pencil,
  Plus,
  Rows3,
  Scissors,
  Send,
  Shapes,
  Smartphone,
  Split,
  Square,
  SquareDashed,
  SquareDashedMousePointer,
  SquarePlus,
  Tablet,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  ZoomIn,
} from "lucide-react";
import { useEffect } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { keysOf } from "../lib/commands.ts";
import {
  type MenuAction,
  type MenuEntry,
  menuFor,
  runMenuAction,
} from "../lib/menu-actions.ts";
import type { SubmenuId } from "../lib/menu-model.ts";
import { useAgents } from "../state/agents.ts";
import { useComments } from "../state/comments.ts";
import {
  closeMenu,
  type MenuAnchor,
  type MenuTarget,
  useContextMenu,
} from "../state/context-menu.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

type ActKind = MenuAction["act"]["kind"];

/** The icon of an item, by what it does; those that differ by their argument are told below. */
const ICONS: Partial<Record<ActKind, LucideIcon>> = {
  componentSheet: Shapes,
  copy: Copy,
  copyName: Copy,
  copyRef: Copy,
  copyText: Copy,
  copyValue: Copy,
  cut: Scissors,
  delete: Trash2,
  duplicate: CopyPlus,
  duplicateWithAgent: Bot,
  editText: Pencil,
  goTo: ArrowRight,
  implement: Code,
  insert: Plus,
  insertCanvas: SquarePlus,
  open: MessageSquare,
  openCanvas: ArrowRight,
  paste: ClipboardPaste,
  rename: TextCursorInput,
  selectElement: SquareDashedMousePointer,
  selectParent: CornerLeftUp,
  stop: Square,
  unwrap: Ungroup,
  viewCode: FileCode,
  zoomTo: Focus,
};

const SUBMENU_ICONS: Partial<Record<SubmenuId, LucideIcon>> = {
  apply: Paintbrush,
  arrange: ArrowUpDown,
  copyTo: Copy,
  moveTo: FolderInput,
  preset: MonitorSmartphone,
  send: Send,
  toSystem: Shapes,
  variant: Split,
  wrap: Group,
};

/** The commands' own, by their id in `commands.ts`. */
const COMMAND_ICONS: Record<string, LucideIcon> = {
  newPage: FilePlus2,
  toggleComments: MessageSquare,
  "tool:group": SquareDashed,
  "tool:text": Type,
  zoom100: ZoomIn,
  zoomFit: Maximize,
};

const WRAP_ICONS = { column: Rows3, group: Group, row: Columns3 } as const;

const ARRANGE_ICONS = {
  bottom: ArrowDownToLine,
  down: ArrowDown,
  top: ArrowUpToLine,
  up: ArrowUp,
} as const;

const PRESET_ICONS: Partial<Record<ViewportPreset, LucideIcon>> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

const iconOf = ({ act }: MenuAction): LucideIcon | undefined => {
  switch (act.kind) {
    case "ask":
      return act.newChat ? BotMessageSquare : Bot;
    case "comment":
      return MessageSquarePlus;
    case "wrap":
      return WRAP_ICONS[act.in];
    case "arrange":
      return ARRANGE_ICONS[act.to];
    case "preset":
      return PRESET_ICONS[act.preset];
    case "move":
      return act.by < 0 ? ArrowUp : ArrowDown;
    // Items that say one thing or its opposite have an icon for each.
    case "hide":
      return act.hidden ? EyeOff : Eye;
    case "follow":
      return act.follow ? Eye : EyeOff;
    case "lock":
      return act.locked ? Lock : LockOpen;
    case "resolve":
      return act.resolved ? CircleCheck : Undo2;
    case "send":
      return act.threadId === null ? Bot : MessageSquarePlus;
    // A text style's; a token's go in the fields of its submenu, which has the icon.
    case "apply":
      return "field" in act ? undefined : Paintbrush;
    case "command":
      return COMMAND_ICONS[act.id];
    default:
      return ICONS[act.kind];
  }
};

const pointAnchor = (anchor: MenuAnchor) =>
  anchor instanceof Element
    ? anchor
    : {
        getBoundingClientRect: () =>
          DOMRect.fromRect({ height: 0, width: 0, x: anchor.x, y: anchor.y }),
      };

/** An item was picked, as opposed to the menu being dismissed. */
let chosen = false;

/**
 * A dismissed menu gives the focus back where it was. A picked item decides where it goes: a
 * dialog's field, a comment being written, the text being edited.
 */
const finalFocus = () => {
  const back = !chosen;
  chosen = false;
  return back;
};

const choose = (action: MenuAction) => {
  chosen = true;
  runMenuAction(action);
};

const Entries = ({ entries }: { entries: readonly MenuEntry[] }) =>
  entries.map((entry, i) => {
    switch (entry.kind) {
      case "separator":
        // biome-ignore lint/suspicious/noArrayIndexKey: separators have nothing else to tell them apart.
        return <ContextMenuSeparator key={`separator-${i}`} />;
      case "label":
        return (
          <ContextMenuGroup key={`label-${entry.label}`}>
            <ContextMenuLabel className="max-w-64 truncate">
              {entry.label}
            </ContextMenuLabel>
          </ContextMenuGroup>
        );
      case "submenu": {
        const Icon = SUBMENU_ICONS[entry.id];
        return (
          <ContextMenuSub key={entry.id}>
            <ContextMenuSubTrigger disabled={entry.disabled}>
              {Icon ? <Icon /> : null}
              {entry.label}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-40">
              <Entries entries={entry.entries} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        );
      }
      default: {
        const Icon = iconOf(entry.action);
        const keys = entry.command ? keysOf(entry.command) : undefined;
        return (
          <ContextMenuItem
            disabled={entry.disabled}
            // biome-ignore lint/suspicious/noArrayIndexKey: a menu is drawn as it was read, and two canvases may share a name.
            key={`item-${i}`}
            onClick={() => choose(entry.action)}
            variant={entry.destructive ? "destructive" : "default"}
          >
            {Icon ? <Icon /> : null}
            <span className="truncate">{entry.label}</span>
            {entry.checked ? <Check className="ml-auto" /> : null}
            {keys ? <ContextMenuShortcut>{keys}</ContextMenuShortcut> : null}
          </ContextMenuItem>
        );
      }
    }
  });

const onOpenChange = (open: boolean) => {
  if (!open) {
    closeMenu();
  }
};

/**
 * The menu is about what was under the pointer: it goes when the canvas moves from under it, the
 * workspace changes, or what it was for is gone (an undo, an agent's edit, another tab).
 */
const useCloseWhenStale = (target: MenuTarget | null, open: boolean) => {
  useEffect(() => {
    if (!(open && target)) {
      return;
    }
    const stale = () => {
      if (menuFor(target) === null) {
        closeMenu();
      }
    };
    const { view, workspace } = useEditor.getState();
    const offs = [
      useDocuments.subscribe(stale),
      useProject.subscribe(stale),
      useComments.subscribe(stale),
      useAgents.subscribe(stale),
      useEditor.subscribe((s) => {
        if (s.view !== view || s.workspace !== workspace) {
          closeMenu();
        }
      }),
    ];
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [target, open]);
};

export const ContextMenuHost = () => {
  const open = useContextMenu((s) => s.open);
  const request = useContextMenu((s) => s.request);
  const target = request?.target ?? null;
  useCloseWhenStale(target, open);
  // What the menu holds is read when it opens; it is not a view that follows the editor.
  const entries = target ? menuFor(target) : null;
  const onElement = request?.anchor instanceof Element;
  return (
    <ContextMenu onOpenChange={onOpenChange} open={open && !!entries}>
      {request && entries ? (
        <ContextMenuContent
          align={onElement ? "end" : "start"}
          alignOffset={onElement ? 0 : 4}
          anchor={pointAnchor(request.anchor)}
          className="min-w-52 max-w-80"
          finalFocus={finalFocus}
          key={request.id}
          side={onElement ? "bottom" : "right"}
          sideOffset={onElement ? 4 : 0}
        >
          <Entries entries={entries} />
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
};
