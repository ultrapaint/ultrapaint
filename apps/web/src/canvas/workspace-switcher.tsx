import { cn } from "cn";
import { type LucideIcon, PenTool, Play, Sparkles } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor, type Workspace } from "../state/editor.ts";

const workspaces: {
  value: Workspace;
  label: string;
  icon: LucideIcon;
  /** Icon tint while not active. */
  tint: string;
  /** Background and glow of the sliding pill while active. */
  pill: string;
}[] = [
  {
    icon: Sparkles,
    label: "Vibe",
    pill: "bg-violet-500 shadow-violet-500/40",
    tint: "[&_svg]:text-violet-400",
    value: "vibe",
  },
  {
    icon: PenTool,
    label: "Design",
    pill: "bg-sky-500 shadow-sky-500/40",
    tint: "[&_svg]:text-sky-400",
    value: "design",
  },
  {
    icon: Play,
    label: "Prototype",
    pill: "bg-emerald-500 shadow-emerald-500/40",
    tint: "[&_svg]:text-emerald-400",
    value: "prototype",
  },
];

/** Items share one width and gap so the pill's position follows from the index alone. */
const itemWidth = "7.5rem";
const gap = "0.25rem";

const onValueChange = (next: readonly unknown[]) => {
  const v = next[0] as Workspace | undefined;
  // Pressing the active item again would empty the group; the workspace stays.
  if (v) {
    useEditor.getState().setWorkspace(v);
  }
};

/** Floating switch between the workspaces at the top centre of the main area. */
export const WorkspaceSwitcher = () => {
  const workspace = useEditor((s) => s.workspace);
  const index = workspaces.findIndex((w) => w.value === workspace);
  const active = workspaces[index];
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
            "absolute top-1 left-1 h-9 rounded-full shadow-md transition-[translate,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none",
            active?.pill
          )}
          style={{
            translate: `calc(${index} * (${itemWidth} + ${gap})) 0`,
            width: itemWidth,
          }}
        />
        {workspaces.map((w) => {
          const Icon = w.icon;
          return (
            <ToggleGroupItem
              className={cn(
                "relative h-9 gap-2 rounded-full px-4 font-medium text-muted-foreground text-sm transition-colors duration-150 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent data-pressed:bg-transparent data-pressed:text-white data-pressed:hover:text-white [&_svg]:transition-colors [&_svg]:duration-150 data-pressed:[&_svg]:text-white",
                w.tint
              )}
              key={w.value}
              style={{ width: itemWidth }}
              value={w.value}
            >
              <Icon />
              {w.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
};
