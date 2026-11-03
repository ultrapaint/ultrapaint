import {
  GitCompareArrows,
  Layers as LayersIcon,
  LibraryBig,
  type LucideIcon,
  MessageCircle,
  Palette as PaletteIcon,
  Settings,
  Sparkles,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { someBusy } from "../lib/thread-view.ts";
import { useAgents } from "../state/agents.ts";
import { useComponents } from "../state/components.ts";
import { type LeftTab, useEditor } from "../state/editor.ts";
import { showLeftPanel, usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { useSurface } from "../state/surface.ts";
import { syncWaiting, useSync } from "../state/sync.ts";
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
  name,
  onClick,
}: {
  active?: boolean;
  /** The command it is, whose keys the tooltip shows. */
  command?: string;
  /** What the dot says, for a screen reader; no dot when null. */
  dot?: string | null;
  icon: LucideIcon;
  name: string;
  onClick: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          aria-label={name}
          aria-pressed={active}
          className="group relative flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 aria-pressed:bg-sidebar aria-pressed:text-foreground aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-border"
          onClick={onClick}
          type="button"
        />
      }
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      {dot ? (
        <span
          aria-label={dot}
          className="absolute top-1 right-1 size-2 rounded-full bg-agent ring-2 ring-rail"
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

const RailButton = ({ value }: { value: LeftTab }) => {
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
  // Design system: the sync has something waiting, a drift or settings to fix (ADR 0025).
  const syncDot = useSync(
    (s) => value === "designSystem" && syncWaiting(s.plan)
  );
  let dot: string | null = null;
  if (agentDot) {
    dot = value === "chat" ? "An agent is working" : "Changes to look at";
  } else if (syncDot) {
    dot = "The design system and the code need syncing";
  }
  const item = railItems[value];
  // The open panel's button puts it away, as a second click on a tab of pen.dev or Figma does.
  const onClick = () => {
    if (active) {
      usePanels.getState().setHidden({ left: true });
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
      name={item.label}
      onClick={onClick}
    />
  );
};

/**
 * The left panels the workspace offers, in a column of icons at the left card's edge: the agents
 * always first. What changed, the settings and who the user is sit at its foot.
 */
export const Rail = () => {
  // The mode's places (ADR 0053): Canvas's on the page canvas, Design System's on a board view,
  // with Layers on an app component's, known once the components are.
  const surface = useSurface();
  useComponents((s) => s.components);
  const tabs = surface.railTabs();
  return (
    <nav
      aria-label="Panels"
      className="flex min-h-0 w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto pt-0.5 pb-2 [scrollbar-width:none]"
    >
      {tabs
        .filter((value) => value !== "changes")
        .map((value) => (
          <RailButton key={value} value={value} />
        ))}
      <div className="flex-1" />
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
