# ADR 0019: Canvases, variants and snapshots

Status: accepted, 2026-09-30. Amends 0012 (spaces become canvases, variants are built), 0014 (the
tools take `canvas`) and 0015 (assets are shared).

> Amended by [0030](0030-the-implementation-link.md), 2026-10-25: a canvas also lists `states`,
> a page drawn again in a state of the same screen, which a link can open.
>
> Amended by [0037](0037-deep-modules.md), 2026-10-27 ([PLAN-architecture](../plans/done/PLAN-architecture.md) step 5): named snapshots are
> kept in the tool's snapshot store (0031), under its `designs` namespace, rather than one JSON
> file each under `<state>/snapshots`. Only the format changes: what a snapshot is, keeps and
> does is as below. Snapshots in the old format are imported when the server starts.
>
> Amended 2026-11-10: snapshots in the old format are no longer imported, as checkpoints are not
> (0008).

## Context

A project had one surface. Everything lived on it: the application's screens, their wireframes,
a sheet of components, logos, a second direction for the landing page. Figma answers this with
the pages of a file, separate canvases listed above the layers. We had the data model for it
already, the space of 0012 (a directory with its own router and canvas), but the editor opened
the first space and offered a dropdown only once there were several. There was no way to make a
new one, name one, copy one or move pages between them.

"Page" was not available as the word: a page is a route's document. The user called the thing
a canvas, and each of them has exactly one canvas, so the word names both.

## Decision

**A space is now a canvas, in the code, on the wire, in the tools and in the files.** A
directory holding a `canvas.json` is a canvas; while there is none below the designs directory
it is itself the one canvas. `canvas.json` was already the layout of a space's surface. It now
also holds what `space.json` held (`name`, `home`, `variants`), and `space.json` is no longer
read. The designs directory's own canvas is `""`. A canvas owns its pages, their routes and the
loose nodes placed beside them. A link never leaves its canvas: the same route can be a page in
two canvases, the wireframe of `/pricing` and the finished one.

- `Page.space` is `Page.canvas`, `PageList.spaces` is `canvases`, the editor's URL says
  `?canvas=`, and every RPC and MCP tool takes `canvas`. The MCP tools' boolean `canvas: true`
  for the loose nodes is now `loose: true`.
- The first canvas made beside an implicit root gives the root a `canvas.json` of its own, or its
  pages would belong to no canvas at all. A new canvas never takes over a directory that exists,
  since the pages in it belong to a canvas already: its id is its name made safe and numbered
  past what is there.
- `canvases.json` at the root of the designs directory keeps the order of the list. A canvas it
  does not name comes after, by id.

**The Pages panel lists the canvases above the routes**, as Figma lists the pages of a file above
the layers. One is open at a time. A canvas is created with +, opened with a click, renamed with
a double click (only its name changes; its directory and every link into it stay), reordered by
dragging, and has a menu: rename, duplicate, duplicate with an agent, draw the components with an
agent, move up and down, delete (not the last one). Every change is one undo step.

**Copying.**

- *A whole canvas* is duplicated into a new one: every page, the layout and the canvas's own
  assets, placed after it in the list. The two go on apart. Node ids are unique within a
  document, so the copies keep them.
- *Some pages* are copied or moved into another canvas, or into a new one, at the same routes and
  with their frames where they were. Pages are picked together in the Pages panel with ⌘ or
  Shift, and the page menu then acts on all of them. A target that has a page at one of the
  routes already refuses. Links to routes that did not come along lead nowhere in the target,
  as a link to a missing route always did.
- *With an agent*: the canvas is duplicated, then a thread opens with `/redraw <canvas> <what to
  change>` in its composer, unsent. The dialog offers "To high fidelity" and "To wireframes".
  The command's task says to work page by page in that canvas only, to keep routes, links and
  the ids of the nodes it keeps, and to look at each page when it is done.

**A component sheet is a normal canvas.** Nothing makes one by default. "Draw the components with
an agent" opens a thread with `/components <canvas>`: the agent draws one page per category
(`/components/forms`), or one page when there are few components, with every component in each
value of its variant props and in the states that change how it looks, from the example props
`/init` wrote. Run again, it brings the sheet up to date instead of drawing it twice. Components
are still code: the sheet shows them, it does not define them.

**Variants are built as 0012 designed them.** `pricing@bold.page.json` is `/pricing` drawn again
for the variant `bold`; a variant may redraw one page of ten. `canvas.json` lists the variant
names in order, and any variant a page file names is added to the list. "Draw a variant" on a
page copies it into the variant's file, with its frame under the page's in the same column. In a
variant, the router serves each route with the variant's page when it has one and the base's
otherwise (`pagesInVariant` in `@ultrapaint/shared/route`), so the whole click-through stays in
the variant. The prototype bar has a variant switch when the canvas has variants; the editor's URL
carries `&variant=`; working inside a variant's frame puts the router in its variant. The Pages
panel shows a route's variants under it. A page moved to another route or duplicated keeps its
variant (`pricing-2@bold`). A route names its base page for agents; a variant's page is named by
its file.

**Assets are shared.** `assets/` at the root of the designs directory is every canvas's, and a
canvas may have its own `assets/`, whose files take the place of shared ones of the same name.
An image node's `src` is still `assets/<file>`. Uploads and Figma imports go to the shared
directory, so a logo drawn in one canvas can be used in another. A duplicated canvas takes its
own assets along, which is how a version gets an image of its own without changing the original.
Only the preview's dev server can tell which file exists, so the preview asks it
(`/@ultrapaint/asset?canvas=&src=`), and the server redirects to the file.

**Snapshots are named points in history, not copies.** A snapshot keeps the text of every design
file, as a checkpoint does (0008), under a name, in the state directory (in the tool's snapshot
store since 2026-10-27, as amended), until it is deleted:
"the version shown to the client". The Changes panel saves one, keeps an agent turn's checkpoint
as one, and lists them. A snapshot can be:

- *opened* to look at: the editor shows the canvases, pages and documents it kept, read-only, with
  a banner that says so. Nothing is saved while it is open and the server's news about the files
  waits; every edit is turned away with a notice;
- *compared* with now, one diff per file;
- *restored*: the files are written back through the undo journal, as one step that undo takes
  back.

Comments are the conversation about the designs, not the designs: a snapshot neither keeps nor
restores them. Images are not kept either, as the undo journal does not keep them. A snapshot is
local; what is shared is what git commits.

## Consequences

- A repository with a `space.json` has to move its name into `canvas.json`; nothing converts it.
  One without (the implicit root, which is nearly all of them) opens unchanged.
- `PREVIEW_PROTOCOL` is unchanged: the preview's configuration gains `assets` and says `canvas`
  where it said `space`.
- The briefing tells agents what a canvas and a variant are, and lists the routes under their
  canvas when there are several. `get_context` describes each canvas (id, name, pages, variants)
  and `list_pages` says each page's canvas and variant.
- This repository's own designs are split: the redesign and the samples are canvases of their
  own.
