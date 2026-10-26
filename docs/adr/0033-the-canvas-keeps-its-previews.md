# ADR 0033: The canvas keeps its previews loaded, and its camera out of React

Status: accepted, 2026-10-26. Amends 0011 (the preview iframes) and 0015 (the preview draws the
documents the editor sends).


> Amended by [0034](0034-frames-in-the-editors-page.md), 2026-10-26. The previews are no longer
> iframes but shadow roots of the editor's page: the agent cluster, `moveBefore` and the iframe
> pool go. The pool keeps shadow hosts instead, a frame that leaves the screen keeps its page where
> it is (`content-visibility: hidden`), and the camera's `--inv` is pinned above each host. The
> camera, the nearest-first queue, the Layers panel and `pnpm bench:canvas` stay.
## Context

With many screens on a canvas, panning and zooming lagged, and a screen coming back into view went
blank and was drawn again. Measured on the Redesign canvas (10 frames, 4,287 layers) in headless
Chrome:

- every preview ran on the editor's main thread: the editor and the preview server are two ports
  of `127.0.0.1`, one site, so Chrome kept them in one process. Panning kept the editor 49% busy,
  with frames of 83 ms;
- each zoom step drew every frame again (1,200 `Frame` renders in two seconds), the canvas drew
  itself on every animation frame, and the wheel laid the page out on every event;
- a frame 400 px off screen lost its iframe, and coming back was a cold load of a Vite page: 0.3
  to 2.7 s of white, no faster the second time. Switching canvas, going to a page and coming back
  from the prototype loaded every frame again;
- the Layers panel drew every layer: 3.7 s to open, 1.2 s per selection while open;
- the preview's renderer bundle carried Effect's Schema (590 KB), the anchor's Babel ran on our
  prebuilt bundles at every start, and every image was a redirect.

## Decision

**The previews run apart from the editor.** The preview page answers with
`Origin-Agent-Cluster: ?1`, and Chrome gives it a process of its own.

**The camera is kept out of React** (`canvas/camera.ts`). A pan or a zoom changes the view in the
store once a frame; the layer of frames and the grid are moved by writing their style, promoted
with `will-change` while they move. What keeps its size on screen reads the zoom from `--inv`,
which the camera sets on the layer (`screenPx`, `UNZOOM`); what has to compute with the zoom
subscribes to it alone (`useInv`). The canvas renders again only when the set of frames near the
screen changes.

**A frame's preview is kept loaded while the frame is away** (`canvas/preview-pool.ts`). The
iframes belong to a pool, not to React: a frame places its own, and parks it out of sight when it
leaves the screen, its canvas is switched away from, or the prototype is opened. Parked, it is
off screen at the size it had, so Chrome stops drawing it and the page inside is not laid out
again. It is moved with `moveBefore`, which keeps the document alive where any other move reloads
it; without it, the pool loads a preview each time as before. The sixteen least recently seen are
kept. Its bridge stays with it, ready, and a frame that comes back sends the document as it is
now.

**New previews load three at a time, nearest the middle of the screen first**
(`canvas/mounting.ts`); what is loaded shows at once. Going to a page glides there in a third of a
second, and only the previews where it goes load meanwhile.

**The Layers panel lists pages open and their layers folded**, opens the way down to a selection,
and draws only the rows on screen in a flat tree that says each row's level and place.

**A preview costs less to start.** The renderer bundle imports the names of specs from
`contracts/spec-names.ts`, without their schemas (29 KB); it starts loading every component module
its page uses when it is told what to draw. The preview server keeps the anchor's transform
plugins off our bundles and Vite's dependencies, warms the page's modules up, and sends a canvas's
images itself, with a 304 when they did not change. When the designs sit inside the anchor, the
preview's stylesheet tells Tailwind (4.1 and later) not to scan them: a page saved reloaded every
preview.

**Less is drawn for nothing**: the agents' activity is worked out once for all frames; rects that
did not move are neither sent nor stored; pages the server sends again are kept when unchanged;
Space and the tools redraw only the layers over the frames; the inspector's style fields become
comboboxes when used.

`pnpm bench:canvas` measures all of it against a running `pnpm dev`.

## Consequences

- On the Redesign canvas, panning keeps the editor 12% busy with no frame over 33 ms, and zooming
  27% with no frame drawn again. Panning back, going to a page and switching back to a canvas
  load no preview and show none blank. A canvas loads in 1.7 s instead of 2.4 to 2.7.
- A parked preview still holds its memory, about 15 MB each in the previews' process.
- A preview is not snapshotted while it loads: a picture costs 0.6 to 2 s of the preview's thread
  (html-to-image), more than the pool leaves to gain. A frame seen for the first time is white
  until it draws.
- Render messages still carry the whole document: cloning the largest page takes under a
  millisecond, too little to be worth patches.
- The previews keep React's development build, which React Refresh and the previews' HMR need.
- If the canvas stops drawing the repository's components in iframes (the renderer drawn in the
  editor's own DOM, studied in the thread on design output), the pool, the queue and the preview
  server's changes go with them; the camera, the Layers panel and the rest stay.
