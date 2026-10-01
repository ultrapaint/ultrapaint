import { cn } from "cn";
import { type LucideIcon, PenTool, Play, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  holdsWorkspaceModifier,
  workspaceKeyLabel,
  workspaceModifier,
} from "../lib/keys.ts";
import { useEditor, type Workspace, workspaceOrder } from "../state/editor.ts";

const look: Record<
  Workspace,
  {
    label: string;
    icon: LucideIcon;
    /** Icon tint while active: the one touch of colour, so the switch stays quiet. */
    tint: string;
  }
> = {
  design: {
    icon: PenTool,
    label: "Design",
    tint: "data-pressed:[&_svg]:text-sky-500",
  },
  prototype: {
    icon: Play,
    label: "Prototype",
    tint: "data-pressed:[&_svg]:text-emerald-500",
  },
  vibe: {
    icon: Sparkles,
    label: "Vibe",
    tint: "data-pressed:[&_svg]:text-violet-500",
  },
};

const workspaces = workspaceOrder.map((value, i) => ({
  ...look[value],
  digit: i + 1,
  value,
}));

/** Items share one width and gap so the pill's position follows from the index alone. */
const gap = "0.25rem";
/** Shortcut hints need room of their own, so revealing them widens every item at once. */
const widthFor = (hinting: boolean) => (hinting ? "8.75rem" : "6.5rem");

const onValueChange = (next: readonly unknown[]) => {
  const v = next[0] as Workspace | undefined;
  // Pressing the active item again would empty the group; the workspace stays.
  if (v) {
    useEditor.getState().setWorkspace(v);
  }
};

/** True while the workspace modifier is held: the moment to show which key reaches which workspace. */
const useCtrlHeld = () => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setHeld(holdsWorkspaceModifier(e));
    // A key released while the window is in the background never reaches keyup.
    const blur = () => setHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return held;
};

/** Floating switch between the workspaces at the top centre of the main area. */
export const WorkspaceSwitcher = () => {
  const workspace = useEditor((s) => s.workspace);
  const held = useCtrlHeld();
  const index = workspaces.findIndex((w) => w.value === workspace);
  const width = widthFor(held);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <ToggleGroup
        aria-label="Workspace"
        className="pointer-events-auto relative rounded-full border bg-sidebar/90 p-1 shadow-black/10 shadow-sm backdrop-blur-sm"
        onValueChange={onValueChange}
        spacing={1}
        value={[workspace]}
      >
        <span
          aria-hidden
          className="absolute top-1 left-1 h-8 rounded-full bg-background shadow-black/5 shadow-xs ring-1 ring-border transition-[translate,width] duration-200 ease-out motion-reduce:transition-none dark:bg-accent dark:ring-0"
          style={{
            translate: `calc(${index} * (${width} + ${gap})) 0`,
            width,
          }}
        />
        {workspaces.map((w) => {
          const Icon = w.icon;
          return (
            <ToggleGroupItem
              aria-keyshortcuts={`${workspaceModifier}+${w.digit}`}
              className={cn(
                "relative h-8 gap-2 rounded-full px-3 font-medium text-muted-foreground text-sm transition-[color,background-color,width] duration-200 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent data-pressed:bg-transparent data-pressed:text-foreground [&_svg]:transition-colors [&_svg]:duration-150",
                w.tint
              )}
              key={w.value}
              style={{ width }}
              value={w.value}
            >
              <Icon />
              {w.label}
              {held && (
                <Kbd aria-hidden className="fade-in-0 animate-in duration-150">
                  {workspaceKeyLabel(w.digit)}
                </Kbd>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
};
