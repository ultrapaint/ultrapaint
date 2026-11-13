/**
 * The settings' sections, grouped by whose they are (yours in every project, the project's, this
 * computer's), and every setting in them for the search: its name, its section, and the words
 * someone might look for it by.
 */
import {
  BookOpen,
  Bot,
  FolderGit2,
  Info,
  Keyboard,
  type LucideIcon,
  MessageSquare,
  MessageSquareCheck,
  Palette,
  Plug,
  SlidersHorizontal,
  SwatchBook,
} from "lucide-react";

export type SectionId =
  | "general"
  | "appearance"
  | "chats"
  | "shortcuts"
  | "repository"
  | "designSystem"
  | "review"
  | "skills"
  | "agents"
  | "connections"
  | "about";

export interface Section {
  icon: LucideIcon;
  id: SectionId;
  label: string;
}

export type Scope = "you" | "project" | "computer";

/** The groups, in the order the dialog lists them. The project's is named after the project. */
export const SECTION_GROUPS: readonly {
  scope: Scope;
  sections: readonly Section[];
}[] = [
  {
    scope: "you",
    sections: [
      { icon: SlidersHorizontal, id: "general", label: "General" },
      { icon: Palette, id: "appearance", label: "Appearance" },
      { icon: MessageSquare, id: "chats", label: "Chats" },
      { icon: Keyboard, id: "shortcuts", label: "Shortcuts" },
    ],
  },
  {
    scope: "project",
    sections: [
      { icon: FolderGit2, id: "repository", label: "Repository" },
      { icon: SwatchBook, id: "designSystem", label: "Design system" },
      { icon: MessageSquareCheck, id: "review", label: "Review" },
      { icon: BookOpen, id: "skills", label: "Skills" },
    ],
  },
  {
    scope: "computer",
    sections: [
      { icon: Bot, id: "agents", label: "Agents" },
      { icon: Plug, id: "connections", label: "Connections" },
      { icon: Info, id: "about", label: "About" },
    ],
  },
];

export const SECTIONS: readonly Section[] = SECTION_GROUPS.flatMap(
  (g) => g.sections
);

/** The group's label: the project's carries the project's name. */
export const scopeLabel = (scope: Scope, project?: string) => {
  if (scope === "you") {
    return "You";
  }
  if (scope === "computer") {
    return "This computer";
  }
  return project ? `Project · ${project}` : "Project";
};

export const scopeOf = (id: SectionId): Scope =>
  SECTION_GROUPS.find((g) => g.sections.some((s) => s.id === id))?.scope ??
  "you";

/** Names a link or an older version of the editor used for a section. */
const FORMER: Record<string, SectionId> = { editor: "general" };

/** The section a name in the URL or a caller means, if any. */
export const sectionNamed = (name: string | undefined): SectionId | null => {
  if (!name) {
    return null;
  }
  const id = FORMER[name] ?? name;
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : null;
};

export const labelOf = (id: SectionId) =>
  SECTIONS.find((s) => s.id === id)?.label ?? id;

/** A setting as the search finds it: the row it scrolls to is `[data-setting=id]`. */
export interface SettingEntry {
  id: string;
  section: SectionId;
  /** Other words it is looked for by. */
  terms?: string;
  title: string;
}

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  {
    id: "display-name",
    section: "general",
    terms: "name avatar profile comments",
    title: "Display name",
  },
  {
    id: "notifications",
    section: "general",
    terms: "notify sound alert finished done asks",
    title: "Notifications",
  },
  {
    id: "keep-findings",
    section: "general",
    terms: "review findings log data",
    title: "Keep review findings",
  },
  {
    id: "theme",
    section: "appearance",
    terms: "dark light system mode colour scheme",
    title: "Theme",
  },
  {
    id: "accent",
    section: "appearance",
    terms: "colour color primary highlight",
    title: "Accent",
  },
  {
    id: "grid",
    section: "appearance",
    terms: "snap cells canvas",
    title: "Grid",
  },
  {
    id: "comments",
    section: "appearance",
    terms: "pins notes canvas",
    title: "Comments",
  },
  {
    id: "scroll-wheel",
    section: "appearance",
    terms: "mouse zoom pan scroll",
    title: "Scroll wheel",
  },
  {
    id: "text-size",
    section: "appearance",
    terms: "font size zoom larger smaller",
    title: "Text size",
  },
  {
    id: "contrast",
    section: "appearance",
    terms: "accessibility muted borders",
    title: "Increase contrast",
  },
  {
    id: "motion",
    section: "appearance",
    terms: "animation reduce motion transitions",
    title: "Motion",
  },
  {
    id: "chat-agent",
    section: "chats",
    terms: "new chat default claude codex",
    title: "Agent",
  },
  {
    id: "chat-model",
    section: "chats",
    terms: "new chat default",
    title: "Model",
  },
  {
    id: "chat-effort",
    section: "chats",
    terms: "reasoning thinking",
    title: "Effort",
  },
  {
    id: "chat-permissions",
    section: "chats",
    terms: "mode approve auto",
    title: "Permissions",
  },
  {
    id: "send-key",
    section: "chats",
    terms: "enter composer newline submit",
    title: "Send key",
  },
  {
    id: "shortcuts",
    section: "shortcuts",
    terms: "keys keyboard keybindings hotkeys",
    title: "Shortcuts",
  },
  {
    id: "folder",
    section: "repository",
    terms: "path repository root",
    title: "Folder",
  },
  {
    id: "designs",
    section: "repository",
    terms: "designs directory pages canvases",
    title: "Designs",
  },
  {
    id: "page-pngs",
    section: "repository",
    terms: "png image diffs pull requests",
    title: "Write a PNG of every design",
  },
  {
    id: "application",
    section: "repository",
    terms: "package.json app resolve",
    title: "Application",
  },
  {
    id: "components",
    section: "repository",
    terms: "component directories library",
    title: "Components",
  },
  {
    id: "detect",
    section: "repository",
    terms: "detect again fill",
    title: "Detect again",
  },
  {
    id: "design-system",
    section: "designSystem",
    terms: "tokens colours text styles update agent",
    title: "Design system",
  },
  {
    id: "design-md",
    section: "designSystem",
    terms: "design.md linter",
    title: "DESIGN.md",
  },
  {
    id: "stylesheets",
    section: "designSystem",
    terms: "css tailwind fonts tokens sync",
    title: "Stylesheets",
  },
  {
    id: "review-level",
    section: "review",
    terms: "off quick standard thorough custom",
    title: "Level",
  },
  {
    id: "review-models",
    section: "review",
    terms: "reviewers models council",
    title: "Review models",
  },
  {
    id: "skills-sent-as",
    section: "skills",
    terms: "told core whole summaries briefing",
    title: "Sent as",
  },
  {
    id: "skills",
    section: "skills",
    terms: "design skills files",
    title: "Skills",
  },
  {
    id: "machine-agents",
    section: "agents",
    terms: "install sign in download claude codex api key executable",
    title: "Agents on this computer",
  },
  {
    id: "mcp",
    section: "connections",
    terms: "mcp outside terminal claude code codex command",
    title: "Agents outside the editor",
  },
  {
    id: "command",
    section: "connections",
    terms: "ultrapaint command line install path",
    title: "Command line",
  },
  {
    id: "version",
    section: "about",
    terms: "update version release",
    title: "Check for updates",
  },
  {
    id: "folders",
    section: "about",
    terms: "folder .ultrapaint data move location",
    title: "Your folder",
  },
  {
    id: "documentation",
    section: "about",
    terms: "docs help",
    title: "Documentation",
  },
  {
    id: "report",
    section: "about",
    terms: "bug issue github problem",
    title: "Report a problem",
  },
];

const SPACES_RE = /\s+/;

/** How well a title matches: its start, every word in it, or only through the other words. */
const scoreOf = (title: string, words: readonly string[]) => {
  if (title.startsWith(words.join(" "))) {
    return 0;
  }
  return words.every((w) => title.includes(w)) ? 1 : 2;
};

/** Every word of the query in the setting's title, section or terms; the title's own first. */
export const searchSettings = (
  query: string,
  shown: (section: SectionId) => boolean = () => true
): SettingEntry[] => {
  const words = query.toLowerCase().split(SPACES_RE).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const scored = SETTINGS_INDEX.filter((e) => shown(e.section)).flatMap((e) => {
    const title = e.title.toLowerCase();
    const all = `${title} ${labelOf(e.section).toLowerCase()} ${e.terms ?? ""}`;
    if (!words.every((w) => all.includes(w))) {
      return [];
    }
    const score = scoreOf(title, words);
    return [{ e, score }];
  });
  return scored.sort((a, b) => a.score - b.score).map((s) => s.e);
};
