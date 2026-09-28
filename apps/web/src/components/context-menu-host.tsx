/**
 * Draws the context menu `state/context-menu.ts` asks for: the entries of its target, at the
 * pointer or against the element it was opened from. Mounted once, beside the dialogs.
 */
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
  Bot,
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
  Group,
  Link,
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
  Smartphone,
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
import { entriesFor, runEntry } from "../lib/menu-actions.ts";
import type { Entry } from "../lib/menu-model.ts";
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

const ICONS: Record<string, LucideIcon> = {
  apply: Paintbrush,
  "apply:textStyle": Paintbrush,
  arrange: ArrowUpDown,
  "arrange:bottom": ArrowDownToLine,
  "arrange:down": ArrowDown,
  "arrange:top": ArrowUpToLine,
  "arrange:up": ArrowUp,
  ask: Bot,
  comment: MessageSquarePlus,
  copy: Copy,
  copyName: Copy,
  copyRef: Copy,
  copyRoute: Link,
  copyText: Copy,
  copyValue: Copy,
  cut: Scissors,
  delete: Trash2,
  duplicate: CopyPlus,
  editText: Pencil,
  goTo: ArrowRight,
  implement: Code,
  insert: Plus,
  insertCanvas: SquarePlus,
  newPage: FilePlus2,
  open: MessageSquare,
  paste: ClipboardPaste,
  preset: MonitorSmartphone,
  "preset:desktop": Monitor,
  "preset:mobile": Smartphone,
  "preset:tablet": Tablet,
  rename: TextCursorInput,
  selectElement: SquareDashedMousePointer,
  selectParent: CornerLeftUp,
  send: Send,
  "send:current": MessageSquarePlus,
  "send:new": Bot,
  stop: Square,
  toggleComments: MessageSquare,
  "tool:group": SquareDashed,
  "tool:text": Type,
  unwrap: Ungroup,
  viewCode: FileCode,
  wrap: Group,
  "wrap:column": Rows3,
  "wrap:group": Group,
  "wrap:row": Columns3,
  zoom100: ZoomIn,
  zoomFit: Maximize,
  zoomTo: Focus,
};

/** Items that say one thing or its opposite have an icon for each. */
const iconOf = (id: string, label: string): LucideIcon | undefined => {
  if (id === "toggleHidden" || id === "follow") {
    return label === "Show" || label.startsWith("Follow") ? Eye : EyeOff;
  }
  if (id === "resolve") {
    return label === "Reopen" ? Undo2 : CircleCheck;
  }
  return ICONS[id];
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

const choose = (target: MenuTarget, id: string) => {
  chosen = true;
  runEntry(target, id);
};

const Entries = ({
  entries,
  target,
}: {
  entries: readonly Entry[];
  target: MenuTarget;
}) =>
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
        const Icon = iconOf(entry.id, entry.label);
        return (
          <ContextMenuSub key={entry.id}>
            <ContextMenuSubTrigger disabled={entry.disabled}>
              {Icon ? <Icon /> : null}
              {entry.label}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-40">
              <Entries entries={entry.entries} target={target} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        );
      }
      default: {
        const Icon = iconOf(entry.id, entry.label);
        return (
          <ContextMenuItem
            disabled={entry.disabled}
            key={entry.id}
            onClick={() => choose(target, entry.id)}
            variant={entry.destructive ? "destructive" : "default"}
          >
            {Icon ? <Icon /> : null}
            <span className="truncate">{entry.label}</span>
            {entry.checked ? <Check className="ml-auto" /> : null}
            {entry.shortcut ? (
              <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut>
            ) : null}
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
      if (entriesFor(target) === null) {
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
  const entries = target ? entriesFor(target) : null;
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
          <Entries entries={entries} target={request.target} />
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
};
