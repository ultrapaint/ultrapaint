# ADR 0012: Spaces, pages and a simulated router

Status: accepted, 2026-09-17. Replaces the screen-and-flow model of D2 in the work definition.

> Amended by [0019](0019-canvases.md), 2026-09-30: a space is a canvas, marked by its
> `canvas.json` (which takes over `space.json`), and the variants below are built.
>
> Amended by [0015](0015-design-documents.md), 2026-09-25. Spaces, routes from the file system and
> the router state in the editor's URL stand, with `.page.json` in place of `.tsx`
> (`pricing.page.json` is `/pricing`). The generated `_router.tsx` is gone: a node's `link` names
> a route, and the prototype follows it. Nodes outside any page live in the space's
> `canvas.json`.

## Context

A screen was a TSX file in the designs directory and a flow was the subdirectory holding it.
Nothing connected two screens: the prototype workspace stepped through the flow's files with a
previous/next strip, one iframe per screen, remounted on every step. Real applications do not
work that way. They have routes, links and a history, and what a designer wants to try out is
exactly that: press the button, land on the other page, press back.

The flow was also doing two jobs at once — a folder of screens and the unit the canvas is saved
for — and the goal document already asks for alternatives ("variants of one screen" is named in
the storage verdict as a thing TSX cannot carry today).

## Decision

**A space is the unit of navigation.** A space owns one router, one canvas and its own pages.
A page of one space cannot navigate to a page of another: routes are resolved inside the space
that asked. Several spaces are a data-model fact from the start (different applications, or,
later, alternatives), even though the editor currently opens one.

- A directory holding a `space.json` is a space. The designs root is an implicit space when no
  `space.json` exists anywhere below it, which is what makes an existing repository keep working
  and a first repository start with exactly one router.
- `<space>/canvas.json` keeps the frames, keyed by the page's path inside the space (it used to
  be the file's base name, which cannot survive nested routes; a legacy base-name key is still
  read).
- `Screen` becomes `Page` on the wire, in the panels and in the preview protocol.

**Routes come from the file system**, the way every React router in use does it, so that agents
need no explanation and no manifest can fall out of sync with the files:

| File inside the space | Route |
|---|---|
| `index.tsx` | `/` |
| `pricing.tsx` | `/pricing` |
| `settings/index.tsx` | `/settings` |
| `settings/billing.tsx` | `/settings/billing` |
| `invoices/[id].tsx` | `/invoices/:id` |
| `docs/[...rest].tsx` | `/docs/*` |
| `_anything.tsx` | not a page |

Matching prefers a static segment over a dynamic one and a dynamic one over a catch-all.

**The editor holds the router state, in its own URL.** `?space=<id>&route=<path>` is the truth.
A link pressed inside the preview does not navigate the preview: it asks
(`ed:navigateTo`), the editor decides, writes its URL and tells the preview what to render
(`ed:route`). Consequences that are the point of doing it this way:

- the browser's back and forward buttons are the prototype's back and forward, and a prototype
  state can be reloaded, bookmarked and pasted to someone else;
- the route panel, the canvas and the prototype cannot disagree about where we are;
- in the design workspace a link press is navigation the editor understands: it focuses the
  frame of the target page instead of changing what the frame shows (`nav=pinned`), which is
  where prototype arrows between frames will come from.

The preview keeps one iframe per space in the prototype workspace and swaps the page inside it
through the router, so provider and component state survives a navigation, as it does in the
real application.

**Pages navigate through a generated module**, `<designsDir>/_router.tsx`, written on first use
and never overwritten. Pages import it relatively:

```tsx
import { Link, useNavigate, useParams, useRoute } from "../_router.tsx";
```

It is ordinary React with no ultrapaint import, so a page still compiles and runs in the
repository outside the tool. Inside the preview it finds `window.__ED_ROUTER__` and defers to
the editor; outside it falls back to the browser history. `to` accepts a route (`/settings/billing`)
or a page path inside the space (`settings/billing.tsx`), which is the "navigate to that page"
form the file tree already gives you.

The renderer's contract grows with it: `renderToCanvas` is handed the space's routes and the
route to show, and returns a handle whose `update(route)` renders another one. Route derivation
and matching are pure and live in `@ultrapaint/shared/route`, so the server, the editor and the
generated entry agree on one implementation.

## Variants (designed, not built)

An alternative is a second take on the same work that may span several routes — one landing page
in two directions, each with its own pricing page. It is not a second space: a space would lose
the shared base and could not be compared route by route.

A variant is a named overlay inside one space. `pricing.tsx` is the base, `pricing@bold.tsx` is
the same route in the `bold` variant, and a route with no file in the variant falls back to the
base, so a variant may cover one page of ten. `space.json` lists the variant names and their
order. The editor gains a variant switch in the prototype bar (the whole click-through stays in
the chosen variant), and the canvas can put a variant's frames in a column next to the base's.
Nothing of this is built yet; what is built leaves room for it: `@` is not produced by page file
naming, `space.json` is versioned, and a page's identity is already (space, route) rather than a
file name.

## Consequences

- An existing designs directory keeps working without moving a file: its screens become the
  pages of the implicit root space, and their routes are their paths. `canvas.json` is read in
  both key shapes and written in the new one.
- `PREVIEW_PROTOCOL` goes to 4: `screen` is `page` in every message, and `ed:route` /
  `ed:navigateTo` are new.
- A page that does not use the router module is still a page. Nothing is injected into a page's
  source, and `_router.tsx` is the only file the tool generates next to the designs.
- The prototype workspace no longer steps through files. Its bar is back, forward, the current
  route and reload; the left panel is the route tree, rendered like the layers tree.
- Navigation cannot cross a space, because a route is only ever matched against the routes of
  the space the request came from.
