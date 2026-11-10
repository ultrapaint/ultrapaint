import {
  FileText,
  LayoutGrid,
  type LucideIcon,
  MessageSquare,
  Plus,
  Search,
  SearchX,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import {
  type Command,
  paletteCommands,
  searchCommands,
} from "../lib/commands.ts";
import type { LeftTab } from "../state/editor.ts";
import { COMMAND_ICONS, Glyph, iconOf } from "./context-menu-host.tsx";
import { CutText } from "./cut-text.tsx";
import { railItems } from "./rail.tsx";

/** A key on a row or in the legend: a cap with a hairline, which holds on a filled row too. */
const KEY_CAP = "bg-transparent ring-1 ring-border ring-inset";

const usePalette = create<{ open: boolean }>(() => ({ open: false }));

/** ⌘K, and the search button at the top right. */
export const openCommandPalette = () => usePalette.setState({ open: true });

const close = () => usePalette.setState({ open: false });

/**
 * Runs a command once the palette is gone: what it opens (a prompt, a panel) takes the focus
 * the palette gives back, and the keys reach the editor again.
 */
const run = (command: Command) => {
  close();
  requestAnimationFrame(() => command.run());
};

/** What a row of the go-to group is, by its id's prefix. */
const KINDS: Record<string, LucideIcon> = {
  canvas: LayoutGrid,
  insert: Plus,
  page: FileText,
  thread: MessageSquare,
};

/** A command's icon: the editor's own, the panel's as the rail draws it, the menu's item's. */
const commandIcon = (command: Command): LucideIcon | undefined => {
  if (command.action) {
    return iconOf(command.action);
  }
  const own = COMMAND_ICONS[command.id];
  if (own) {
    return own;
  }
  const [kind = "", rest = ""] = command.id.split(":");
  if (kind === "panel") {
    return railItems[rest as LeftTab]?.icon;
  }
  return KINDS[kind];
};

const Row = ({
  active,
  command,
  grouped,
  onPointerMove,
}: {
  active: boolean;
  command: Command;
  /** Under its group's heading; searched, the group is said on the row. */
  grouped: boolean;
  onPointerMove: () => void;
}) => {
  const icon = commandIcon(command);
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: the input keeps the focus; the active row is its aria-activedescendant.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the input's arrows and Enter are the keys.
    <div
      aria-selected={active}
      className={cn(
        "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 font-body-medium",
        active && "bg-accent",
        command.destructive && "text-destructive"
      )}
      data-command={command.id}
      id={`command-${command.id}`}
      onClick={() => run(command)}
      onPointerMove={onPointerMove}
      role="option"
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
          command.destructive ? "text-destructive" : "text-muted-foreground",
          active && !command.destructive && "text-foreground"
        )}
      >
        {icon ? <Glyph icon={icon} /> : null}
      </span>
      <CutText className="min-w-0 flex-1 truncate">{command.title}</CutText>
      {command.detail ? (
        <span className="max-w-40 shrink-0 truncate font-body-small text-muted-foreground">
          {command.detail}
        </span>
      ) : null}
      {grouped ? null : (
        <span className="shrink-0 font-body-small text-muted-foreground">
          {command.group}
        </span>
      )}
      {command.keys ? <Kbd className={KEY_CAP}>{command.keys}</Kbd> : null}
    </div>
  );
};

/** What the keys do, at the palette's foot. */
const Legend = () => (
  <div className="flex h-9 shrink-0 items-center gap-4 border-t px-3 font-body-small text-muted-foreground">
    <span className="flex items-center gap-1.5">
      <Kbd className={KEY_CAP}>↑↓</Kbd>
      Move
    </span>
    <span className="flex items-center gap-1.5">
      <Kbd className={KEY_CAP}>↵</Kbd>
      Run
    </span>
    <span className="flex items-center gap-1.5">
      <Kbd className={KEY_CAP}>Esc</Kbd>
      Close
    </span>
  </div>
);

/** Nothing found: the query, quoted, and the way back to every command. */
const NoMatch = ({
  onClear,
  query,
}: {
  onClear: () => void;
  query: string;
}) => (
  <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
    <SearchX className="mb-2 size-5 text-muted-foreground" />
    <span className="max-w-full truncate font-body-medium">
      No results for “{query}”
    </span>
    <span className="font-body-small text-muted-foreground">
      Commands, pages, canvases and chats are searched by name.
    </span>
    <Button className="mt-3" onClick={onClear} size="sm" variant="secondary">
      Clear search
    </Button>
  </div>
);

/** The list, read when the palette opens: what is selected then is what it acts on. */
const PaletteBody = () => {
  const all = useMemo(() => paletteCommands(), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const found = useMemo(() => searchCommands(all, query), [all, query]);
  const grouped = query.trim() === "";
  const current = found[Math.min(active, found.length - 1)];

  useEffect(() => {
    if (current) {
      list.current
        ?.querySelector(`[data-command="${CSS.escape(current.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [current]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const by = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + by + found.length) % Math.max(found.length, 1));
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      run(current);
    }
  };
  const clear = () => {
    setQuery("");
    setActive(0);
    input.current?.focus();
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-activedescendant={current ? `command-${current.id}` : undefined}
          aria-controls="command-list"
          aria-expanded
          aria-label="Search commands"
          autoComplete="off"
          autoFocus
          className="h-full min-w-0 flex-1 bg-transparent font-body outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search commands, pages and chats…"
          ref={input}
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </div>
      <div
        className="max-h-[min(60vh,26rem)] overflow-y-auto p-2"
        id="command-list"
        ref={list}
        role="listbox"
      >
        {found.length === 0 ? (
          <NoMatch onClear={clear} query={query.trim()} />
        ) : null}
        {found.map((command, i) => {
          const heading =
            grouped && found[i - 1]?.group !== command.group
              ? command.group
              : null;
          return (
            <div key={command.id}>
              {heading ? (
                <div
                  className={cn(
                    "px-2 pb-1 font-body-small text-muted-foreground",
                    i === 0 ? "pt-1" : "pt-3"
                  )}
                >
                  {heading}
                </div>
              ) : null}
              <Row
                active={command === current}
                command={command}
                grouped={grouped}
                onPointerMove={() => setActive(i)}
              />
            </div>
          );
        })}
      </div>
      <Legend />
    </>
  );
};

/**
 * Every command the editor has, searched by what it is called: the panels, the tools, the
 * selection's own menu, the pages, the canvases and the chats. ⌘K opens it.
 */
export const CommandPalette = () => {
  const open = usePalette((s) => s.open);
  return (
    <Dialog
      onOpenChange={(next) => usePalette.setState({ open: next })}
      open={open}
    >
      <DialogContent
        className="top-[14vh] flex translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        {open ? <PaletteBody /> : null}
      </DialogContent>
    </Dialog>
  );
};
