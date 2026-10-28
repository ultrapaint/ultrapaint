import { create } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { commandGroups, keysOf, shortcuts } from "../lib/commands.ts";

const useShortcutSheet = create<{ open: boolean }>(() => ({
  open: false,
}));

export const openShortcutSheet = () =>
  useShortcutSheet.setState({ open: true });

/** A command's keys, as this platform writes them, for a tooltip or a menu; nothing for none. */
export const CommandKeys = ({ id }: { id: string }) => {
  const keys = keysOf(id);
  return keys ? <Kbd>{keys}</Kbd> : null;
};

/** The sheet `?` opens: what every key does, as this platform writes it. */
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
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section className="flex flex-col gap-1.5" key={group.title}>
              <h3 className="font-heading-xsmall text-muted-foreground">
                {group.title}
              </h3>
              {group.keys.map(({ keys, title }) => (
                <div
                  className="flex items-center justify-between gap-3 font-body"
                  key={title}
                >
                  <span>{title}</span>
                  <Kbd>{keys}</Kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
