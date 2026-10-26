import { cn } from "cn";
import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  type Command,
  paletteCommands,
  searchCommands,
} from "../lib/commands.ts";
import { keysLabel } from "../lib/keys.ts";

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
}) => (
  // biome-ignore lint/a11y/useFocusableInteractive: the input keeps the focus; the active row is its aria-activedescendant.
  // biome-ignore lint/a11y/useKeyWithClickEvents: the input's arrows and Enter are the keys.
  <div
    aria-selected={active}
    className={cn(
      "flex h-8 cursor-default items-center gap-2 rounded-md px-2 font-body",
      active && "bg-accent text-accent-foreground",
      command.destructive && "text-destructive"
    )}
    data-command={command.id}
    id={`command-${command.id}`}
    onClick={() => run(command)}
    onPointerMove={onPointerMove}
    role="option"
  >
    <span className="min-w-0 flex-1 truncate">{command.title}</span>
    {command.detail ? (
      <span className="max-w-40 shrink-0 truncate text-muted-foreground">
        {command.detail}
      </span>
    ) : null}
    {grouped ? null : (
      <span className="shrink-0 text-muted-foreground">{command.group}</span>
    )}
    {command.keys ? <Kbd>{keysLabel(command.keys)}</Kbd> : null}
  </div>
);

/** The list, read when the palette opens: what is selected then is what it acts on. */
const PaletteBody = () => {
  const all = useMemo(() => paletteCommands(), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
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

  return (
    <>
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-activedescendant={current ? `command-${current.id}` : undefined}
          aria-controls="command-list"
          aria-expanded
          aria-label="Search the commands"
          autoComplete="off"
          autoFocus
          className="h-full min-w-0 flex-1 bg-transparent font-body outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="What do you want to do?"
          role="combobox"
          value={query}
        />
      </div>
      <div
        className="max-h-[min(60vh,28rem)] overflow-y-auto p-1"
        id="command-list"
        ref={list}
        role="listbox"
      >
        {found.length === 0 ? (
          <div className="px-2 py-6 text-center font-body text-muted-foreground">
            Nothing matches “{query.trim()}”
          </div>
        ) : null}
        {found.map((command, i) => {
          const heading =
            grouped && found[i - 1]?.group !== command.group
              ? command.group
              : null;
          return (
            <div key={command.id}>
              {heading ? (
                <div className="px-2 pt-2 pb-1 font-heading-xsmall text-muted-foreground">
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
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        {open ? <PaletteBody /> : null}
      </DialogContent>
    </Dialog>
  );
};
