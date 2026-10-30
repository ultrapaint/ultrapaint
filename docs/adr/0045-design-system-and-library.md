# ADR 0045: The Design system and the Library

Status: accepted, 2026-10-30; built in the phases of `docs/PLAN-design-system-and-library.md`.
Amends 0032 (the rail's places: Assets goes, Library comes, the elements move to the tools),
0029 and 0044 (the Design system panel's Components tab goes: a component's look is edited on its
board), 0041 (the Assets panel's components are the Library's, and an app component's variants
are drawn side by side on a view of its own, as it said would wait for a redesign), 0040 (a
system component's matrix is its board) and 0028 (a token edit is one of `designSystem.edit`'s
operations, still one undo step). The screens are sketched on the Redesign canvas
(`design-system-color`, `library-insert`, `library-button`, `library-app-component`). The terms
are in `GLOSSARY.md`.

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: the board view is one of the main area's two surfaces (`showBoardFramesWith` and `takeBoardSelectionWith` go); a board's picks have one grammar; a pick crosses the wire as a `LookPlace`.

## Context

The design system has one panel, the width of the rail's column: swatches, type specimens and
token rows on a Tokens tab, every component's look on a Components tab, DESIGN.md on a third. A
token is changed by a right-click and a prompt; a component's look is edited in fields under a
matrix scaled down to the panel, saved with a button, and an app component there is read-only.
The Assets panel offers the elements above every component, system and app alike. So the
design system's values, the components built on them and what is placed on a page share two
panels that each do a little of all three, and the panels are too narrow to show a palette, a
component in every variant and state, or an app component's variants side by side, which 0041
left for a redesign.

## Decision

**The rail's places are Agents, Layers, Design system, Library and Changes.** Assets goes. The
elements (Row, Column, Text, Image) are offered by an **Insert** menu, the first of the canvas's
tools (+), a plain menu as the tools' others are; Group stays the group tool.

**Design system is the foundations and the guidelines.** Its panel lists the **Foundations** the
design system has data for (Color, Typography, Spacing, Radius, Elevation, Motion, Breakpoints)
and the **Guidelines**, DESIGN.md's sections, with a search over the tokens; the Sync and the
set-up stay where they are, in the panel's title. Opening Design system opens its board view on
the foundation or guideline picked, Color first.

**Library is the components: App components, then System components.** On a page canvas it is
the **insert list**: a search, the components as tiles drawn as the canvas draws them (the
thumbnails the Assets panel drew), a click inserting into the selection and a drag placing one
anywhere, as Assets did; a ↗ on each opens its board, **+ New** makes an app component, and a
quiet line at its foot says that colours, type and spacing are in Design system. On a board
view the same list is the navigation: the item open is highlighted, **Back to** the page or
canvas left is at its top, and an **Overview** opens every component in its default look, one
click opening one.

**A board view shows the item picked and nothing else.** The main area becomes the canvas's pan
and zoom over the item's **boards** on a background of their own, a blue-tinted dark with a faint
grid of dots, so that it is never taken for the page canvas; the element toolbar is not there.
A board is a **generated document drawn as a frame**, by the renderer that draws pages, as the
Components tab's matrix already is: nothing is drawn by a second renderer, and a board cannot
drift from the data it is generated from. A board's nodes are named for what they stand for (a
swatch for its token, a cell for its variant and state), so a click on one picks it.

- **Color**: every palette as its ramp, 50 to 950, over a gradient strip, the light and the dark
  theme side by side, and the usual pairs of foreground and background with their contrast ratio
  and whether it passes. **Typography**: the type scale and each text style with a sample.
  **Spacing, Radius, Elevation, Breakpoints**: their tokens as specimens, as the panel drew them.
  **Motion**: each easing animated. Elsewhere than Color, a light and dark switch in the tools
  picks the theme drawn. A **guideline** is its section of DESIGN.md as a readable document,
  edited where it is read (`designSystem.setSection`).
- **A system component's board**: every variant in every state at full size (0044's matrix,
  `data-ed-state` pinning each), each size, its parts named; the interact tool makes hover and
  press live on it.
- **An app component's board**: each of its variants (`<property>=<member>`) side by side as far
  as the canvas holds at 100%, the next one under them when it would not fit, drawn live; its tree is edited in place on any of them (a double-click, as on a page), an edit
  landing on the member of the frame it is made in, and Layers shows that tree. Layers is on the
  rail only on a board with a tree.

**The right panel is the item's inspector**, not Design, Code and Comments. A token: its value
in each theme (a colour picker and the text), its description, its group, where it is used and
deleting it; a group: its name and adding a token; a text style: its font, size, weight, leading
and tracking as token pickers; a palette: **Generate ramp from…**, one base colour giving its 50
to 950 in each theme. A system component's cell: the look's fields in that variant and state,
each empty one saying what it takes and from where (`look-places`), its notes, and where the
component is used. An app component: its properties, variants and slots.

**Edits are live.** A field committed is one undo step (0028) and every page drawing it follows
as it is typed; there is no draft and no Save. The design system is changed through one RPC,
`designSystem.edit`, a list of typed operations (a value in a theme, a description, a token
added, taken out or moved, a group added or renamed, a text style set or taken out) applied by a
pure `applyEdits` in `design-document` and written through the design system's one write path
in one step; `setToken` is one of them. Renaming a token, which rewrites pages and code, and
gradient tokens are not edited here yet. A component's look is changed by a component change
(0043) made on its file as it is, a field at a time.

**Where the editor is, the URL says**: `?view=system&item=color`, `?view=library&item=Button`,
beside the canvas and the page left, so that a reload or a link lands on the same item and Back
returns to the page.

**What is picked on a board reaches the agents** as the selection on a page does: the chat and
the context an agent is given say the token, the component, or the component's variant and
state picked, with its file. No MCP tool is added (0043's budget).

A project with no design system yet sees the default look on every board, with a Set up on the
Overview and on Design system.

## Consequences

- The design system and the components each have a place as wide as the canvas, and a page's
  panels only what a page needs; Library on a page is the Assets panel without the elements.
- The Components tab and its drafts go, and with them the matrix scaled into a panel; the
  boards are the only place a component's look is edited, and the Design system panel's
  swatches, specimens and rows become boards.
- A board's frames are not a page's: the editor tells a board's frames from pages and nodes on
  the canvas, keeps a camera of the board view's own, and leaves the page canvas's frames, its
  selection and its performance as they were.
- An agent is told what is picked on a board through what a task and a selection already carry,
  so what it reads does not grow.
- What was learnt building it (the plan's "As built" notes have the detail): a board keeps a
  layout the document format has no word for in a stylesheet of its own (Motion's animation, the
  matrix's grid, the Overview's scaled tiles); an item first seen is fitted between the panels,
  never zoomed in past 100%; a click on an app component's board picks its variant, and the tools'
  Insert menu shows on a board while its tree is edited in place; the right-click menu on a token
  went with the panel, its value edited in the inspector; what DESIGN.md's linter says is listed
  under the guidelines.
- What an agent is told of a board's pick is a prompt attachment of its own, `board`: what it is
  (a token, a colour group, a text style, a foundation, a guideline, a system component at a
  variant and a state, an app component at a variant), what it is now and its file, said in a
  sentence by the server; a node of a tree edited in place is attached with the component's file.
- Left for later: renaming a token, gradient tokens, a canvas of everything, icons and images in
  the Library, editing elevation levels and animations as tokens, "Used in" across every canvas
  rather than the one open, and Layers showing what a variant overrides in a text.
