import {
  GitCompareArrows,
  Layers as LayersIcon,
  type LucideIcon,
  MessageCircle,
  MonitorSmartphone,
  Palette as PaletteIcon,
  Settings,
  Shapes,
  Sparkles,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useAgents } from "../state/agents.ts";
import { type LeftTab, railTabs, useEditor } from "../state/editor.ts";
import { openLeftPanel, usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { syncWaiting, useSync } from "../state/sync.ts";
import { GitUserButton } from "./git-user.tsx";

/** `rail` is the word under the icon, `label` the panel's title and the button's name. */
export const railItems: Record<
  LeftTab,
  { label: string; rail: string; icon: LucideIcon }
> = {
  assets: { icon: Shapes, label: "Assets", rail: "Assets" },
  changes: { icon: GitCompareArrows, label: "Changes", rail: "Changes" },
  chat: { icon: Sparkles, label: "Agents", rail: "Agents" },
  comments: { icon: MessageCircle, label: "Comments", rail: "Comments" },
  designSystem: {
    icon: PaletteIcon,
    label: "Design system",
    rail: "Design system",
  },
  layers: { icon: LayersIcon, label: "Layers", rail: "Layers" },
  pages: { icon: MonitorSmartphone, label: "Pages", rail: "Pages" },
};

const openSettings = () => useProject.getState().openSettings(true);

/**
 * One place on the rail: the icon in its tile, the word under it. `dot` says what is going on
 * there (an agent is working, the sync has something waiting); it sits in the icon's own
 * top-right corner, over it, so nothing moves when it comes and goes.
 */
const RailItem = ({
  active = false,
  dot = null,
  icon: Icon,
  label,
  name,
  onClick,
}: {
  active?: boolean;
  /** What the dot says, for a screen reader; no dot when null. */
  dot?: string | null;
  icon: LucideIcon;
  label: string;
  name: string;
  onClick: () => void;
}) => (
  <button
    aria-label={name}
    aria-pressed={active}
    className="group flex w-14 flex-col items-center gap-0.5 rounded-lg py-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:text-foreground"
    onClick={onClick}
    title={name === label ? undefined : name}
    type="button"
  >
    <span className="flex h-7.5 w-9 items-center justify-center rounded-lg transition-colors group-hover:bg-muted group-aria-pressed:bg-muted">
      <span className="relative flex">
        <Icon className="size-4.5" />
        {dot ? (
          <span
            aria-label={dot}
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-agent ring-2 ring-sidebar group-hover:ring-muted group-aria-pressed:ring-muted"
            role="status"
          />
        ) : null}
      </span>
    </span>
    <span className="line-clamp-2 w-full text-center font-rail">{label}</span>
  </button>
);

const RailButton = ({ value }: { value: LeftTab }) => {
  // A panel put away is not the one open: nothing on the rail says it is.
  const hidden = usePanels((s) => s.left);
  const active = useEditor((s) => s.leftTab === value) && !hidden;
  // Agents: one is working. Changes: an agent's turn changed files nobody looked at yet.
  const agentDot = useAgents((s) => {
    if (value === "chat") {
      return s.threads.some((t) => t.status === "running");
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
      openLeftPanel(value);
    }
  };
  return (
    <RailItem
      active={active}
      dot={dot}
      icon={item.icon}
      label={item.rail}
      name={item.label}
      onClick={onClick}
    />
  );
};

/**
 * The left panels the workspace offers, floating in a column of their own at the window's left,
 * each named under its icon: the agents always first. Settings and who the user is at its foot.
 */
export const Rail = () => {
  const workspace = useEditor((s) => s.workspace);
  return (
    <nav
      aria-label="Panels"
      className="floating pointer-events-auto flex w-16 shrink-0 flex-col items-center gap-0.5 py-2"
    >
      {railTabs[workspace].map((value) => (
        <RailButton key={value} value={value} />
      ))}
      <div className="flex-1" />
      <RailItem
        icon={Settings}
        label="Settings"
        name="Settings"
        onClick={openSettings}
      />
      <Separator className="mt-1.5 mb-2 w-7" />
      <GitUserButton />
    </nav>
  );
};
