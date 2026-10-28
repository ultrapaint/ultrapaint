# ADR 0032: Floating cards, one canvas workspace and a command palette

Status: accepted, 2026-10-26. Amends 0018 (the element toolbar is no longer Vibe's alone) and
0020 (the Pages panel stays the prototype's; the canvases are switched at the top of the left
panel). Builds on 0031 (the desktop app's window).

> Amended 2026-10-28 (`docs/PLAN-architecture.md`, step 16). The key handlers no longer stay
> where they were: a key is declared once, with its command in `lib/commands.ts`, as a chord
> (`mod+shift+z`) and the scope it works in (anywhere, outside text fields, on the canvas, or a
> focused row of the Layers panel). The one key handler, the palette, the shortcut sheet, the
> menus and the tooltips read it, so a key shown is a key that works, and the Layers rows' keys
> are in the sheet.

## Context

The editor had three workspaces: Vibe (the canvas and the chat, with a toolbar of design-system
values over the selection), Design (the same canvas with the inspector and the code on the
right, the layers and the assets on the rail) and Prototype. Vibe and Design showed the same
canvas and the same selection, and differed in which panels were out. The switch between them
sat at the top of the canvas, the tools at its bottom, and the rail, the left panel and the right
panel were full-height columns against the window's edges.

The desktop app (0031) draws its own window. On a Mac a window without a title bar puts its
buttons over the page, which then needs a place for them and something to drag the window by.

## Decision

**Vibe and Design are one workspace, the canvas.** The left panel and the right panel are put
away on their own, so the canvas with the right panel away is what Vibe was. The element toolbar
and the selection's name are over every selection; the inspector shows its size. The workspaces
left are the canvas (⌃1) and the prototype (⌃2). A link with `?mode=vibe` opens the canvas, and
the parameter is dropped as a default would be.

**The rail lists every panel of the workspace in one order**: Agents first, then Layers, Assets,
Design system, Comments and Changes; the prototype has Pages in place of Layers and Assets. A
click on the open panel's button puts the panel away.

**What is around the canvas floats over it, in cards** apart from each other and 8px from the
window's edges, as pen.dev's editor does:

- the title card at the top left, over the rail and the left panel: the project's name and
  branch (or the desktop app's project switcher), the unsaved warning and the left panel's toggle;
- the rail, the left panel and the tools in a column beside them;
- at the top right, the command palette's button, the prototype (▷, ■ to go back) and the right
  panel's toggle, with the right panel under them;
- the zoom at the canvas's bottom right; notices from the shell at its top.

The canvas fills the window behind them. What fits or centres itself on the canvas keeps to the
part the cards at each side leave, as before.

**Every command is in one list** (`lib/commands.ts`): the panels, the tools, undo and redo, the
zoom, the workspaces, new pages and canvases, the settings. The command palette (⌘K) offers it
with what depends on the moment: the selection's context menu, item by item, the canvas's pages,
the other canvases and the chats. The shortcut sheet lists the same commands' keys, with the
keys that act on what they are pressed in (arrows, Delete, the clipboard) beside them. The key
handlers stay where they were; a command and its key call the same functions.

**On a Mac the desktop window draws no title bar.** Its buttons sit inside the title card,
centred on its height; the card leaves them room, and the title card, the actions card and the
strip above the canvas move the window when dragged. Full screen hides the buttons and gives the
room back. The settings page and the welcome page leave the same room. Linux keeps the system's
frame. The editor learns of it through `Platform.windowControls`.

## Consequences

- Nothing in the editor branches on Vibe any more; the workspace memory keeps the tool and the
  selection for the canvas and the prototype only.
- The palette reads the context menus, so an item added to a menu is in the palette too.
- A shell that draws its own frame on another platform (Windows, later) fills `windowControls`
  with where its buttons are.
- The Redesign canvas (`docs/designs/redesign`) still draws the three workspaces; it shows the
  layout as it was until it is redrawn.
