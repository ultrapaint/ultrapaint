import {
  GitCompareArrows,
  Layers as LayersIcon,
  LibraryBig,
  type LucideIcon,
  MessageCircle,
  Palette as PaletteIcon,
  Settings,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { worstOf } from "../lib/problems.ts";
import { someBusy } from "../lib/thread-view.ts";
import { useAgents } from "../state/agents.ts";
import { useComponents } from "../state/components.ts";
import { type LeftTab, useEditor } from "../state/editor.ts";
import {
  showLeftPanel,
  showLeftPanelStart,
  usePanels,
} from "../state/panels.ts";
import { useProblems } from "../state/problems.ts";
import { useProject } from "../state/project.ts";
import { useSurface } from "../state/surface.ts";
import { UpdateRailItem } from "./app-update.tsx";
import { GitUserButton } from "./git-user.tsx";
import { CommandKeys } from "./shortcut-sheet.tsx";

/** `label` is the panel's title, the button's name and its tooltip. */
export const railItems: Record<LeftTab, { label: string; icon: LucideIcon }> = {
  changes: { icon: GitCompareArrows, label: "Changes" },
  chat: { icon: Sparkles, label: "Agents" },
  comments: { icon: MessageCircle, label: "Comments" },
  designSystem: { icon: PaletteIcon, label: "Foundations" },
  layers: { icon: LayersIcon, label: "Layers" },
  library: { icon: LibraryBig, label: "Components" },
  problems: { icon: TriangleAlert, label: "Problems" },
};

const openSettings = () => useProject.getState().openSettings(true);

/**
 * One place on the rail: its icon, named by a tooltip and by the panel's own title once open.
 * `dot` says what is going on there (an agent is working, the sync has something waiting); it
 * sits in the icon's top-right corner, over it, so nothing moves when it comes and goes.
 */
const RailItem = ({
  active = false,
  command,
  dot = null,
  icon: Icon,
  iconClassName,
  name,
  onClick,
}: {
  active?: boolean;
  /** The command it is, whose keys the tooltip shows. */
  command?: string;
  /** What the dot says, for a screen reader; no dot when null. */
  dot?: string | null;
  icon: LucideIcon;
  /** The icon's colour, when it says something itself: Problems' warning. */
  iconClassName?: string;
  name: string;
  onClick: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          aria-label={name}
          aria-pressed={active}
          className="group relative flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 aria-pressed:bg-sidebar aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border"
          onClick={onClick}
          type="button"
        />
      }
    >
      <Icon className={cn("size-[18px]", iconClassName)} strokeWidth={1.75} />
      {dot ? (
        <span
          aria-label={dot}
          className="absolute top-1 right-1 size-2 rounded-full bg-foreground ring-2 ring-rail"
          role="status"
        />
      ) : null}
    </TooltipTrigger>
    <TooltipContent side="right">
      {name}
      {command ? <CommandKeys id={command} /> : null}
    </TooltipContent>
  </Tooltip>
);

const RailButton = ({
  iconClassName,
  value,
}: {
  iconClassName?: string;
  value: LeftTab;
}) => {
  // A panel put away is not the one open: nothing on the rail says it is.
  const hidden = usePanels((s) => s.left);
  const active = useEditor((s) => s.leftTab === value) && !hidden;
  // Agents: one is working. Changes: an agent's turn changed files nobody looked at yet.
  const agentDot = useAgents((s) => {
    if (value === "chat") {
      return someBusy(s.threads);
    }
    return value === "changes" && s.changed.length > 0;
  });
  // What the sync waits for is one of the Problems, said by their own item (ADR 0106).
  let dot: string | null = null;
  if (agentDot) {
    dot = value === "chat" ? "An agent is working" : "Changes to look at";
  }
  const item = railItems[value];
  // The open panel's button takes it back to where it starts, and never puts it away (ADR 0086).
  const onClick = () => {
    if (active) {
      showLeftPanelStart(value);
    } else {
      showLeftPanel(value);
    }
  };
  return (
    <RailItem
      active={active}
      command={`panel:${value}`}
      dot={dot}
      icon={item.icon}
      iconClassName={iconClassName}
      name={item.label}
      onClick={onClick}
    />
  );
};

/**
 * Problems (ADR 0106), at the rail's foot in either mode while there is something to fix, its icon
 * in the warning's colour, or the error's when one is an error; kept while its panel is open, so
 * the panel fixed to none still has its item.
 */
const ProblemsRailButton = () => {
  const problems = useProblems();
  const open = useEditor((s) => s.leftTab === "problems");
  if (problems.length === 0 && !open) {
    return null;
  }
  let tone = "";
  if (problems.length > 0) {
    tone = worstOf(problems) === "error" ? "text-destructive" : "text-warning";
  }
  return <RailButton iconClassName={tone} value="problems" />;
};

/**
 * The left panels the workspace offers, in a column of icons at the left card's edge: the agents
 * always first. What changed, the settings and who the user is sit at its foot, under a newer
 * release of the app while there is one (ADR 0078) and the problems while there are some (ADR 0106).
 */
export const Rail = () => {
  // The mode's places (ADR 0053): Canvas's on the page canvas, Design System's on a board view,
  // with Layers on an app component's, known once the components are: asked of the surface
  // again when they change, as it reads them itself.
  const surface = useSurface();
  const tabs = useComponents(useShallow(() => surface.railTabs()));
  return (
    <nav
      aria-label="Panels"
      className="flex min-h-0 w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto pt-0.5 pb-2 [scrollbar-width:none]"
    >
      {tabs
        .filter((value) => value !== "changes" && value !== "problems")
        .map((value) => (
          <RailButton key={value} value={value} />
        ))}
      <div className="flex-1" />
      <UpdateRailItem />
      {tabs.includes("problems") ? <ProblemsRailButton /> : null}
      {tabs.includes("changes") ? <RailButton value="changes" /> : null}
      <RailItem
        command="settings"
        icon={Settings}
        name="Settings"
        onClick={openSettings}
      />
      <div className="mt-1 flex size-8 items-center justify-center">
        <GitUserButton />
      </div>
    </nav>
  );
};
