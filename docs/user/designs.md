# Design documents

A design is not code. It is a small tree of nodes, the way a design tool sees it:

| Node | What it is |
|---|---|
| `page` | A screen at a route; it lays its children out in a column |
| `row`, `column` | A flex container, horizontal or vertical: gap, alignment, padding, wrap |
| `group` | A plain container that only holds and styles its children |
| `text` | A heading (level 1–6) or a paragraph |
| `image` | A picture from the space's `assets/` directory |
| `instance` | A component, a system one of Ultrapaint's or an app one of yours, with its props; its children fill its slots |

Sizes are `fill`, `hug` or pixels, and every colour, radius, shadow, spacing and type setting can
be a token of your design system (`"$color-primary"`, `"$text-lg"`, `"$spacing-4"`), so the
design follows the theme when it changes. `get_document_format`, on the editor's MCP server,
gives an agent the whole format as a JSON Schema.

A page file is JSON written one node per line: a node's own fields on its line, its children
indented below it. A change in the inspector is a change to one line, and a reviewer reads the
tree from the indentation. With `pagePngs` on (Settings → Repository → **PNG of every page**),
every page also gets a PNG beside its file, `orders.page.png`, drawn by the editor's preview at
the size of the page's frame. It is drawn again only when the page, its frame or the design system
changes, so anyone browsing the repository sees the screens and a pull request shows them as
image diffs. A page changed while no editor is open keeps its old picture until one opens.

The **Layers** panel shows the whole space at once, as a design tool does: every page with its
tree, and the nodes placed on the canvas beside them. A node inside a page follows the page's
layout; a node on the canvas has its own position. Drag one from one to the other, in the layers
or on the canvas. The tree is walked with the arrow keys, a layer is renamed with a double-click or
F2, hidden with its eye and locked with its lock, so a click on the canvas passes it by; the field
at the top finds layers by name, text or component.

Dragging on the empty canvas draws a selection box, as in Figma: the pages and the nodes placed on
the canvas it touches are picked together (Shift adds to what is picked), moved together by
dragging any one's name, deleted together with Delete, and a page's menu acts on every page
picked. A box drawn from inside a page selects that page's elements instead.

Several elements selected at once are changed together everywhere, in the inspector (where the
fields they differ on say "Mixed"), the menus, the toolbar and the keys, as one undo step. ⌘\
(Ctrl+\) puts the panels away, and `?` lists every shortcut, written as your platform writes
them. ⌘K (Ctrl+K) finds any command by its name: a panel, a tool, a zoom, what the selection's
right-click menu offers, a page, a canvas or a chat.

The editor is cards floating over the canvas: the project at the top left, the
**Canvas** / **Design System** toggle under it with, in Canvas mode, the canvas selector, the rail
of panels under that
(Agents, Layers, Components and Changes on the canvas; Agents, Foundations, Components and Changes
in the design system) beside the left panel, the tools in
a column next to it (the first, **+**, inserts a row, a column, a text or an image), and at the
top right the commands, who you are and the prototype (▷). Under them, a row names the layer
selected and opens or puts away the right panel, with the inspector, the code and the comments; the
panel starts put away until something is selected. Changes and Settings are at the foot of the
rail. Each side panel is put away on its own: with
the right one away the canvas is the agent's, with the chat beside it. ⌃1 is the canvas and ⌃2
the prototype on a Mac, Alt+1 and Alt+2 elsewhere. In the desktop app on a Mac the window's
buttons sit in the project's card, and dragging the cards at the top moves the window.

When a page is ready, **Implement** in the Pages panel (or `/implement <url or file>` in a thread) asks
an agent to write it in your application with your own components and conventions: the tokens
become the matching Tailwind v4 classes, each system component your application's own component for it
(written in its library's way where it has none). The inspector's
**Code** tab shows the same translation for the selected element, written by the server through
the project's style system.

## Designs and the code that implements them

The design is what the UI looks like and which states it has; the code is what it does
([ADR 0030](../adr/0030-the-implementation-link.md)). The editor never runs your application,
but it keeps the link between the two:

- **Status.** A page is a draft, ready (Mark ready, in its menu or the inspector), implemented,
  or changed since: the design, the code or both. The Pages panel shows it as a dot, the
  inspector's Code row says which files implement the page and lists what changed in the design.
  `implementation.json` and the designs as they were implemented (`_implemented/`) live in the
  designs directory and are committed. A page renamed, or moved to another canvas, keeps its
  link; a copy is a new design and starts as a draft.
- **Tokens waiting for the code.** A token changed in the design and not exported yet is not in
  the application: a page that uses one says so ("Implemented · tokens wait for the code"), the
  inspector names them with an **Export** button, and `/implement` brings them over before
  writing the page. An agent cannot mark a page implemented while one of its tokens waits.
- **Implement what changed.** An implement thread is told the changes since the page was
  implemented, its behaviour notes, its states and the tokens it waits on, then the whole
  design, and marks the page implemented with the files it wrote.
- **Behaviour notes.** A comment can be a behaviour note: what the code must do that a design
  cannot show ("only admins can delete", "disabled until the form is valid"). It is pinned to its
  element and goes to the code with the page. A component has its own, in its file (the
  **Notes** of its board's inspector, in Components), and they go to the code when it is
  implemented.
- **Bringing a project in.** Pages built before the project came into the editor start as
  drafts. Pick several in the Pages panel (⌘ or Shift) to **Mark them ready** at once, or **Find
  their code with an agent** (`/implement --adopt`, also in a canvas's menu): an agent finds the
  files that already draw each page and links them, changing no code.
- **States.** **Draw a state** (in a page's menu) draws the page again empty, loading, with an
  error or a dialog open (`orders@empty.page.json`); a link can open it, and implementing the
  page implements it as that state of the same screen.
- **Design and implement threads.** A chat designs: its agent can write the designs directory
  only, and a request about behaviour becomes a behaviour note. A chat started with
  `/implement` (the Implement button) implements, and may write the whole repository.
- **Agents outside the editor.** Connected through `claude mcp add` (Settings → Agents), an agent
  is told how to use `handoff`: what is ready or changed, the task for one, marking it
  implemented, writing a behaviour note on a page or a component, and exporting the design's
  token values to the code (or importing the code's).
