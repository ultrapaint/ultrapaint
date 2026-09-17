import { cn } from "cn";
import { type LucideIcon, PenTool, Play, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor, type Workspace, workspaceOrder } from "../state/editor.ts";

const look: Record<
  Workspace,
  {
    label: string;
    icon: LucideIcon;
    /** Icon tint while not active. */
    tint: string;
    /** Background and glow of the sliding pill while active. */
    pill: string;
  }
> = {
  design: {
    icon: PenTool,
    label: "Design",
    pill: "bg-sky-500 shadow-sky-500/40",
    tint: "[&_svg]:text-sky-400",
  },
  prototype: {
    icon: Play,
    label: "Prototype",
    pill: "bg-emerald-500 shadow-emerald-500/40",
    tint: "[&_svg]:text-emerald-400",
  },
  vibe: {
    icon: Sparkles,
    label: "Vibe",
    pill: "bg-violet-500 shadow-violet-500/40",
    tint: "[&_svg]:text-violet-400",
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
const widthFor = (hinting: boolean) => (hinting ? "9.75rem" : "7.5rem");

const onValueChange = (next: readonly unknown[]) => {
  const v = next[0] as Workspace | undefined;
  // Pressing the active item again would empty the group; the workspace stays.
  if (v) {
    useEditor.getState().setWorkspace(v);
  }
};

/** True while Ctrl is held: the moment to show which key reaches which workspace. */
const useCtrlHeld = () => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setHeld(e.ctrlKey);
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
  const active = workspaces[index];
  const width = widthFor(held);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <ToggleGroup
        aria-label="Workspace"
        className="pointer-events-auto relative rounded-full border bg-sidebar p-1 shadow-black/30 shadow-lg"
        onValueChange={onValueChange}
        spacing={1}
        value={[workspace]}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-1 left-1 h-9 rounded-full shadow-md transition-[translate,width,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none",
            active?.pill
          )}
          style={{
            translate: `calc(${index} * (${width} + ${gap})) 0`,
            width,
          }}
        />
        {workspaces.map((w) => {
          const Icon = w.icon;
          return (
            <ToggleGroupItem
              aria-keyshortcuts={`Control+${w.digit}`}
              className={cn(
                "relative h-9 gap-2 rounded-full px-4 font-medium text-muted-foreground text-sm transition-[color,background-color,width] duration-200 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent data-pressed:bg-transparent data-pressed:text-white data-pressed:hover:text-white [&_svg]:transition-colors [&_svg]:duration-150 data-pressed:[&_svg]:text-white",
                w.tint
              )}
              key={w.value}
              style={{ width }}
              value={w.value}
            >
              <Icon />
              {w.label}
              {held && (
                <Kbd
                  aria-hidden
                  className="fade-in-0 animate-in in-data-pressed:bg-white/25 in-data-pressed:text-white duration-150"
                >
                  ⌃{w.digit}
                </Kbd>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
};
