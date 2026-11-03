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
  CheckCheck,
  CircleCheck,
  CircleDashed,
  ClipboardPaste,
  Code,
  Columns3,
  Command as CommandMark,
  Component,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Eye,
  EyeOff,
  FileCheck,
  FileCode,
  FilePlus2,
  FileUp,
  Focus,
  FolderInput,
  Frame,
  Grid3x3,
  Group,
  Hand,
  Import,
  Keyboard,
  Link,
  Link2Off,
  Lock,
  LockOpen,
  type LucideIcon,
  Maximize,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Monitor,
  MonitorSmartphone,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pencil,
  PencilRuler,
  Play,
  Plus,
  Pointer,
  Redo2,
  Rows3,
  Scan,
  Scissors,
  Send,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Split,
  Square,
  SquareDashed,
  SquareDashedMousePointer,
  SquarePlus,
  StickyNote,
  Tablet,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Unlink,
  Unplug,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Fragment, useEffect } from "react";
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
  adopt: Import,
  copy: Copy,
  copyLink: Link,
  copyName: Copy,
  copyRef: Copy,
  copyText: Copy,
  cut: Scissors,
  delete: Trash2,
  detach: Unplug,
  duplicate: CopyPlus,
  duplicateWithAgent: Bot,
  editComponent: PencilRuler,
  editText: Pencil,
  goTo: ArrowRight,
  implement: Code,
  insert: Plus,
  insertCanvas: SquarePlus,
  link: Link,
  linkUrl: Link,
  makeApp: Component,
  markImplemented: FileCheck,
  note: StickyNote,
  open: MessageSquare,
  openCanvas: ArrowRight,
  paste: ClipboardPaste,
  ready: CheckCheck,
  readyAll: CheckCheck,
  removeUrl: Link2Off,
  rename: TextCursorInput,
  selectElement: SquareDashedMousePointer,
  selectParent: CornerLeftUp,
  setUrl: Link,
  state: CircleDashed,
  stop: Square,
  unlink: Unlink,
  unwrap: Ungroup,
  variant: Split,
  viewCode: FileCode,
  zoomTo: Focus,
};

const SUBMENU_ICONS: Partial<Record<SubmenuId, LucideIcon>> = {
  arrange: ArrowUpDown,
  copyTo: Copy,
  link: Link,
  moveTo: FolderInput,
  preset: MonitorSmartphone,
  send: Send,
  state: CircleDashed,
  variant: Split,
  wrap: Group,
};

/** The commands' own, by their id in `commands.ts`: the menus' and the palette's. */
export const COMMAND_ICONS: Record<string, LucideIcon> = {
  copy: Copy,
  cut: Scissors,
  grid: Grid3x3,
  importFigma: FileUp,
  newCanvas: SquarePlus,
  newChat: Sparkles,
  newPage: FilePlus2,
  palette: CommandMark,
  paste: ClipboardPaste,
  redo: Redo2,
  "right:code": Code,
  "right:comments": MessageSquare,
  "right:design": SlidersHorizontal,
  settings: Settings,
  shortcuts: Keyboard,
  toggleAll: Maximize,
  toggleComments: MessagesSquare,
  toggleLeft: PanelLeft,
  toggleRight: PanelRight,
  "tool:comment": MessageCircle,
  "tool:group": SquareDashed,
  "tool:interact": Pointer,
  "tool:pan": Hand,
  "tool:select": MousePointer2,
  "tool:text": Type,
  undo: Undo2,
  "workspace:design": Frame,
  "workspace:prototype": Play,
  zoom100: Scan,
  zoomFit: Maximize,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  zoomSelection: Focus,
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

export const iconOf = ({ act }: MenuAction): LucideIcon | undefined => {
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
    case "copyTo":
      return act.move ? FolderInput : Copy;
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

/** An entry's icon: an item's by what it does, a submenu's by what it gathers. */
const entryIcon = (entry: MenuEntry): LucideIcon | undefined => {
  if (entry.kind === "submenu") {
    return SUBMENU_ICONS[entry.id];
  }
  return entry.kind === "item" ? iconOf(entry.action) : undefined;
};

/** An icon picked by what it stands for, drawn as its menu row sizes it. */
export const Glyph = ({ icon: Icon }: { icon: LucideIcon }) => <Icon />;

const isDestructive = (entry: MenuEntry) =>
  entry.kind === "item" && entry.destructive === true;

/**
 * The entries as groups, split where the menu has a separator. What deletes or removes comes
 * last, in a group of its own, whatever order the menu gave it in.
 */
const groupsOf = (entries: readonly MenuEntry[]) => {
  const groups: MenuEntry[][] = [[]];
  for (const entry of entries) {
    if (entry.kind === "separator") {
      groups.push([]);
    } else {
      groups.at(-1)?.push(entry);
    }
  }
  const last = entries.filter(isDestructive);
  const rest = groups
    .map((g) => g.filter((e) => !isDestructive(e)))
    .filter((g) => g.some((e) => e.kind !== "label"));
  return last.length > 0 ? [...rest, last] : rest;
};

/**
 * A group shows its icons when every entry of it has one, icons being all or none, and they
 * differ: a submenu's choices (the canvases to copy to, the pages to link to) would all carry
 * the submenu's, which says nothing.
 */
const iconsShown = (group: readonly MenuEntry[]) => {
  const icons = group
    .filter((e) => e.kind !== "label")
    .map((e) => entryIcon(e));
  return (
    icons.length > 0 &&
    icons.every((icon) => icon !== undefined) &&
    (icons.length === 1 || new Set(icons).size > 1)
  );
};

const Entry = ({
  entry,
  icons,
  inset,
}: {
  entry: MenuEntry;
  /** Whether its group shows icons. */
  icons: boolean;
  /** Whether its words line up with those of a group that shows icons. */
  inset: boolean;
}) => {
  const icon = icons ? entryIcon(entry) : undefined;
  switch (entry.kind) {
    case "separator":
      return null;
    case "label":
      return (
        <ContextMenuGroup>
          <ContextMenuLabel className="max-w-64 truncate">
            {entry.label}
          </ContextMenuLabel>
        </ContextMenuGroup>
      );
    case "submenu":
      return (
        <ContextMenuSub>
          <ContextMenuSubTrigger
            disabled={entry.disabled}
            // The primitive styles the attribute whatever its value: absent unless inset.
            inset={inset || undefined}
          >
            {icon ? <Glyph icon={icon} /> : null}
            {entry.label}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-40">
            <Entries entries={entry.entries} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      );
    default: {
      const keys = entry.command ? keysOf(entry.command) : undefined;
      return (
        <ContextMenuItem
          disabled={entry.disabled}
          inset={inset || undefined}
          onClick={() => choose(entry.action)}
          variant={entry.destructive ? "destructive" : "default"}
        >
          {icon ? <Glyph icon={icon} /> : null}
          <span className="truncate">{entry.label}</span>
          {entry.checked ? <Check className="ml-auto" /> : null}
          {keys ? <ContextMenuShortcut>{keys}</ContextMenuShortcut> : null}
        </ContextMenuItem>
      );
    }
  }
};

const Entries = ({ entries }: { entries: readonly MenuEntry[] }) => {
  const groups = groupsOf(entries);
  const shown = groups.map(iconsShown);
  const anyIcons = shown.some(Boolean);
  return groups.map((group, g) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a menu is drawn as it was read, group by group.
    <Fragment key={`group-${g}`}>
      {g > 0 ? <ContextMenuSeparator /> : null}
      {group.map((entry, i) => (
        <Entry
          entry={entry}
          icons={shown[g] === true}
          inset={anyIcons && !shown[g] && entry.kind !== "label"}
          // biome-ignore lint/suspicious/noArrayIndexKey: two items may share a label (two canvases of one name).
          key={`${entry.kind}-${i}`}
        />
      ))}
    </Fragment>
  ));
};

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
