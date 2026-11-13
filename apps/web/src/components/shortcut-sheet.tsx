import { create } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { commandGroups, keysOf, shortcuts } from "../lib/commands.ts";
import { useKeybindings } from "../state/keybindings.ts";

const useShortcutSheet = create<{ open: boolean }>(() => ({
  open: false,
}));

export const openShortcutSheet = () =>
  useShortcutSheet.setState({ open: true });

/**
 * A command's keys now, the person's when they changed them, as this platform writes them, for
 * a tooltip or a menu; nothing for none.
 */
export const CommandKeys = ({
  className,
  id,
}: {
  className?: string;
  id: string;
}) => {
  useKeybindings((s) => s.overrides);
  const keys = keysOf(id);
  return keys ? <Kbd className={className}>{keys}</Kbd> : null;
};

/** The sheet `?` opens: what every key does now, as this platform writes it. */
export const ShortcutSheet = () => {
  const open = useShortcutSheet((s) => s.open);
  // Every key, in the palette's groups; read as the sheet opens.
  const groups = open
    ? commandGroups.flatMap((title) => {
        const keys = shortcuts().filter((k) => k.group === title);
        return keys.length > 0 ? [{ keys, title }] : [];
      })
    : [];
  return (
    <Dialog
      onOpenChange={(next) => useShortcutSheet.setState({ open: next })}
      open={open}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 columns-2 gap-10 overflow-y-auto px-5 pb-5">
          {groups.map((group) => (
            <section
              className="mb-5 flex break-inside-avoid flex-col"
              key={group.title}
            >
              <h3 className="pb-1 font-body-small text-muted-foreground">
                {group.title}
              </h3>
              {group.keys.map(({ keys, title }) => (
                <div
                  className="flex min-h-7 items-center justify-between gap-4 py-1 font-body"
                  key={title}
                >
                  <span className="text-pretty">{title}</span>
                  <Kbd className="shrink-0 bg-transparent ring-1 ring-border ring-inset">
                    {keys}
                  </Kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
