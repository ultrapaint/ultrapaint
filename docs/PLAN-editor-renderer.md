# Plan: frames drawn in the editor's page, without iframes

Status: accepted, 2026-10-26; Phases 0 to 4 done 2026-10-26. Through
[ADR 0034](adr/0034-frames-in-the-editors-page.md): supersedes 0011's iframes, amends 0015, 0031
and 0033. Builds on 0028, 0029 and 0030.

## Why

Since 0028–0030 the design and the implementation are two steps: the design owns the values, the
looks and the states; the code owns the behaviour and catches up through the implementation link.
The canvas still draws pages with the repository's real components, and that stays: it is what
makes a design feel like the product, and the prototype behave like it.

What does not stay is how they are drawn. Every frame is an iframe on a Vite dev server: its own
document, its own copy of React and of every component module, a boot of 0.3 to 2.7 s the first
time it is seen, 6 to 14 MB more for each screen, and an asynchronous bridge for every hover, hit
test and edit. ADR 0033 made the most of iframes (a process of their own, a pool, a load queue);
what is left is the iframes themselves.

The repository's components run in the editor's own page instead: one copy of the application's
React and modules for the whole canvas, one shadow root per frame, one parsed stylesheet adopted
by every frame, and the preview's runtime called directly. Captures of what the components drew
(a static cache, "C") are tried afterwards as an experiment, behind a flag, before anything is
committed to them.

## Decisions

| # | Decision | Choice |
|---|---|---|
| R1 | What draws the frames | The repository's real components, live, in the editor's page (option "L"). No iframes on the canvas, in the prototype or for pictures |
| R2 | A frame | A host element with a shadow root that copies an iframe's structure: shadow root, a body element, a root element. `contain: strict` and `container-type: size` on the host |
| R3 | The application's code | Loaded once, from the preview's Vite server, proxied under the editor server's own port: one origin, one port over SSH |
| R4 | Styles | The application's CSS, `previewTokenCss` and the specs' stylesheet are collected into one constructable stylesheet, rewritten for frames (R5), adopted by every shadow root and updated in place by HMR |
| R5 | Rewrites | `html`, `:root` → `:host`; `body` → the body element; `#root` → the root element; `:host` added to `*, ::before, ::after`; `@media` on width → `@container`; `vh` → `cqh`; `@font-face` and `@property` lifted into the editor's document |
| R6 | Design mode | Frame content is `inert`: no focus, no events. Selection is preview-core's hit test on the frame's root, lifting `inert` for the synchronous read. The prototype removes `inert` |
| R7 | Away from the screen | Frames far away are unmounted; drawing one again is synchronous. Parked frames take `content-visibility: hidden`; frames on screen do not take `content-visibility: auto` (it doubled the cost of a zoom at 50 frames). Low-zoom bitmaps are required |
| R8 | React's build on the canvas | Production: it halves the time of an edit (31 → 14 ms) and of a load. A change to a component's code remounts its frames instead of refreshing them |
| R9 | Vite's client | The proxy serves it with `location.reload()` and `full-reload` turned into "remount the frames"; the error overlay is off (`server.hmr.overlay: false`) |
| R10 | Portals | A node the application adds to the editor's body is moved into the frame that was rendering or clicked, and moved back before React removes it |
| R11 | Captures (C) | An experiment after L, behind a flag: live instances serialised after they draw, keyed by component and props hash, drawn without JavaScript where they help. Committed to only on its own measurements and its own ADR |
| R12 | Format | Pages stay JSON. `providers.tsx` becomes page defaults in `design-system.json`; `providersModule` stays optional, for real React contexts, resolved from the application. Icons get a `tint`. `design.tokens.json` becomes the only token file |

Two rules keep C cheap later: an instance is drawn through one seam,
`renderInstance(component, props, slots)`; and the editor reads frames through the DOM and the
`data-ed-*` attributes only, never through React's internals.

## Measured: the spike (Phase 0)

A harness drew each page in a shadow root on the real preview server, with the editor's own
render inputs, in headless Chrome on this machine. The baseline is today's editor through
`pnpm bench:canvas`; L is the harness alone, without the editor's own work on its thread. The
iframe harness is the same harness with an iframe per frame, for 50 screens and edits. jarvis no
longer has designs; caedraft took its place. Scripts and results: `/tmp/ed-spike` (not kept).

| Redesign (10 frames, 4,297 nodes) | Today | Iframe harness | L, dev React | L, production React |
|---|---|---|---|---|
| Load, every frame drawn | 1,757 ms | 1,380 ms | 1,083 ms | 739 ms |
| Pan: busy / longest task | 12–14% / 7 ms | | 10% / 10 ms | 9–10% / 11 ms |
| Zoom: busy | 25% | | 9% | 9% |
| Edit (median) | | 31 ms | 32 ms | 14 ms |
| Renderer / all processes | 539 / 780 MB | 258 / 460 MB | 234 / 451 MB | 193 / 409 MB |
| 50 screens: load | | 4,912 ms | 1,772 ms | 1,199 ms |
| 50 screens: zoom busy | | 33% | 35% | 37% |
| 50 screens: renderer | | 487 MB | 315 MB | 246 MB |

| sacro-cuore (12 frames, 440 nodes, 143 instances) | Today | Iframe harness | L, dev React | L, production React |
|---|---|---|---|---|
| Load | 3,085 ms | 2,258 ms | 1,115 ms | 675 ms |
| Pan: busy / longest task | 14% / 3 ms | | 11–12% / 6 ms | 11–13% / 7 ms |
| Zoom: busy | 30–47% | | 14% | 14% |
| Edit (median) | | 30.5 ms | 29.5 ms | 13.8 ms |
| Renderer / all processes | 709 / 957 MB | 471 / 702 MB | 396 / 638 MB | 218 / 460 MB |
| 48 screens: load | | 8,515 ms | 2,357 ms | 1,576 ms |
| 48 screens: renderer | | 963 MB | 463 MB | 255 MB |
| Each screen more | | 13.7 MB | 1.9 MB | about 1 MB |

caedraft (5 frames, about 1,600 nodes) agrees: a load of 628 ms against 1,023, a zoom 7% busy
against 22, 1.7 MB a screen against 6.3. No pan in any run had a frame over 33 ms.

Pictures of the same pages at 100%, iframe against shadow root: Redesign 0% of pixels differ;
sacro-cuore 0.041% at most, none strongly, its 390 px frame included (the breakpoints rewritten to
container queries); caedraft up to 4%, faint only (no channel off by more than 32), once the
structure of R2 is in.

What it found to do, all in this plan: the structure and rewrites of R2 and R5 (without them a
page's background stopped at its content, and 12% of pixels differed for want of the fonts);
one component registry for every frame, drawing modules already loaded without suspending (a
remount with a fresh registry suspended, and React 19 held it back 300 ms); queries in
`renderer-react` and `preview-core` scoped to the frame's root (the instance lookup, the
per-frame `<style>` in `document.head`, skeletons, `elementAt`, `isDismissLayer`'s
`window.innerWidth`); `content-visibility` for parked frames only; portals moved in and back;
Vite's full reload, which fired once while Vite optimised its dependencies on a first open.

Two gates are not settled by the harness. Panning in the real editor adds the frames' painting to
the editor's own work: an estimated 15–17% busy against 0033's 12%, the longest task under
12 ms. And with about 50 frames on screen a zoom is over 27% busy for iframes and L alike, which
the low-zoom bitmaps answer.

## Phases

### Phase 0: spike — done

- [x] 0.1 Today's numbers on this machine (`pnpm bench:canvas`): Redesign, sacro-cuore, caedraft.
- [x] 0.2 A harness drawing pages in shadow roots on the real preview server; dev and production
      React; 10 and 50 screens.
- [x] 0.3 Pictures against the iframe preview; portals; `inert` and hit tests; Vite's client.

### Phase 1: groundwork — done

Built beside the iframes, which keep working until Phase 2 switches the editor over.

- [x] 1.1 The server forwards `/preview/` to the preview's Vite server (`preview-proxy.ts`), the HMR
      socket included; the editor's dev server forwards it to the server. Vite serves under
      `/preview/`, its client is patched (`vite-client.ts`: `__edReload`, `__edStyles`) and its
      error overlay is off.
- [x] 1.2 The generated files and Vite's cache moved out of the designs directory, into
      `~/.cache/ultrapaint/preview/<hash of the designs directory>` (not the anchor's
      `node_modules`: Vite never watches it, and the registry is rewritten while it runs). The old
      `<designs>/.ultrapaint` is removed when its `.gitignore` says it is ours. `hostCss` keeps
      its meaning, relative to where the stylesheet was generated before.
- [x] 1.3 `preview-core/frame.ts`: `createPreview` and `mountFrame(host, options) → FrameRuntime`,
      synchronous, every query on the frame's shadow root, coordinates in the page's pixels
      whatever the zoom. The iframe's `startPreview` stays until Phase 2.
- [x] 1.4 `renderer-react` looks up in the render's own root, shares one set of loaded components
      by registry (no suspension for a module already there), hands its stylesheet to the shared
      sheet, and fills the frame's height (`100cqh`). The `renderInstance` seam waits for Phase 6.
- [x] 1.5 `preview-core/styles.ts` and `frame-css.ts`: the stylesheets Vite's client hands over,
      rewritten (R5) through the browser's own parser, adopted by every frame, font faces and
      registered properties lifted into the document.
- [x] 1.6 Portals (`portals.ts`, by the stack and the frame that last drew or took input);
      React's production build in the preview (`NODE_ENV=production`).
- [x] 1.7 `framework-api/browser` says `Preview`, `FrameRuntime` and `FrameEvents`. The messages
      of `contracts/preview.ts` go with the iframes (4.1).

### Phase 2: the editor draws in its page — done

- [x] 2.1 `frame.tsx` draws a frame's page in a shadow host (`PreviewHost`), from the preview loaded
      once (`preview-module.ts`); nodes placed on the canvas too (`fit`). The editor's own
      shortcuts, its paste and the canvas's wheel leave alone what comes from inside a frame
      (`fromFrame` in `keys.ts`), as they never heard an iframe's.
- [x] 2.2 `FrameBridge` stays the editor's interface to a frame and calls it directly
      (`attachRuntime`): hit tests, measures and tokens answer at once, what the frame says comes
      as the messages it always came as. Pointer, highlights, drag, the create tool and text
      editing are unchanged; the rects are still pushed when they move, which costs nothing now.
      A frame is not told to draw again what it already shows.
- [x] 2.3 `preview-pool.ts` keeps shadow hosts, not iframes: a frame that leaves the screen keeps
      its host where it is, `content-visibility: hidden`, so coming back neither moves it nor
      lays it out again; a canvas switched away from parks its hosts (32 kept). The zoom the
      camera writes (`--inv`) is pinned on each host's holder: a zoom does not style the host
      again, whose `:host` rules carry all the page's tokens. `Origin-Agent-Cluster` goes with
      the iframes (4.1).
- [ ] 2.4 Low-zoom bitmaps: not built. With 50 frames on screen a zoom holds 60 fps (two frames
      in 120 over 33 ms) and costs the frames' own chrome, not their pages; a picture of a page
      costs 0.6 to 2 s of the editor's thread (html-to-image). Measured again when a project needs
      it, or when Chrome draws elements into a canvas (`drawElementImage`).
- [x] 2.5 `pnpm bench:canvas` drives shadow hosts too (`ed:frame` events, `data-ed-drawn`), and says
      when the editor loaded again mid-run.

Measured on this machine, Redesign canvas (10 frames, 4,287 layers), iframes before and the
editor's page after:

| | Iframes (ADR 0033) | Frames in the editor's page |
|---|---|---|
| Load, every frame drawn | 1,757 ms | 402 ms |
| Pan: busy / longest task | 12–14% / 7 ms | 14–16% / 9 ms, nothing blank |
| Zoom: busy / longest task | 25% | 28% / 7 ms, no frame over 33 ms |
| Going to a far page | | 59–96 ms |
| Switching canvas and back | | 27–75 ms, nothing loaded again |
| Renderer / all processes | 539 / 780 MB | 340 / 582 MB |

With 50 frames (the Redesign pages five times) all 50 are drawn in 1.7 s, panning keeps the editor
30% busy and zooming 73%, with no frame over 33 ms while panning and two in 120 while zooming;
the renderer holds 471 MB.

### Phase 3: pictures and the prototype — done

- [x] 3.1 The pictures (the Assets panel's thumbnails, the threads', the toolbar's options and the
      screenshots agents ask for) are drawn in one shadow host nobody sees (`specimens.ts`); the
      type samples and a component's matrix in `PreviewSurface`, a shadow host drawn by the
      preview and spoken to through its bridge.
- [x] 3.2 A picture is html-to-image on the frame's own elements: about 0.3 s for a page of the
      samples. The page PNGs and agents' screenshots go through it.
- [x] 3.3 The prototype is a `PreviewSurface` that takes input: on sacro-cuore its header's menu
      opens (a Base UI popup, moved into the frame, placed under its button) and its links go to
      their pages. No iframe is left in the editor.

### Phase 4: what goes, the desktop app, the records — done

- [x] 4.1 Deleted: the iframe runtime (`startPreview`, the injected `runtime.js`, the `render.js`
      bundle), the generated `index.html` and `main.ts`, `PREVIEW_PROTOCOL`, the bridge's
      `postMessage` transport and router, `usePreviewBridge`, the specimen iframe, the editor's
      messages to the preview (`EditorMessage`), `previewUrl` and `useHostUrl`, and the
      `Origin-Agent-Cluster` header.
- [x] 4.2 The desktop app forwards the server's port only: `Platform.mapPreviewUrl`, the preload's
      synchronous IPC, `forwards.ts` and the forward made again when the preview moves are gone.
- [x] 4.3 ADR 0034 accepted with the measurements; 0011, 0015, 0031 and 0033 amended; the README.

### Phase 5: the designs directory holds data only

- [x] 5.1 Page defaults replace `providers.tsx`, per canvas rather than in `design-system.json`:
      canvases differ (this repository's Redesign is the editor's dark UI), and a project without a
      design system has them too. `canvas.json` says `defaults` (theme, fill, colour, font, size,
      leading), drawn on every frame's body, popups included. This repository's two canvases say
      what its providers did; every page draws as it did, to the pixel. `providersModule` stays
      optional, for React contexts an application needs.
- [ ] 5.2 Icons get a `tint`: drawn as a mask in a token's colour, one file for every colour.
- [ ] 5.3 `design.tokens.json` becomes the only token file: token values move there,
      `design-system.json` keeps the rest; the copy and its baseline go. Its own ADR, amending 0028.

### Phase 6: captures, an experiment

- [ ] 6.1 After an instance draws live, its DOM is serialised, keyed by component and props hash,
      with markers for slots and text props; a `<canvas>` becomes a picture.
- [ ] 6.2 Behind a flag, frames seen for the first time and frames far away draw from captures, and
      go live when selected, edited or on screen for a while.
- [ ] 6.3 Measured: the first draw after a project opens, memory, edits, how many components
      capture well. Then one of: stay on L, keep captures as a cache, or a committed library with
      the canvas drawing captures only (its own ADR).

## Pitfalls

| Pitfall | Answer |
|---|---|
| A document-level hotkey in the application hears the editor's keys | Rare; written down, not handled |
| An infinite loop in a component freezes the editor | The user's own code; an error boundary per frame catches what throws |
| A hook on `matchMedia` or `window` sees the editor's window, not the frame (sacro-cuore's header on scroll) | Accepted; breakpoints in CSS are container queries |
| `BrowserRouter`, `window.location` | `providersModule` uses a memory router |
| Vite's first open optimises its dependencies and asks for a full reload | R9: frames remount, the editor stays |

## Open questions

None for the user now. Measured as the phases go: how many frames stay mounted away from the
screen (2.5), the zoom below which frames are bitmaps (2.4), and whether captures pay (6.3).
