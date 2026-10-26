# ADR 0034: The frames are drawn in the editor's page, without iframes

Status: proposed, 2026-10-26. Supersedes 0011's iframes (the preview core, the renderer and the
framework package stay). Amends 0015 (the preview draws the documents the editor gives it, called
directly), 0031 (one port forwarded over SSH) and 0033 (the pool, the load queue and the agent
cluster go). Plan: `docs/PLAN-editor-renderer.md`.

## Context

The canvas draws pages with the repository's real components, the design's tokens (0028) and
looks (0029) over them. Each frame is an iframe on a Vite dev server, and each iframe loads its
own React and every component module again. ADR 0033 gave the iframes a process of their own,
kept sixteen of them loaded and loaded new ones three at a time. What is left comes from the
iframes themselves: a frame seen for the first time is white for 0.3 to 2.7 s; each screen more
costs 6 to 14 MB; every hover, hit test, measure and text edit is a message and an answer; the
desktop app forwards a second port, which moves, over SSH.

Measured in a spike (the plan has the tables), the same pages drawn in shadow roots of one page,
on one copy of the application's code, load 1.5 to 3.6 times faster, cost 1 to 2 MB a screen
more, take half the time per edit with React's production build, and differ from the iframe's
picture by 0.04% of pixels or less, faintly, once the stylesheet is rewritten.

## Decision

**The repository's components run in the editor's page.** The server proxies the preview's Vite
server under its own port; the editor loads the generated entry once, and with it one copy of the
application's React and modules for every frame. React's production build draws the canvas.

**A frame is a shadow root**, holding a body element and a root element as an iframe's document
would, contained (`contain: strict`, `container-type: size`). `preview-core` mounts a page in it
and answers for it directly: `mountFrame(host, setup)` returns a `FrameRuntime` whose hit tests,
rectangles, measures and text edits are synchronous calls on the frame's root. The message
protocol goes.

**One stylesheet serves every frame.** The application's CSS as Vite injects it, the design's
token values and the specs' stylesheet are collected into one constructable stylesheet, rewritten
for a frame (the document's selectors become the host's, the body's and the root's; width media
queries become container queries; `vh` becomes `cqh`), adopted by every shadow root and updated
in place. Font faces and registered properties go to the editor's document.

**The canvas is inert.** Frame content takes no focus and no events while designing; the editor
selects with the preview core's hit test. The prototype lifts `inert`, and the components behave
as they do in the application.

**What leaves the screen is unmounted**, and drawn again synchronously when it comes back. Parked
frames are `content-visibility: hidden`; below a zoom, frames are pictures.

**Vite's client never reloads the editor.** The proxy serves it with a full reload turned into a
remount of the frames, and without its error overlay. Portals the application opens on the
editor's body are moved into their frame.

## Consequences

- No iframe is left in the editor: not on the canvas, not in the prototype, not for pictures.
- The application's code shares the editor's main thread. A document-level hotkey in it hears the
  editor's keys; an infinite loop freezes the editor; hooks on `window` see the editor's window.
- Over SSH the desktop app forwards one port.
- A change to a component's code remounts its frames instead of refreshing them.
- The pool, the load queue and the agent cluster of 0033 go; its camera, Layers panel and
  `pnpm bench:canvas` stay.
- Instances are drawn through one seam and read through the DOM only, so captures of them (a
  static cache) can be tried later without changing the editor.
