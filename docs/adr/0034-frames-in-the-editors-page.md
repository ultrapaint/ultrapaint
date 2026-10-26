# ADR 0034: The frames are drawn in the editor's page, without iframes

Status: accepted, 2026-10-26. Supersedes 0011's iframes (the preview core, the renderer and the
framework package stay). Amends 0015 (the preview draws the documents the editor gives it,
called directly), 0031 (one port forwarded over SSH) and 0033 (the iframe pool and the agent
cluster go). Plan: `docs/PLAN-editor-renderer.md`.

## Context

The canvas draws pages with the repository's real components, the design's tokens (0028) and
looks (0029) over them. Each frame was an iframe on a Vite dev server, and each iframe loaded its
own React and every component module again. ADR 0033 gave the iframes a process of their own,
kept sixteen of them loaded and loaded new ones three at a time. What was left came from the
iframes themselves: a frame seen for the first time was white for 0.3 to 2.7 s; each screen more
cost 6 to 14 MB; every hover, hit test, measure and text edit was a message and an answer; the
desktop app forwarded a second port, which moved, over SSH.

## Decision

**The repository's components run in the editor's page.** The server forwards `/preview/` to the
preview's Vite server, the socket of its live updates included, and the editor's dev server
forwards it to the server: the editor imports the generated entry from its own origin, and with it
one copy of the application's React and modules for every frame. The preview runs React's
production build. The generated files and Vite's cache are written outside the repository, in
`~/.cache/ultrapaint/preview/<designs directory>`; the designs directory holds none of them.

**A frame is a shadow root**, holding a body element and a root element as an iframe's document
would, contained and a query container of its size. `preview-core` mounts a page in it
(`createPreview`, `mountFrame`) and answers for it directly: hit tests, rectangles, measures,
tokens and text edits are calls on the frame's root, in the page's own pixels whatever the
canvas's zoom. The editor speaks to it through `FrameBridge`, as it did, which now calls it.

**One stylesheet serves every frame.** Vite's client, patched by the preview's server, hands the
application's stylesheets to the preview core instead of the editor's head. They, the design's
token values and the specs' stylesheet are rewritten for a frame (the document's root and body
become the host and the body element, media queries on the window's width become container
queries, the window's units the frame's) and adopted by every shadow root; font faces and
registered properties go to the editor's document.

**The canvas is inert.** A frame's content takes no focus and no events while designing; the
editor selects with the preview core's hit test, and its shortcuts, paste and wheel leave alone
what comes from inside a frame. The prototype and interact mode lift `inert`, and the components
behave as they do in the application; a popup they open on the document's body is moved into
their frame (told by the stack, and by the frame that last drew or took input).

**A frame drawn once keeps its page.** Off the screen it stays where it is,
`content-visibility: hidden`, and is shown again without being laid out; a canvas switched away
from parks its frames, 32 kept. A frame is not told to draw again what it shows. The camera's
zoom (`--inv`) is pinned above each host, so a zoom does not style again the host, whose `:host`
rules carry all the page's tokens.

**Vite's client never reloads the editor on its own.** A full reload asks the editor, which loads
its page again (the only way to drop modules out of date); its error overlay and its forwarding
of the page's console are off.

## Consequences

Measured on the Redesign canvas (10 frames, 4,287 layers) on the same machine:

| | Iframes (0033) | Frames in the editor's page |
|---|---|---|
| Load, every frame drawn | 1,757 ms | 402–418 ms |
| Pan: busy / longest task | 12–14% / 7 ms | 14–16% / 9 ms, nothing blank |
| Zoom: busy | 25% | 28–29%, no frame over 33 ms |
| Switching canvas and back | | 27–75 ms, nothing loaded again |
| Renderer / all processes | 539 / 780 MB | 340–454 / 582–692 MB |

- No iframe is left in the editor: the canvas, the prototype, the type samples, a component's
  matrix and every picture are frames of its page.
- The application's code shares the editor's main thread. A document-level hotkey in it hears the
  editor's keys; an infinite loop freezes the editor; hooks on `window` see the editor's window.
- With 50 frames on screen a zoom keeps 60 fps but the editor busy (73%), mostly the frames'
  chrome; low-zoom pictures were not built, a picture of a page costing 0.6 to 2 s of the
  editor's thread.
- Over SSH the desktop app forwards one port.
- A change to a component's code redraws its frames from the registry instead of refreshing them.
- Instances are drawn through the renderer and read through the DOM only, so captures of them (a
  static cache) can be tried later without changing the editor.
