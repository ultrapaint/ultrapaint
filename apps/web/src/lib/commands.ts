/**
 * Everything the editor can be asked to do, in one list, with the keys that do it. The command
 * palette (⌘K) runs a command; the key handler (`keymap.ts`) runs the same `run` when one of its
 * keys is pressed where the key works; the shortcut sheet, the palette, the menus and the
 * buttons' tooltips show its keys from here. Some commands are keys only: they act on what is
 * selected or on what has the focus (a row of the Layers panel), so the palette has nothing to
 * run for them. The palette adds what depends on the moment beside them: the selection's own
 * menu, the pages, the canvases and the chats. A key is written once, as a chord (`keys.ts`).
 */
import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread } from "@ultrapaint/contracts/threads";
import { openCommandPalette } from "../components/command-palette.tsx";
import { openShortcutSheet } from "../components/shortcut-sheet.tsx";
import type { LayerItem } from "../panels/layer-tree.ts";
import { useAgents } from "../state/agents.ts";

import { setView, zoomToFit, zoomToSelection } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useCanvasPicks } from "../state/canvas-picks.ts";
import { toggleCommenting, useComments } from "../state/comments.ts";
import type { MenuTarget } from "../state/context-menu.ts";
import {
  type LeftTab,
  type Mode,
  pagesOfCanvas,
  useEditor,
  type Workspace,
  workspaceOrder,
} from "../state/editor.ts";
import {
  rightHasSubject,
  showLeftPanel,
  showRightPanel,
  usePanels,
} from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { selectedPageNow } from "../state/selection.ts";
import { surfaceNow } from "../state/surface.ts";
import { newCanvas, openCanvas } from "./canvas-actions.ts";
import { pickFigmaFile } from "./import-figma.ts";
import { type Keys, keysLabel } from "./keys.ts";
import {
  type MenuAction,
  type MenuEntry,
  menuFor,
  runMenuAction,
} from "./menu-actions.ts";
import type { Item } from "./menu-model.ts";
import {
  deleteSelection,
  duplicateSelection,
  INSERTED_ELEMENTS,
  insertElement,
  insertTarget,
  setHidden,
  setLocked,
  wrapSelection,
} from "./node-actions.ts";
import { copyNodeLink, copyPageLink } from "./node-links.ts";
import {
  deleteCanvasPicks,
  deletePages,
  duplicatePage,
  goToPage,
  newPage,
  zoomToPage,
} from "./page-actions.ts";
import {
  editSelectedText,
  openSelectionMenuByKey,
  stepBack,
  undoOrRedo,
  walkSelection,
  zoomBy,
} from "./shortcuts.ts";
import { createThread } from "./start-thread.ts";
import { openChat } from "./thread-actions.ts";
import { threadView } from "./thread-view.ts";

/** The sections of the palette and of the shortcut sheet, in the order they are shown. */
export const commandGroups = [
  "Selection",
  "Layers",
  "Agents",
  "Panels",
  "Tools",
  "Edit",
  "View",
  "Go to",
  "Project",
] as const;
type CommandGroup = (typeof commandGroups)[number];

/**
 * Where the window's keys work: `always` in a text field too, for what nothing is typed with;
 * `editor` outside text fields, in either workspace; `canvas` outside text fields on the canvas,
 * as the prototype shows no selection and leaves the browser its zoom keys. No key works while a
 * dialog, a menu or the settings are open.
 */
export type WindowScope = "always" | "editor" | "canvas";

/** A row of the Layers panel, which a key is pressed on. */
export interface LayerRow {
  item: LayerItem;
  rename: () => void;
  /** Selects what it names, Shift adding it to the rest. */
  select: (add: boolean) => void;
  /** Moves the tree's focus from it, or opens or folds it, by an arrow, Home or End. */
  walk: (key: string) => void;
}

/**
 * The scopes something with the focus hosts: their keys go before the window's while it has the
 * focus, and its host says what the key is pressed on (`scopeKeyDown` in `keymap.ts`).
 */
export interface FocusTargets {
  layersRow: LayerRow;
}
export type FocusScope = keyof FocusTargets;

/** A command's keys, and what reads them. */
interface Bound {
  /** Chords that do the same, not shown: Delete beside ⌫. */
  also?: readonly Keys[];
  group: CommandGroup;
  /** What a menu item names to show the keys of what it does. */
  id: string;
  /** Its chords, as the sheet, the palette and the menus show them. */
  keys?: readonly Keys[];
}

/**
 * What a key does. It gives back false when there was nothing to do it to, and the key is left to
 * the browser; anything else, and the key was the editor's. `pressed` is the key's
 * `KeyboardEvent.key`, for a command of several keys.
 */
type Run = (pressed?: string) => unknown;

/** A command of the editor's, run by the palette and by its keys in the window. */
export type CommandSpec = Bound & {
  keywords?: string;
  /** Whether the palette offers it now: always when not said. */
  offered?: () => boolean;
  /** Where its keys work; `editor` when not said. */
  scope?: WindowScope;
  /** Its name in the shortcut sheet, which lists it at any moment: said once, plainly. */
  sheetTitle?: string;
  /** Its name, read as the palette opens: it can say what it would do now. */
  title: string | (() => string);
} & (
    | { clipboard?: never; run: Run }
    | {
        /**
         * The browser turns the chord into a clipboard event, which the editor takes
         * (`useClipboardEvents`): the key handler leaves it to the browser.
         */
        clipboard: "copy" | "cut" | "paste";
        run?: never;
      }
  );

/** A key of what has the focus, given what it is pressed on. */
export interface FocusBinding<S extends FocusScope> extends Bound {
  keys: readonly Keys[];
  /** As a command's `Run`, on what the key was pressed on. */
  run: (target: FocusTargets[S], pressed: string) => unknown;
  scope: S;
  title: string;
}

/** A command as the palette lists it. */
export interface Command {
  /** For an item of the selection's menu, what it does: the palette draws the menu's icon. */
  action?: MenuAction;
  destructive?: boolean;
  /** Further words on the right of its title: where a page is, who a chat is with. */
  detail?: string;
  group: CommandGroup;
  id: string;
  /** Its keys, as this platform writes them. */
  keys?: string;
  /** Other words it is found by. */
  keywords?: string;
  run: () => void;
  title: string;
}

/** A key the editor answers to, as the shortcut sheet lists it. */
interface Shortcut {
  group: CommandGroup;
  /** As this platform writes them: `⇧⌘Z`, `Ctrl+Shift+Z`. */
  keys: string;
  title: string;
}

const editor = () => useEditor.getState();

/** The page selected as a whole (its root, ADR 0075); null for another node or nothing. */
const selectedPageOf = () => {
  const id = selectedPageNow();
  return useProject.getState().pages.find((p) => p.id === id) ?? null;
};

/** Copies the link to the page selected as a whole, or to the node selected. */
const copySelectionLink = () => {
  const { selection } = editor();
  const page = selectedPageOf();
  if (page) {
    copyPageLink(page);
  } else if (selection) {
    copyNodeLink(selection);
  }
};
const onCanvas = () => editor().workspace === "design";
/** A key that acts on what is selected or pressed in: the palette has nothing to run. */
const keyOnly = () => false;

/**
 * Picks a tool of the canvas; commenting shows the comments too. The prototype is clicked through
 * or commented on: C goes in and out of commenting there, as its button in the bar does. The tool
 * keys and the palette both come here.
 */
const pickTool = (tool: Mode) => {
  if (editor().workspace === "prototype") {
    if (tool === "comment") {
      toggleCommenting();
    }
    return;
  }
  // A board view has its own few tools.
  if (!surfaceNow().modes.includes(tool)) {
    return;
  }
  editor().setMode(tool);
  if (tool === "comment" && !useComments.getState().visible) {
    useComments.getState().toggleVisible();
  }
};

/** Does something to every node selected, as one undo step; nothing when none is. */
const toSelection = (act: () => unknown) => () => {
  if (!editor().selection) {
    return false;
  }
  act();
  return true;
};

const leftPanels: readonly {
  tab: LeftTab;
  title: string;
  keywords?: string;
}[] = [
  { keywords: "chat threads agent", tab: "chat", title: "Agents" },
  { keywords: "tree outline", tab: "layers", title: "Layers" },
  {
    keywords: "design system tokens colours typography theme sync guidelines",
    tab: "designSystem",
    title: "Foundations",
  },
  {
    keywords: "library insert assets",
    tab: "library",
    title: "Components",
  },
  { keywords: "feedback notes pins", tab: "comments", title: "Comments" },
  { keywords: "history diff git", tab: "changes", title: "Changes" },
];

/** The canvas's tools; commenting is the prototype's too. */
const tools: readonly { keys: string; title: string; tool: Mode }[] = [
  { keys: "v", title: "Select", tool: "select" },
  { keys: "g", title: "Group: draw a container", tool: "group" },
  { keys: "t", title: "Text", tool: "text" },
  {
    keys: "i",
    title: "Use components: press their buttons, open their menus",
    tool: "interact",
  },
  { keys: "h", title: "Pan, or hold Space", tool: "pan" },
  { keys: "c", title: "Comment", tool: "comment" },
];

const workspaceTitles: Record<Workspace, string> = {
  design: "Canvas",
  prototype: "Prototype: click through the design",
};

const toolCommand = (t: (typeof tools)[number]): CommandSpec => {
  const both = t.tool === "comment";
  return {
    group: "Tools",
    id: `tool:${t.tool}`,
    keys: [t.keys],
    ...(both ? {} : { offered: onCanvas }),
    run: () => pickTool(t.tool),
    scope: both ? "editor" : "canvas",
    title: t.title,
  };
};

const workspaceCommand = (w: Workspace, i: number): CommandSpec => ({
  group: "View",
  id: `workspace:${w}`,
  // ⌃1–2 on a Mac, Alt+1–2 elsewhere: the browser keeps ⌘ on a Mac and Ctrl elsewhere for its
  // tabs.
  keys: [{ mac: `ctrl+${i + 1}`, other: `alt+${i + 1}` }],
  keywords: w === "prototype" ? "play preview" : "design edit",
  run: () => editor().setWorkspace(w),
  scope: "always",
  title: workspaceTitles[w],
});

const panelCommands = (): CommandSpec[] => [
  {
    group: "Agents",
    id: "newChat",
    keywords: "thread agent prompt ask",
    run: () => {
      showLeftPanel("chat");
      createThread();
    },
    title: "New chat with an agent",
  },
  ...leftPanels.map(
    (p): CommandSpec => ({
      group: "Panels",
      id: `panel:${p.tab}`,
      ...(p.keywords ? { keywords: p.keywords } : {}),
      offered: onCanvas,
      run: () => showLeftPanel(p.tab),
      title: `Show ${p.title}`,
    })
  ),
  {
    group: "Panels",
    id: "right:design",
    keywords: "inspector properties style",
    // The right panel is drawn only with something in it.
    offered: () => onCanvas() && rightHasSubject(),
    run: () => showRightPanel("design"),
    title: "Show the inspector",
  },
  {
    group: "Panels",
    id: "right:code",
    keywords: "jsx tailwind source",
    offered: () => onCanvas() && rightHasSubject(),
    run: () => showRightPanel("code"),
    title: "Show the code",
  },
  {
    group: "Panels",
    id: "toggleLeft",
    keywords: "sidebar",
    run: () => usePanels.getState().toggleLeft(),
    title: () =>
      usePanels.getState().left ? "Show the left panel" : "Hide the left panel",
  },
  {
    group: "Panels",
    id: "toggleRight",
    keywords: "sidebar inspector code",
    offered: onCanvas,
    run: () => usePanels.getState().toggleRight(),
    title: () =>
      usePanels.getState().right
        ? "Show the right panel"
        : "Hide the right panel",
  },
  {
    group: "Panels",
    id: "toggleAll",
    // As in Figma. Nothing is typed with it, so it works in a text field too; by the key's place
    // as well, a layout may type something else there.
    keys: ["mod+\\"],
    keywords: "sidebar focus",
    run: () => usePanels.getState().toggleAll(),
    scope: "always",
    title: "Hide or show the panels",
  },
];

/** The Insert menu's elements, each a command of the palette's while there is somewhere to put it. */
const insertCommands = (): CommandSpec[] =>
  INSERTED_ELEMENTS.map(
    (element): CommandSpec => ({
      group: "Edit",
      id: `insert:${element.id}`,
      keywords: "add new element",
      offered: () => onCanvas() && insertTarget() !== null,
      run: () => insertElement(element.id),
      title: `Insert ${element.name.toLowerCase()}`,
    })
  );

const viewCommands = (): CommandSpec[] => [
  ...workspaceOrder.map(workspaceCommand),
  {
    group: "View",
    id: "zoomFit",
    keys: ["shift+1"],
    offered: onCanvas,
    run: zoomToFit,
    scope: "canvas",
    title: "Zoom to fit",
  },
  {
    group: "View",
    id: "zoomSelection",
    keys: ["shift+2"],
    offered: onCanvas,
    run: zoomToSelection,
    scope: "canvas",
    title: "Zoom to the selection",
  },
  {
    group: "View",
    id: "zoom100",
    keys: ["shift+0"],
    offered: onCanvas,
    run: () => setView({ zoom: 1 }),
    scope: "canvas",
    title: "Zoom to 100%",
  },
  {
    also: ["mod+plus"],
    group: "View",
    id: "zoomIn",
    keys: ["mod+="],
    offered: onCanvas,
    run: () => zoomBy(1.25),
    scope: "canvas",
    title: "Zoom in",
  },
  {
    group: "View",
    id: "zoomOut",
    keys: ["mod+-"],
    offered: onCanvas,
    run: () => zoomBy(0.8),
    scope: "canvas",
    title: "Zoom out",
  },
  {
    group: "View",
    id: "grid",
    // As in Figma: by the key's place too, a layout may type something else there.
    keys: ["mod+'"],
    keywords: "snap",
    offered: onCanvas,
    run: () => useCanvasGrid.getState().toggle(),
    scope: "canvas",
    sheetTitle: "Show or hide the grid; what is moved snaps to it",
    title: () =>
      useCanvasGrid.getState().visible ? "Hide the grid" : "Show the grid",
  },
];

const projectCommands = (): CommandSpec[] => [
  {
    group: "Project",
    id: "newPage",
    offered: () => useProject.getState().info.configured,
    run: () => {
      newPage();
    },
    title: "New page…",
  },
  {
    group: "Project",
    id: "newCanvas",
    offered: () => useProject.getState().info.configured,
    run: () => {
      newCanvas();
    },
    title: "New canvas…",
  },
  {
    group: "Project",
    id: "importFigma",
    keywords: "fig",
    offered: () => useProject.getState().info.configured,
    run: pickFigmaFile,
    title: "Import a Figma file…",
  },
  {
    group: "Project",
    id: "settings",
    keywords: "preferences configuration repository",
    run: () => useProject.getState().openSettings(true),
    title: () =>
      useProject.getState().settings ? "Settings" : "Set up the project",
  },
  {
    group: "Project",
    id: "shortcuts",
    keys: ["?"],
    keywords: "keyboard keys help",
    run: openShortcutSheet,
    title: "Keyboard shortcuts",
  },
];

/**
 * The keys that act on what is selected or on what the key is pressed in: no command of the
 * palette's, which offers the selection's own menu instead.
 */
const keyOnlyCommands = (): CommandSpec[] => [
  {
    group: "Project",
    id: "palette",
    keys: ["mod+k"],
    offered: keyOnly,
    run: openCommandPalette,
    scope: "always",
    title: "Every command",
  },
  {
    clipboard: "copy",
    group: "Edit",
    id: "copy",
    keys: ["mod+c"],
    offered: keyOnly,
    scope: "canvas",
    title: "Copy",
  },
  {
    clipboard: "cut",
    group: "Edit",
    id: "cut",
    keys: ["mod+x"],
    offered: keyOnly,
    scope: "canvas",
    title: "Cut",
  },
  {
    clipboard: "paste",
    group: "Edit",
    id: "paste",
    keys: ["mod+v"],
    offered: keyOnly,
    scope: "canvas",
    title: "Paste",
  },
  {
    group: "Selection",
    id: "duplicate",
    keys: ["mod+d"],
    offered: keyOnly,
    // A page selected as a whole is duplicated with its file (ADR 0075).
    run: () => {
      const page = selectedPageOf();
      if (page) {
        duplicatePage(page);
        return true;
      }
      return toSelection(() => duplicateSelection())();
    },
    scope: "canvas",
    title: "Duplicate",
  },
  {
    group: "Selection",
    id: "copyLink",
    keywords: "share url reference agent",
    offered: () => onCanvas() && editor().selection !== null,
    run: copySelectionLink,
    title: "Copy link to the selection",
  },
  {
    group: "Selection",
    id: "wrap:group",
    keys: ["mod+g"],
    offered: keyOnly,
    run: toSelection(() => wrapSelection("group")),
    scope: "canvas",
    title: "Wrap in a group",
  },
  {
    group: "Selection",
    id: "wrap:row",
    keys: ["mod+alt+g"],
    offered: keyOnly,
    run: toSelection(() => wrapSelection("row")),
    scope: "canvas",
    title: "Wrap in a row",
  },
  {
    group: "Selection",
    id: "wrap:column",
    keys: ["mod+shift+g"],
    offered: keyOnly,
    run: toSelection(() => wrapSelection("column")),
    scope: "canvas",
    title: "Wrap in a column",
  },
  {
    also: ["delete", "mod+backspace"],
    group: "Selection",
    id: "delete",
    keys: ["backspace"],
    offered: keyOnly,
    // Frames picked together on the canvas go together, and a page selected by its name goes
    // with its file: undo brings any of them back, so nothing asks first.
    run: () => {
      if (useCanvasPicks.getState().ids.length > 1) {
        deleteCanvasPicks();
        return true;
      }
      const page = selectedPageOf();
      if (page) {
        deletePages([page.id]);
        return true;
      }
      return toSelection(() => deleteSelection())();
    },
    scope: "canvas",
    title: "Delete",
  },
  {
    group: "Selection",
    id: "editText",
    keys: ["enter"],
    offered: keyOnly,
    run: editSelectedText,
    scope: "canvas",
    title: "Edit the text",
  },
  {
    // What the pointer is doing, a component edited in place, an open comment, the prototype's
    // commenting, a selected page and a board's pick are put away first (`stepBack`).
    group: "Selection",
    id: "escape",
    keys: ["escape"],
    offered: keyOnly,
    run: stepBack,
    sheetTitle:
      "Put back a drag, leave a component edited in place, let go of a comment or a pick, or select the parent",
    title: "Select the parent",
  },
  {
    group: "Selection",
    id: "selectSibling",
    keys: ["arrowup", "arrowdown"],
    offered: keyOnly,
    run: (pressed) => walkSelection(pressed ?? ""),
    scope: "canvas",
    title: "Select the previous or next element",
  },
  {
    group: "Selection",
    id: "selectDepth",
    keys: ["arrowleft", "arrowright"],
    offered: keyOnly,
    run: (pressed) => walkSelection(pressed ?? ""),
    scope: "canvas",
    title: "Select the parent or the first child",
  },
  {
    // On the canvas only, which has no field: a focused row of a panel gets the browser's own
    // contextmenu event instead, and opens its own.
    also: ["contextmenu"],
    group: "Selection",
    id: "selectionMenu",
    keys: ["shift+f10"],
    offered: keyOnly,
    run: openSelectionMenuByKey,
    scope: "always",
    title: "Open the element's menu",
  },
];

/** Every command of the window, built once, when it is first asked for. */
let built: readonly CommandSpec[] | null = null;
export const commandList = (): readonly CommandSpec[] => {
  built ??= [
    ...panelCommands(),
    ...tools.map(toolCommand),
    {
      group: "Tools",
      id: "toggleComments",
      keys: ["shift+c"],
      run: () => useComments.getState().toggleVisible(),
      sheetTitle: "Show or hide comments",
      title: () =>
        useComments.getState().visible ? "Hide comments" : "Show comments",
    },
    {
      group: "Edit",
      id: "undo",
      keys: ["mod+z"],
      run: () => {
        undoOrRedo(false);
      },
      title: "Undo",
    },
    {
      group: "Edit",
      id: "redo",
      keys: ["mod+shift+z"],
      run: () => {
        undoOrRedo(true);
      },
      title: "Redo",
    },
    ...insertCommands(),
    ...viewCommands(),
    ...projectCommands(),
    ...keyOnlyCommands(),
  ];
  return built;
};

const rowNode = (row: LayerRow) => {
  const { item } = row;
  return item.page || !item.node
    ? null
    : { at: { frame: item.frame, nodeId: item.node.id }, node: item.node };
};

/**
 * The keys of what has the focus, by scope. A row of the Layers panel answers them as the WAI-ARIA
 * tree pattern has it: the arrows walk and fold the tree, Enter and Space select, F2 renames;
 * ⇧⌘H and ⇧⌘L hide and lock, as in Figma.
 */
export const focusBindings: {
  readonly [S in FocusScope]: readonly FocusBinding<S>[];
} = {
  layersRow: [
    {
      group: "Layers",
      id: "layers:walk",
      keys: ["arrowup", "arrowdown", "home", "end"],
      run: (row, pressed) => row.walk(pressed),
      scope: "layersRow",
      title: "Go to the previous, next, first or last layer",
    },
    {
      group: "Layers",
      id: "layers:fold",
      keys: ["arrowleft", "arrowright"],
      run: (row, pressed) => row.walk(pressed),
      scope: "layersRow",
      title: "Fold or open a layer, or go to its parent or first child",
    },
    {
      also: ["space"],
      group: "Layers",
      id: "layers:select",
      keys: ["enter"],
      run: (row) => row.select(false),
      scope: "layersRow",
      title: "Select the layer",
    },
    {
      also: ["shift+space"],
      group: "Layers",
      id: "layers:add",
      keys: ["shift+enter"],
      run: (row) => row.select(true),
      scope: "layersRow",
      title: "Add the layer to the selection",
    },
    {
      group: "Layers",
      id: "layers:rename",
      keys: ["f2"],
      run: (row) => row.rename(),
      scope: "layersRow",
      title: "Rename the layer",
    },
    {
      group: "Layers",
      id: "layers:hide",
      keys: ["mod+shift+h"],
      run: (row) => {
        const named = rowNode(row);
        if (!named) {
          return false;
        }
        setHidden(!named.node.hidden, named.at);
        return true;
      },
      scope: "layersRow",
      title: "Hide or show the layer",
    },
    {
      group: "Layers",
      id: "layers:lock",
      keys: ["mod+shift+l"],
      run: (row) => {
        const named = rowNode(row);
        if (!named) {
          return false;
        }
        setLocked(!named.node.locked, named.at);
        return true;
      },
      scope: "layersRow",
      title: "Lock or unlock the layer",
    },
  ],
};

const titleOf = (c: CommandSpec) =>
  typeof c.title === "string" ? c.title : c.title();

/** Every binding with keys: the window's commands, then what has the focus. */
const everyBinding = (): readonly (Bound & { title: string })[] => [
  ...commandList().map((c) => ({ ...c, title: c.sheetTitle ?? titleOf(c) })),
  ...Object.values(focusBindings).flat(),
];

/** The keys of a command, as this platform writes them; none when it has none. */
export const keysOf = (id: string): string | undefined => {
  const keys = everyBinding().find((b) => b.id === id)?.keys;
  return keys ? keysLabel(keys) : undefined;
};

/**
 * Runs a command by its id, as the palette does: a menu item that is one. False when there is no
 * such command, or it has nothing to run (the clipboard's).
 */
export const runCommand = (id: string): unknown => {
  const command = commandList().find((c) => c.id === id);
  return command?.run ? command.run() : false;
};

/** A command as the palette lists it, with what it is called now. */
const paletteCommand = (c: CommandSpec): Command => ({
  group: c.group,
  id: c.id,
  ...(c.keys ? { keys: keysLabel(c.keys) } : {}),
  ...(c.keywords ? { keywords: c.keywords } : {}),
  run: () => {
    c.run?.();
  },
  title: titleOf(c),
});

/**
 * Whether a command makes sense now: what it says of itself, and what the main area offers (a
 * board view has no code, comments or grid of its own). Its keys are let go of where it does not.
 */
const isOffered = (c: CommandSpec) =>
  (c.offered?.() ?? true) && surfaceNow().offers(c.id);

/** The commands that make sense now: the panels the workspace offers, the canvas's tools on it. */
export const commands = (): Command[] =>
  commandList().filter(isOffered).map(paletteCommand);

/** Every key, in the palette's groups, whatever the moment offers: the sheet lists them all. */
export const shortcuts = (): Shortcut[] => {
  const all = everyBinding().flatMap((b): Shortcut[] =>
    b.keys ? [{ group: b.group, keys: keysLabel(b.keys), title: b.title }] : []
  );
  return commandGroups.flatMap((g) => all.filter((s) => s.group === g));
};

// ---- What depends on the moment ----

const under = (path: string, label: string) =>
  path ? `${path} › ${label}` : label;

/** A menu item as a command of the selection, with the keys of the command it is. */
const itemCommand = (e: Item<MenuAction>, path: string): Command => {
  const keys = e.command ? keysOf(e.command) : undefined;
  const title = under(path, e.label);
  return {
    action: e.action,
    ...(e.destructive ? { destructive: true } : {}),
    group: "Selection",
    id: `menu:${title}`,
    ...(keys ? { keys } : {}),
    run: () => {
      runMenuAction(e.action);
    },
    title,
  };
};

/** A menu's items as commands, a submenu's under its own name: `Wrap in › Row`. */
const flatten = (entries: readonly MenuEntry[], path = ""): Command[] =>
  entries.flatMap((e): Command[] => {
    if (e.kind === "item" && !e.disabled) {
      return [itemCommand(e, path)];
    }
    if (e.kind === "submenu" && !e.disabled) {
      return flatten(e.entries, under(path, e.label));
    }
    return [];
  });

/** What is selected, as its context menu would act on it; nothing in the prototype. */
const selectionTarget = (): MenuTarget | null => {
  const s = editor();
  if (s.workspace !== "design") {
    return null;
  }
  // The page's root is the page: its menu is the page's (ADR 0075).
  const page = selectedPageNow();
  if (page) {
    return { kind: "page", pageId: page };
  }
  return s.selection
    ? { frame: s.selection.frame, kind: "node", nodeId: s.selection.nodeId }
    : null;
};

/** The selection's menu, item by item. */
const selectionCommands = (): Command[] => {
  const target = selectionTarget();
  const entries = target ? menuFor(target) : null;
  return entries ? flatten(entries) : [];
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
  detail: threadView(thread).busy ? "working" : "chat",
  group: "Go to",
  id: `thread:${thread.id}`,
  keywords: "chat thread agent",
  run: () => openChat(thread.id),
  title: thread.title,
});

/** The open canvas's pages, the other canvases, and the chats, newest first. */
const goToCommands = (): Command[] => {
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
