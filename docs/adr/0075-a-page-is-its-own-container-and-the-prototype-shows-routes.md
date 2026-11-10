# ADR 0075: A page is its own container, and the prototype shows the routes

Status: accepted, 2026-11-10. Amends 0015 (a page's root), 0020 (the Pages panel, a page without
a URL in the prototype) and 0021 (a link to a page without a URL).

## Context

A page was three boxes on one rectangle: its frame, its root, and a wrapper under the root. The
root was always a column, so a page that needed a row, or only padding, got a container filling
it: all 33 pages of this repository's canvases had exactly one child under the root, a
full-width row or column, 23 of them fixed at 900 px to stand for the screen. A click inside a
page selected that wrapper, which outlined the whole page without the page being selected. The
page itself was selected another way (`selectedPage`, beside the selection of nodes), with a
toolbar of its own, and had its own fill, padding and gap, as did the wrapper one level down.

The prototype's panel listed every page of the canvas, those without a URL under a warning, and
the prototype could show such a page (`?page=`) under another. Routes are worth keeping as they
are: every front end has them, and `/implement` writes a page at its route. What the prototype
shows should be exactly them.

## Decision

**A page's root is the screen's own container.** It lays its children out as a column, or as a
row when `direction` is `"row"` (set at a breakpoint as a row's `type` is), with the fill,
padding, gap and alignment it already had, at least as tall as the screen (`min-h-screen`, the
frame's height on the canvas). A row root stretches its children to that height. The root stays
`type: "page"`, which the renderer, the pictures and the code generator know it by.

- **A wrapper folds into the page** (`design-document`'s `page-root`): a root holding one row or
  column as wide as itself, with nothing of its own but its fill and gap, takes the child's
  layout, the child's fields winning, its type becoming the root's direction, a height of the
  screen's or `fill` dropped and any other height kept as the root's minimum; the child's
  children move up. A row as tall as its content does not fold, nor a child with a field the root
  cannot take (a margin, a maximum width, a border). It is one update and one unwrap, one undo
  step. The editor's Unwrap on a page's wrapper folds it; `apply_operations` warns of one that
  would fold. The Figma import lifts a row frame onto the page as it did a column.
- **Selecting a page is selecting its root.** There is one selection, of nodes; a page's title,
  its row in Layers and a click on nothing inside it select its root, and a click inside selects
  what is under the pointer. The page's bar is the element toolbar of its root, with the
  viewport and the views a root has. The root's menu is the page's: rename, duplicate and delete
  act on the file.
- **The prototype shows the routes.** Its panel is Routes: one row per route, the route and the
  page's name, with the page's variants and states under it, and a way to give a page of the
  canvas a route. A page without a route is a **draft**: on the canvas, with no warning, never in
  the prototype. Entering the prototype from a draft opens it on the route it was last on, or the
  home route, its bar saying once that the draft has none, with a way to give it one.
- **The route shows on the canvas**, after the page's name over its frame, pressed to change it.
- **A link leads to a route.** Goes to lists the routes, then the drafts under their own
  heading; picking a draft asks for its route, filled in from its name, and links to it then. A
  link is still written as the page's file, so it follows renames and changes of URL. A link that
  leads to a draft leads nowhere in the prototype and says so where it is set.

## Consequences

- The pages of this repository's canvases were folded with the change; their pictures were the
  same before and after, but for three pages whose content was a few pixels taller than the 900
  px the wrapper fixed, which the page now grows to hold.
- A fold changes the design: a page already implemented reads as changed, and `/implement` sends
  the root's new classes.
- A wrapper with a fill shorter than its frame would paint the whole page once folded; the fold
  keeps such a height as the page's minimum, so it is no shorter than before.
- `?page=` stays in the links the editor copies, for a page of the canvas; the prototype no
  longer takes it.
- Not decided here: pages and the nodes placed beside them as one kind of thing on the canvas,
  route parameters and nested routes with a shared layout. None of them is made harder by this.
