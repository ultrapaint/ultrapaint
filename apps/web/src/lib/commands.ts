/**
 * Everything the editor can be asked to do from the command palette (⌘K), and every key it
 * answers to, in one list: the palette runs the commands, and the shortcut sheet lists their
 * keys. The palette adds what depends on the moment beside them: the selection's own menu, the
 * pages, the canvases and the chats. Keys are written once, the Mac way, and shown as the
 * platform writes them.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread } from "@ultrapaint/contracts/threads";
import { openShortcutSheet } from "../components/shortcut-sheet.tsx";
import { useAgents } from "../state/agents.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { toggleCommenting, useComments } from "../state/comments.ts";
import type { MenuTarget } from "../state/context-menu.ts";
import {
  type LeftTab,
  type Mode,
  pagesOfCanvas,
  type RightTab,
  railTabs,
  useEditor,
  type Workspace,
} from "../state/editor.ts";
import { openLeftPanel, usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { newCanvas, openCanvas } from "./canvas-actions.ts";
import { pickFigmaFile } from "./import-figma.ts";
import { entriesFor, runEntry } from "./menu-actions.ts";
import type { Entry } from "./menu-model.ts";
import { goToPage, newPage, zoomToPage } from "./page-actions.ts";
import { undoOrRedo, viewportSize, zoomBy } from "./shortcuts.ts";
import { createThread } from "./start-thread.ts";

/** The sections of the palette and of the shortcut sheet, in the order they are shown. */
export const commandGroups = [
  "Selection",
  "Agents",
  "Panels",
  "Tools",
  "Edit",
  "View",
  "Go to",
  "Project",
] as const;
export type CommandGroup = (typeof commandGroups)[number];

/** A key the editor answers to, as the shortcut sheet lists it. */
export interface Shortcut {
  group: CommandGroup;
  /** The keys, the Mac way: `⇧⌘Z`, `⌃1`. */
  keys: string;
  title: string;
}

export interface Command {
  destructive?: boolean;
  /** Further words on the right of its title: where a page is, who a chat is with. */
  detail?: string;
  group: CommandGroup;
  id: string;
  /** Its shortcut, the Mac way; listed in the sheet too. */
  keys?: string;
  /** Other words it is found by. */
  keywords?: string;
  run: () => void;
  title: string;
}

const editor = () => useEditor.getState();
const onCanvas = () => editor().workspace === "design";

/** Picks a tool of the canvas; commenting shows the comments too. */
const pickTool = (tool: Mode) => {
  if (editor().workspace === "prototype") {
    if (tool === "comment") {
      toggleCommenting();
    }
    return;
  }
  editor().setMode(tool);
  if (tool === "comment" && !useComments.getState().visible) {
    useComments.getState().toggleVisible();
  }
};

const showRight = (tab: RightTab) => {
  editor().setWorkspace("design");
  editor().setRightTab(tab);
  usePanels.getState().setHidden({ right: false });
};

const leftPanels: readonly {
  tab: LeftTab;
  title: string;
  keywords?: string;
}[] = [
  { keywords: "chat threads agent", tab: "chat", title: "Agents" },
  { keywords: "tree outline", tab: "layers", title: "Layers" },
  { keywords: "components images insert", tab: "assets", title: "Assets" },
  {
    keywords: "tokens theme sync",
    tab: "designSystem",
    title: "Design system",
  },
  { keywords: "history diff git", tab: "changes", title: "Changes" },
];

const tools: readonly { keys: string; title: string; tool: Mode }[] = [
  { keys: "V", title: "Select", tool: "select" },
  { keys: "G", title: "Group: draw a container", tool: "group" },
  { keys: "T", title: "Text", tool: "text" },
  {
    keys: "I",
    title: "Use components: press their buttons, open their menus",
    tool: "interact",
  },
  { keys: "H", title: "Pan, or hold Space", tool: "pan" },
  { keys: "C", title: "Comment", tool: "comment" },
];

const workspaces: readonly { title: string; workspace: Workspace }[] = [
  { title: "Canvas", workspace: "design" },
  { title: "Prototype: click through the design", workspace: "prototype" },
];

/** The commands that make sense now: the panels the workspace offers, the canvas's tools on it. */
export const commands = (): Command[] => {
  const { workspace } = editor();
  const panels = usePanels.getState();
  const { settings, info } = useProject.getState();
  const offered = workspace === "design" ? railTabs : [];
  const list: Command[] = [
    {
      group: "Agents",
      id: "newChat",
      keywords: "thread agent prompt ask",
      run: () => {
        openLeftPanel("chat");
        createThread();
      },
      title: "New chat with an agent",
    },
    ...leftPanels
      .filter((p) => offered.includes(p.tab))
      .map(
        (p): Command => ({
          group: "Panels",
          id: `panel:${p.tab}`,
          ...(p.keywords ? { keywords: p.keywords } : {}),
          run: () => openLeftPanel(p.tab),
          title: `Show ${p.title}`,
        })
      ),
    ...(onCanvas()
      ? [
          {
            group: "Panels",
            id: "right:design",
            keywords: "inspector properties style",
            run: () => showRight("design"),
            title: "Show the inspector",
          } satisfies Command,
          {
            group: "Panels",
            id: "right:code",
            keywords: "jsx tailwind source",
            run: () => showRight("code"),
            title: "Show the code",
          } satisfies Command,
          {
            group: "Panels",
            id: "right:comments",
            keywords: "feedback notes pins",
            run: () => showRight("comments"),
            title: "Show the comments",
          } satisfies Command,
        ]
      : []),
    {
      group: "Panels",
      id: "toggleLeft",
      keywords: "sidebar",
      run: () => panels.toggleLeft(),
      title: panels.left ? "Show the left panel" : "Hide the left panel",
    },
    ...(onCanvas()
      ? [
          {
            group: "Panels",
            id: "toggleRight",
            keywords: "sidebar inspector code",
            run: () => panels.toggleRight(),
            title: panels.right
              ? "Show the right panel"
              : "Hide the right panel",
          } satisfies Command,
        ]
      : []),
    {
      group: "Panels",
      id: "toggleAll",
      keys: "⌘\\",
      keywords: "sidebar focus",
      run: () => panels.toggleAll(),
      title: "Hide or show the panels",
    },
    ...workspaces.map(
      (w, i): Command => ({
        group: "View",
        id: `workspace:${w.workspace}`,
        keys: `⌃${i + 1}`,
        keywords: w.workspace === "prototype" ? "play preview" : "design edit",
        run: () => editor().setWorkspace(w.workspace),
        title: w.title,
      })
    ),
    ...(workspace === "design"
      ? tools.map(
          (t): Command => ({
            group: "Tools",
            id: `tool:${t.tool}`,
            keys: t.keys,
            run: () => pickTool(t.tool),
            title: t.title,
          })
        )
      : [
          {
            group: "Tools",
            id: "tool:comment",
            keys: "C",
            run: () => pickTool("comment"),
            title: "Comment",
          } satisfies Command,
        ]),
    {
      group: "Tools",
      id: "toggleComments",
      keys: "⇧C",
      run: () => useComments.getState().toggleVisible(),
      title: useComments.getState().visible ? "Hide comments" : "Show comments",
    },
    {
      group: "Edit",
      id: "undo",
      keys: "⌘Z",
      run: () => undoOrRedo(false),
      title: "Undo",
    },
    {
      group: "Edit",
      id: "redo",
      keys: "⇧⌘Z",
      run: () => undoOrRedo(true),
      title: "Redo",
    },
    ...(onCanvas()
      ? [
          {
            group: "View",
            id: "zoomFit",
            keys: "⇧1",
            run: () => editor().zoomToFit(viewportSize()),
            title: "Zoom to fit",
          } satisfies Command,
          {
            group: "View",
            id: "zoomSelection",
            keys: "⇧2",
            run: () => editor().zoomToSelection(viewportSize()),
            title: "Zoom to the selection",
          } satisfies Command,
          {
            group: "View",
            id: "zoom100",
            keys: "⇧0",
            run: () => editor().setView({ zoom: 1 }),
            title: "Zoom to 100%",
          } satisfies Command,
          {
            group: "View",
            id: "zoomIn",
            keys: "⌘=",
            run: () => zoomBy(1.25),
            title: "Zoom in",
          } satisfies Command,
          {
            group: "View",
            id: "zoomOut",
            keys: "⌘-",
            run: () => zoomBy(0.8),
            title: "Zoom out",
          } satisfies Command,
          {
            group: "View",
            id: "grid",
            keys: "⌘'",
            keywords: "snap",
            run: () => useCanvasGrid.getState().toggle(),
            title: useCanvasGrid.getState().visible
              ? "Hide the grid"
              : "Show the grid",
          } satisfies Command,
        ]
      : []),
    ...(info.configured
      ? [
          {
            group: "Project",
            id: "newPage",
            run: () => {
              newPage();
            },
            title: "New page…",
          } satisfies Command,
          {
            group: "Project",
            id: "newCanvas",
            run: () => {
              newCanvas();
            },
            title: "New canvas…",
          } satisfies Command,
          {
            group: "Project",
            id: "importFigma",
            keywords: "fig",
            run: pickFigmaFile,
            title: "Import a Figma file…",
          } satisfies Command,
        ]
      : []),
    {
      group: "Project",
      id: "settings",
      keywords: "preferences configuration repository",
      run: () => useProject.getState().openSettings(true),
      title: settings ? "Settings" : "Set up the project",
    },
    {
      group: "Project",
      id: "shortcuts",
      keys: "?",
      keywords: "keyboard keys help",
      run: openShortcutSheet,
      title: "Keyboard shortcuts",
    },
  ];
  return list;
};

/**
 * Keys the editor answers to that are no command of their own: they act on what is selected or
 * on what the key is pressed in, so the palette has nothing to run for them.
 */
export const keyOnlyShortcuts: readonly Shortcut[] = [
  { group: "Project", keys: "⌘K", title: "Every command" },
  { group: "Edit", keys: "⌘C", title: "Copy" },
  { group: "Edit", keys: "⌘X", title: "Cut" },
  { group: "Edit", keys: "⌘V", title: "Paste" },
  { group: "Selection", keys: "⌘D", title: "Duplicate" },
  { group: "Selection", keys: "⌘G", title: "Wrap in a group" },
  { group: "Selection", keys: "⌥⌘G", title: "Wrap in a row" },
  { group: "Selection", keys: "⇧⌘G", title: "Wrap in a column" },
  { group: "Selection", keys: "⌫", title: "Delete" },
  { group: "Selection", keys: "↩", title: "Edit the text" },
  { group: "Selection", keys: "Esc", title: "Select the parent" },
  {
    group: "Selection",
    keys: "↑ ↓",
    title: "Select the previous or next element",
  },
  {
    group: "Selection",
    keys: "← →",
    title: "Select the parent or the first child",
  },
  { group: "Selection", keys: "⇧F10", title: "Open the element's menu" },
];

/** Every key, in the palette's groups: the commands' own and the ones that act on the moment. */
export const shortcuts = (): Shortcut[] => {
  const all: Shortcut[] = [
    ...commandsForSheet().flatMap((c) =>
      c.keys ? [{ group: c.group, keys: c.keys, title: c.title }] : []
    ),
    ...keyOnlyShortcuts,
  ];
  return commandGroups.flatMap((g) => all.filter((s) => s.group === g));
};

/**
 * The sheet lists every key, not only what the moment offers: the canvas's tools and zoom in
 * the prototype too, under their plain names.
 */
const commandsForSheet = (): Command[] => {
  const now = commands();
  const seen = new Set(now.map((c) => c.id));
  const canvasOnly: Command[] = [
    ...tools.map(
      (t): Command => ({
        group: "Tools",
        id: `tool:${t.tool}`,
        keys: t.keys,
        run: () => undefined,
        title: t.title,
      })
    ),
  ];
  const plain: Record<string, string> = {
    grid: "Show or hide the grid; what is moved snaps to it",
    toggleComments: "Show or hide comments",
  };
  return [...now, ...canvasOnly.filter((c) => !seen.has(c.id))].map((c) =>
    plain[c.id] ? { ...c, title: plain[c.id] as string } : c
  );
};

// ---- What depends on the moment ----

const under = (path: string, label: string) =>
  path ? `${path} › ${label}` : label;

/** A menu item as a command of the selection. */
const itemCommand = (
  e: Extract<Entry, { kind: "item" }>,
  run: (id: string) => void,
  path: string
): Command => ({
  ...(e.destructive ? { destructive: true } : {}),
  group: "Selection",
  id: `menu:${e.id}`,
  ...(e.shortcut ? { keys: e.shortcut } : {}),
  run: () => run(e.id),
  title: under(path, e.label),
});

/** A menu's items as commands, a submenu's under its own name: `Wrap in › Row`. */
const flatten = (
  entries: readonly Entry[],
  run: (id: string) => void,
  path = ""
): Command[] =>
  entries.flatMap((e): Command[] => {
    if (e.kind === "item" && !e.disabled) {
      return [itemCommand(e, run, path)];
    }
    if (e.kind === "submenu" && !e.disabled) {
      return flatten(e.entries, run, under(path, e.label));
    }
    return [];
  });

/** What is selected, as its context menu would act on it; nothing in the prototype. */
const selectionTarget = (): MenuTarget | null => {
  const s = editor();
  if (s.workspace !== "design") {
    return null;
  }
  if (s.selection) {
    return {
      frame: s.selection.frame,
      kind: "node",
      nodeId: s.selection.nodeId,
    };
  }
  return s.selectedPage ? { kind: "page", pageId: s.selectedPage } : null;
};

/** The selection's menu, item by item. */
export const selectionCommands = (): Command[] => {
  const target = selectionTarget();
  const entries = target ? entriesFor(target) : null;
  return target && entries
    ? flatten(entries, (id) => runEntry(target, id))
    : [];
};

const goToPageCommand = (page: Page): Command => ({
  detail: page.route ?? "",
  group: "Go to",
  id: `page:${page.id}`,
  keywords: "page",
  run: () =>
    editor().workspace === "prototype" ? goToPage(page) : zoomToPage(page),
  title: page.name,
});

const chatCommand = (thread: Thread): Command => ({
  detail: thread.status === "running" ? "working" : "chat",
  group: "Go to",
  id: `thread:${thread.id}`,
  keywords: "chat thread agent",
  run: () => {
    openLeftPanel("chat");
    useAgents.getState().open(thread.id);
  },
  title: thread.title,
});

/** The open canvas's pages, the other canvases, and the chats, newest first. */
export const goToCommands = (): Command[] => {
  const { canvas } = editor();
  const { canvases } = useProject.getState();
  return [
    ...pagesOfCanvas(canvas).map(goToPageCommand),
    ...canvases
      .filter((c) => c.id !== canvas)
      .map(
        (c): Command => ({
          detail: "canvas",
          group: "Go to",
          id: `canvas:${c.id}`,
          keywords: "canvas",
          run: () => openCanvas(c.id),
          title: c.name,
        })
      ),
    ...useAgents.getState().threads.map(chatCommand),
  ];
};

/** Every command the palette offers now, in its groups' order. */
export const paletteCommands = (): Command[] => {
  const all = [...selectionCommands(), ...commands(), ...goToCommands()];
  return commandGroups.flatMap((g) => all.filter((c) => c.group === g));
};

const SPACES_RE = /\s+/;

/** The words a command is found by, lower-cased. */
const haystackOf = (c: Command) =>
  `${c.title} ${c.keywords ?? ""} ${c.detail ?? ""} ${c.group}`.toLowerCase();

/**
 * The commands a query finds: every word of it in the command's words, those whose title starts
 * with the query first. An empty query finds them all, in order.
 */
export const searchCommands = (
  list: readonly Command[],
  query: string
): Command[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...list];
  }
  const words = q.split(SPACES_RE);
  const found = list.filter((c) => {
    const hay = haystackOf(c);
    return words.every((w) => hay.includes(w));
  });
  const starts = (c: Command) => c.title.toLowerCase().startsWith(q);
  return [...found.filter(starts), ...found.filter((c) => !starts(c))];
};
