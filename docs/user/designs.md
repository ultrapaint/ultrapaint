# Design documents

A design is not code. It is a small tree of nodes, the way a design tool sees it:

| Node | What it is |
|---|---|
| `page` | A screen at a route; it lays its children out in a column |
| `row`, `column` | A flex container, horizontal or vertical: gap, alignment, padding, wrap |
| `group` | A plain container that only holds and styles its children |
| `text` | A heading (level 1–6) or a paragraph |
| `image` | A picture from the designs directory's `assets/`, or the canvas's own |
| `instance` | A component, a system one of Ultrapaint's or an app one of yours, with its props; its children fill its slots |

Sizes are `fill`, `hug` or pixels, and every colour, radius, shadow, spacing and type setting can
be a token of your design system (`"$color-primary"`, `"$text-lg"`, `"$spacing-4"`), so the
design follows the theme when it changes. `get_document_format`, on the editor's MCP server,
gives an agent the whole format as a JSON Schema.

A page file is JSON written one node per line: a node's own fields on its line, its children
indented below it. A change in the inspector is a change to one line, and a reviewer reads the tree
from the indentation. With `pagePngs` on (**Settings** › **Repository** › **Write a PNG of every
page**), every page also gets a PNG beside its file, `orders.page.png`, drawn by the editor's
preview at the size of the page's frame. It is drawn again only when the page, its frame or the
design system changes, so anyone browsing the repository sees the screens and a pull request shows
them as image diffs. A page changed while no editor is open keeps its old picture until one opens.

The **Layers** panel shows the whole canvas at once, as a design tool does: every page with its
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
fields they differ on say "Mixed"), the menus, the selection's bar and the keys, as one undo step.
⌘\ (Ctrl+\) puts the panels away, and `?` lists every shortcut, written as your platform writes
them. ⌘K (Ctrl+K) finds any command by its name: a panel, a tool, a zoom, what the selection's
right-click menu offers, a page, a canvas or a chat.

The editor is cards floating over the canvas. At the top left, one card holds the project (its
name over its branch, **Search** and the left panel's toggle), the canvas shown, and the rail of
panels beside the left panel: **Agents**, **Layers**, **Components**, **Comments** and **Changes**
on the canvas, with **Settings** and who you are at its foot. At the top centre, the place switch
says where you are: **Canvas**, **Design system** or **Prototype**. At the bottom centre are the
tools in one row: **Insert** (+, a row, a column, a text or an image), the tools, **Undo** and
**Redo**, and the zoom. While something is selected, its bar sits above the tools: what your
design system offers for it, a link, and its menu (**More**). On the canvas the selection keeps
only its tag: its name, and the agent's ✦ button.

At the top right, the right card holds **Design** (the inspector) and **Code**. It is there only
while something is selected; put away, it is a small card with its name and the button that
brings it back. Each side panel is put away on its own: with the right one away the canvas is the
agent's, with the chat beside it. ⌃1 is the canvas and ⌃2 the prototype on a Mac, Alt+1 and Alt+2
elsewhere. In the desktop app on a Mac the window's buttons sit in the project's card, and
dragging the top of the window between the cards moves it.

**Undo** and **Redo** name in their tooltip the step they would take. When a step cannot be taken
because a file it touched changed outside the editor, the history past it is dropped, and the
button's tooltip says why ("Nothing to undo: … changed outside the editor") until there is
something to step to again.

When a page is ready, **Implement** in the inspector's **Code** section (or **Implement with an
agent** in the page's menu, or `/implement <url or file>` in a chat) asks an agent to write it in
your application with your own components and conventions: the tokens become the matching
Tailwind v4 classes, each system component your application's own component for it (written in
its library's way where it has none). The right card's **Code** tab shows the same translation
for the selected element, written by the server through the project's style system.

## Designs and the code that implements them

The design is what the UI looks like and which states it has; the code is what it does
([ADR 0030](../adr/0030-the-implementation-link.md)). The editor never runs your application,
but it keeps the link between the two:

- **Status.** A page is a draft, ready (**Mark ready** in the inspector, **Mark ready to
  implement** in its menu), implemented, or changed since: the design, the code or both. The
  Pages panel shows it as a dot, and the inspector's **Code** section says which files implement
  the page and lists what changed in the design.
  `implementation.json` and the designs as they were implemented (`_implemented/`) live in the
  designs directory and are committed. A page renamed, or moved to another canvas, keeps its
  link; a copy is a new design and starts as a draft.
- **Tokens waiting for the code.** A token changed in the design and not exported yet is not in
  the application: a page that uses one says so ("Implemented · tokens wait for the code"), the
  inspector names them with an **Export** button, and `/implement` brings them over before
  writing the page. An agent cannot mark a page implemented while one of its tokens waits.
- **Implement what changed.** An implement chat is told the changes since the page was
  implemented, its behaviour notes, its states and the tokens it waits on, then the whole
  design, and marks the page implemented with the files it wrote.
- **Behaviour notes.** A comment can be a behaviour note: what the code must do that a design
  cannot show ("only admins can delete", "disabled until the form is valid"): **Make it a
  behaviour note** in the comment's menu. It is pinned to its element and goes to the code with
  the page. A component has its own, in its file (**Behaviour notes**, in its board's
  inspector), and they go to the code when it is implemented.
- **Bringing a project in.** Pages built before the project came into the editor start as
  drafts. Pick several on the canvas and their menu marks them all ready to implement, or finds
  their code with an agent (`/implement --adopt`; a canvas's menu has **Mark every page ready to
  implement** and **Find the pages' code with an agent**): an agent finds the files that already
  draw each page and links them, changing no code.
- **States.** **Draw a state** (in a page's menu) draws the page again in a state, empty,
  loading, with an error or a dialog open (`orders@empty.page.json`; **New state…** names a new
  one); a link can open it, and implementing the page implements it as that state of the same
  screen.
- **Design and implement chats.** A chat designs: its agent may write the designs directory
  only, and a request about behaviour becomes a behaviour note. A chat started with
  `/implement` (the **Implement** button) implements, and may write the whole repository.
- **Agents outside the editor.** Connected through `claude mcp add` (**Settings** › **Agents** ›
  **Connect over MCP**), an agent is told how to use `handoff`: what is ready or changed, the
  task for one, marking it implemented, writing a behaviour note on a page or a component, and
  exporting the design's token values to the code (or importing the code's).
