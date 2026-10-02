import { create } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { shortcutLabel, workspaceKeyLabel } from "../lib/keys.ts";

const WORKSPACE_KEY_RE = /^⌃([1-9])$/;

export const useShortcutSheet = create<{ open: boolean }>(() => ({
  open: false,
}));

export const openShortcutSheet = () =>
  useShortcutSheet.setState({ open: true });

/** Every shortcut, in the groups a person looks for them by, written the Mac way. */
const GROUPS: readonly {
  readonly title: string;
  readonly keys: readonly (readonly [keys: string, what: string])[];
}[] = [
  {
    keys: [
      ["⌃1", "Vibe"],
      ["⌃2", "Design"],
      ["⌃3", "Prototype"],
      ["⌘\\", "Hide or show the panels"],
      ["?", "These shortcuts"],
    ],
    title: "Workspaces",
  },
  {
    keys: [
      ["V", "Select"],
      ["G", "Group: draw a container"],
      ["T", "Text"],
      ["I", "Use components: press their buttons, open their menus"],
      ["H", "Pan, or hold Space"],
      ["C", "Comment"],
      ["⇧C", "Show or hide comments"],
    ],
    title: "Tools",
  },
  {
    keys: [
      ["⌘Z", "Undo"],
      ["⇧⌘Z", "Redo"],
      ["⌘C", "Copy"],
      ["⌘X", "Cut"],
      ["⌘V", "Paste"],
      ["⌘D", "Duplicate"],
      ["⌘G", "Wrap in a group"],
      ["⌥⌘G", "Wrap in a row"],
      ["⇧⌘G", "Wrap in a column"],
      ["⌫", "Delete"],
      ["↩", "Edit the text"],
      ["Esc", "Select the parent"],
      ["↑ ↓", "Select the previous or next element"],
      ["← →", "Select the parent or the first child"],
      ["⇧F10", "Open the element's menu"],
    ],
    title: "Elements",
  },
  {
    keys: [
      ["⇧1", "Zoom to fit"],
      ["⇧2", "Zoom to the selection"],
      ["⇧0", "Zoom to 100%"],
      ["⌘=", "Zoom in"],
      ["⌘-", "Zoom out"],
    ],
    title: "View",
  },
];

/** A Mac-written key as this platform writes it; workspace keys use the platform's own modifier. */
const labelOf = (keys: string) => {
  const match: RegExpExecArray | null = WORKSPACE_KEY_RE.exec(keys);
  return match ? workspaceKeyLabel(Number(match[1])) : shortcutLabel(keys);
};

/** The sheet `?` opens: what every key does, as this platform writes it. */
export const ShortcutSheet = () => {
  const open = useShortcutSheet((s) => s.open);
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
          {GROUPS.map((group) => (
            <section className="flex flex-col gap-1.5" key={group.title}>
              <h3 className="font-heading-xsmall text-muted-foreground">
                {group.title}
              </h3>
              {group.keys.map(([keys, what]) => (
                <div
                  className="flex items-center justify-between gap-3 font-body"
                  key={what}
                >
                  <span>{what}</span>
                  <Kbd>{labelOf(keys)}</Kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
