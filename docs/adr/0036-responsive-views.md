# ADR 0036: A page is drawn in views, and its values change at the design system's breakpoints

Status: accepted and implemented, 2026-10-26. Amends 0015 (a node's fields can differ per
breakpoint), 0020 (a page's frame has views beside it) and 0034 (a component's `matchMedia` and
`innerWidth` answer for its frame). Plan: `docs/plans/done/PLAN-responsive-views.md`.

> Amended 2026-11-10: `resolveAt` is gone; `resolveAtBreakpoint` is the one function that lays
> the breakpoints over the base.

## Context

A page is one tree of nodes, and every field of a node has one value, drawn as an inline style
(`css.ts`). The repository's components respond to a frame's width, since 0034 turns their media
queries into container queries of the frame, but the design around them does not: a row of three
columns is three columns at 390 px, a width of 1440 is 1440 on a phone. The prototype's devices
resize the viewport and nothing in the design answers. A project that wants a page on a phone
draws a second page (`Home mobile`), which drifts from the first and which the prototype cannot
reach at the device's width. The code the design turns into is Tailwind's, where the same
element takes `flex-col md:flex-row`.

## Decision

**A node's fields can differ per breakpoint.** Beside its values, a node holds `at`: for a
breakpoint's name, the fields that differ from that breakpoint on (`"at": { "md": { "gap":
"$spacing-6" } }`). What can differ: every field of the box, the stack and the text (`text`
included), an instance's `props`, `hidden`, a new `order` among its siblings, and a stack's
direction (`type` between `row` and `column`). What cannot: `id`, `name`, `link`, `locked`, the
position on the canvas, children.

**The breakpoints are the design system's** (`layout.breakpoints`, `--breakpoint-*`), Tailwind's
when it names none. **The cascade is mobile-first**, Tailwind's: the node's own values are the
smallest screen's and `at.md` holds from `md` up. There is no desktop-first setting; a project
that needs one is a later decision.

**A page is drawn in views.** A view is another frame of the same page at a width of its own,
any width, beside the page's frame: not a copy, the same document drawn again. Views are listed
under the page's frame in `canvas.json` (`frames.<page>.views`). A view shows the values of the
breakpoint its width falls in; a page without views is drawn once, as now.

**An edit lands at the breakpoint of the view it is made in**, and holds from there up unless a
further breakpoint says otherwise: an edit in the view below the first breakpoint changes the
node's own values, which every view shows. The page's own frame is one of its views, at its
width. Set back to what it inherits from below, a field loses its override. A page **without
views** is edited at the base, as before views existed, except a field the frame shows from a
breakpoint's `at` (an agent wrote it), which is edited where its value comes from: what changes is
what is seen. The inspector's Breakpoints section says where edits land, lists what the node sets
at each breakpoint (dimmed above the view's), and resets each. Where a node is shown is one rule
chosen there from any view: at every width, nowhere, from a breakpoint up or below one. Inserting, removing, moving and
wrapping nodes change the one tree every view draws; a node inserted in a view above the base is
hidden below that view's breakpoint.

**A frame draws the tree as it is at its width.** Every frame's width is known (a page's frame,
a view, the prototype's device, a screenshot's `width`), so the editor resolves the tree there
(`resolveAt`, the base and then each breakpoint up to the width laid over it) and the renderer
draws inline styles as before; a node no breakpoint touches is the same object, so nothing is
drawn again for it, and a frame resized across a breakpoint is drawn again. The proposal drew the
differences as `@container` rules in the frame's stylesheet; resolving is simpler, needs no
stylesheet per document, and gives the inspector, the layers and the selection's tag the same
values the frame shows. **The code generator writes the breakpoints as Tailwind's prefixes**
(`md:gap-6`, `max-md:flex-col` for what a breakpoint drops, `md:max-lg:` for a range); a text, or
an instance's props, that differ become one element per run of widths with the `hidden`
variants.

**A component's own JavaScript sees its frame's width.** `matchMedia` on the window's size and
`innerWidth`/`innerHeight`, called by the preview's modules, answer for the frame being drawn (the
renderer says so as it draws and as its effects run) or the one that last took input, and a
query's listeners are told when that frame is resized across it.

## Consequences

- A page with no `at` and no views is drawn and written to code as before.
- The canvas draws a page once per view: more frames for the same pages, each a frame of 0034's.
- A selection is a node of the page, shown in every view that draws it; the frame it was made in
  says which breakpoint the inspector edits.
- Agents write overrides with `update`'s `at` and add views with `set_frame`; the layout skill
  designs the base screen first and checks every breakpoint.
- `/implement` sends the overrides with the rest; the implementation link compares them as fields.
- A second page drawn for a phone (`Home mobile`) stays a page; folding it into views is the
  user's or an agent's work, not a migration.
- A width read while a component draws again after its own state changed (not in an effect or a
  handler) can be the frame drawn last rather than its own; `resize` events on the window are not
  sent for a frame. `matchMedia` listeners are.
- Agents name only the design system's breakpoints: `apply_operations` refuses another.
