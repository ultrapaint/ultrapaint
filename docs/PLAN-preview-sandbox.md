# Plan: guards around the preview in the editor's page

Status: proposed, 2026-10-26. Follows [ADR 0034](adr/0034-frames-in-the-editors-page.md) and
`docs/PLAN-editor-renderer.md`, whose "Pitfalls" it answers. Nothing is built yet: the open
questions at the end come first.

## Why

Since ADR 0034 the repository's components run in the editor's own page: one realm, one main
thread, one `window`, one `document`, one URL, one storage. The ADR accepted the side effects and
wrote them down without handling them. This plan measures each one on fixtures and on the two real
repositories (this one's Redesign canvas, `~/Code/sacro-cuore`), says which already bite, and
picks the smallest set of changes that keeps the editor and the application from stepping on
each other, without iframes and without slowing down the canvas.

A true sandbox is not on offer in one page. JavaScript on the main thread cannot be preempted,
and a component cannot be kept from reaching `window` through a DOM node
(`el.ownerDocument.defaultView`). Only a separate realm, an iframe, gives a separate `window`, and
only a separate process gives a separate thread. The plan therefore guards: it catches the
collisions that happen through a handful of global entry points, and it makes sure a frozen page
cannot hold the editor hostage twice.

## How it was measured

A fixture host (`/tmp/ed-sandbox`, a copy of the lab's blank host, not kept) whose
`probes.tsx` does what applications do: a document-level hotkey, autofocus, `window` and
`matchMedia` reads, a URL-synced filter (`history.replaceState` on mount), CSS-in-JS and a theme
class on `<html>`, React 19's `<title>` and `<meta>`, console output, errors in render, effects,
timeouts, promises and click handlers, `localStorage`, a module-level store, a scroll lock and
an "unsaved changes" guard, a handler that stops propagation, a relative `fetch`, module-level
listeners and a `fetch` wrapper, a custom element. Four canvases: `collisions` (16 frames, one
probe each), `spin` (a 3 s render), `raf` (10 frames each running a JavaScript animation with
1 ms of work a frame), `calm` (10 frames of text). Driven in headless Chrome through
`window.__ed`; the scripts lived in `/tmp/ed-scripts`. sacro-cuore was opened in the prototype
at the Mobile device. `pnpm bench:canvas` ran on the Redesign canvas.

## Inventory

"Today" says whether it bites in this repository's Redesign canvas or in sacro-cuore as they are;
"Risk" is for any repository.

| # | Collision | Reproduced | Today | Risk |
|---|---|---|---|---|
| 1 | **Keys, editor → app.** A `keydown` listener on `document` or `window` hears every key typed in the editor: its shortcuts, its text fields, its chat. The app's `preventDefault` does not stop the editor (it never looks), so both act: the probe's Ctrl+Z ran the app's own undo beside the editor's | yes | no: neither repository listens on the document | high: command palettes, `useHotkeys`, `/` to search |
| 2 | **Keys, app → editor.** Keys typed in a frame (prototype, interact) reaching the editor's shortcuts | already answered by `fromFrame` and `isTyping` | — | — |
| 3 | **Focus.** In the prototype or interact mode, the app moves focus when it pleases: the probe's `/` hotkey, heard from the editor (1), pulled focus out of the editor into the frame. While designing, `inert` refuses it (autofocus and `focus()` did nothing) | yes | no | medium, mostly through 1 |
| 4 | **`window` size, `matchMedia`, scroll.** Hooks read the editor's window: a 390 px frame read `innerWidth` 1600 and `(max-width: 640px)` false. sacro-cuore's header listens to `window` scroll: scrolling its page 600 px in the prototype left it flat | yes | **yes**, sacro-cuore's header in the prototype | high: shadcn's `useIsMobile`, sticky headers, scroll spies |
| 5 | **`location` and `history`.** The app reads the editor's URL (`/?canvas=…&route=…`), and writes it: the probe's `replaceState` on mount added `&tab=overview` to the editor's address bar. A `popstate` from the editor's own navigation reaches the app's routers | yes | no: sacro-cuore's links work without a router on the canvas | high: React Router's `BrowserRouter`, TanStack Router, `nuqs`, any filter synced to the URL |
| 6 | **`document.head` and the title.** CSS-in-JS rules go to the editor's head: a component's class rule never reaches its frame (the probe's box stayed unstyled) and a global rule hits the editor (`body { outline }` drew on the editor). React 19 hoists `<title>` and `<meta>` into the editor's head; `document.title` renamed the editor's tab | yes | no: both repositories are Tailwind | high for emotion, styled-components, MUI, Chakra; medium for `<title>` |
| 7 | **`<html>` and `<body>` themselves.** A theme provider's class and `color-scheme` land on the editor's `<html>`; a scroll lock's `overflow: hidden` and padding on the editor's body. sacro-cuore's Base UI sheet, opened in the prototype, marked the editor's panels `aria-hidden` and `data-base-ui-inert` while it was open (it put them back on closing; the editor stayed usable) | yes | mild: sacro-cuore's sheet | medium: next-themes, Radix and Base UI modals |
| 8 | **Unsaved-changes guards.** A `beforeunload` listener asked "Leave site?" when the editor reloaded | yes | no | medium: forms with a dirty check |
| 9 | **A heavy render or an infinite loop.** A 3 s render was a 3 s task on the editor's thread, the editor frozen for its length. A loop never returns, and the editor, reopening the same canvas, freezes again every time it loads | yes (3 s, by design not infinite) | no | low frequency, worst outcome |
| 10 | **Animations in JavaScript.** Ten frames each doing 1 ms of work a frame kept the editor 64% busy while idle, and still 61% after switching to another canvas: parked frames keep running their `requestAnimationFrame` loops. The Redesign canvas is 1% busy idle | yes | no | medium: Lottie, canvas heroes, JavaScript carousels |
| 11 | **Errors.** What throws in render or in an effect is caught by the page's boundary and shown on the frame. What throws in a timeout, a promise or a click handler is an uncaught error of the editor's page: nothing on the frame, nothing in the editor, only the console. React's own errors are minified (the preview runs React's production build) | yes | yes, whenever it happens: a click that throws in the prototype does nothing visible | high |
| 12 | **Globals and module-level code.** The app's module code runs once for every frame and is never reloaded: a module-level `window.addEventListener` and a `fetch` wrapper were stacked four deep after three edits of the file (each HMR evaluation adds one); the editor's own `fetch` then goes through all four. `customElements` is one registry for both | yes | no | medium: interceptors, analytics, Sentry, polyfills |
| 13 | **One copy of the app for every frame.** A module-level store (zustand, a query client) is shared: one click on a "cart" button in one frame changed the count in every frame. Iframes kept frames apart | yes | no | medium, and a behaviour change rather than a collision |
| 14 | **Storage.** The app sees and can clear the editor's `localStorage` keys (`ultrapaint:canvas`, panel widths, seen agents); it wrote `theme` into it. IndexedDB, cookies, caches are shared too | yes | no | low |
| 15 | **`fetch`.** A relative URL (`/api/products`) goes to the editor's origin: the editor's dev server answered 404, and in the packaged app it reaches the editor's own server and its `/api` routes. With iframes it reached the preview's Vite, which did not proxy to the app's backend either | yes | no | low |
| 16 | **Console.** The app's logs, warnings and React's errors share the editor's console | yes | yes, noise only: nothing forwards the editor's console anywhere | low |
| 17 | **Two Reacts on one page.** Each root delegates its events on its own container, so the two never dispatch each other's events. The two schedulers each yield every 5 ms and do not fight. The DevTools hook is shared, which is useful (the extension shows both trees); in `pnpm dev` the editor's Fast Refresh wraps the hook and sees the preview's commits, which ignores them (a production renderer has no `scheduleRefresh`). A handler in the app that stops propagation keeps the event from the editor's root and window: harmless today, as the editor ends no gesture on a frame's events | yes | no | low |
| 18 | **CSS crossing the boundary.** `all: initial` on the host resets inherited properties but not custom properties: 43 of the editor's 52 variables on `:root` (`--primary`, `--background`, `--radius`, `--chart-1`…) reach a frame whose app does not define them, so a component missing its own token draws with the editor's dark theme instead of looking broken. Font faces and `@property` rules are lifted into the editor's document, where an app's font named like the editor's would replace it (the editor uses system fonts: no collision today). `rem` is the editor's root size (16 px), so an app that sets `html { font-size: 62.5% }` draws at the wrong size | yes (variables) | yes, the variables | medium |

Also seen: every effect of a frame ran mount, unmount, mount on its first draw (the probe's
`window` listener was added twice at the same millisecond). Not a collision, but it doubles every
side effect above and is worth a look on its own.

## Options

Costs are in code and maintenance; "per call" costs were measured in Chrome: a stack test (who
is calling: a module under `/preview/` or the editor) is 10–13 µs, a `Proxy` read 0.17 µs against
0.08 µs, `composedPath()` 0.36 µs. A stack test is cheap where it is paid rarely (adding a
listener, writing the URL, inserting into the head, a `fetch`) and too dear on hot getters
(`innerWidth` in a layout loop). `portals.ts` already relies on it.

### A. Scoped `window`, `document`, `location` through the Vite transform

Rewrite free references (`window`, `document`, `location`, `history`, `localStorage`,
`matchMedia`, `innerWidth`…) in the preview's modules and pre-bundled dependencies into imports
of proxies, as `@rollup/plugin-inject` does; React, ReactDOM and our bundles left out.

- Effectiveness: partial. It cannot know which frame is asking: the modules are shared by every
  frame, and async work (effects, timers, listeners) carries no context (no `AsyncContext` in
  browsers). Libraries that reach `window` through a node (`ownerDocument.defaultView`: Floating
  UI, Base UI, Radix) bypass it. Identity checks (`window === window.top`, `instanceof Window`,
  `event.view === window`) break or need care.
- Cost: high. A scope-aware rewrite on every module and in dependency optimisation, a long tail
  of semantics, and transform time on every start.
- Performance: transform time at start; 2× on every proxied read.
- Verdict: not now. Revisit only if repositories need per-frame `innerWidth` and `matchMedia` on
  the design canvas.

### B. ShadowRealm, Workers, worker-DOM

ShadowRealm is not shipped by any browser and has no DOM by design. A Worker has no DOM; mirroring
one (worker-dom, Partytown) cannot answer the synchronous layout reads components make. Not
viable.

### C. Guards on the few global entry points, by the caller's stack

The `portals.ts` pattern, extended: a `sandbox.ts` in `preview-core` patches a handful of entry
points once, and treats a call from the preview's modules differently from the editor's.

- **Listeners on `window` and `document`** (`addEventListener`, `on*` setters): a listener the
  preview adds is wrapped. Keyboard, pointer, focus and clipboard events reach it only when they
  come from inside a frame (`composedPath()` holds a frame host); `beforeunload`, `unload`,
  `popstate` and `hashchange` never do; `scroll` is bridged from the interactive frame (below).
  Answers 1, 3 (via 1), 5 (`popstate`), 8, and gives each listener its frame.
  Cost: low. Per call: one stack test when a listener is added, one `composedPath()` per event it
  is offered; nothing on the editor's own events.
- **Scroll in the prototype**: the interactive frame's host scrolling dispatches `scroll` to the
  preview's window listeners, and while they run `scrollY`, `pageYOffset` and `scrollX` answer the
  frame's scroll. No stack test on the getter: the flag is set only during the bridged dispatch.
  Answers sacro-cuore's header (4). Cost: low.
- **`history.pushState` and `replaceState`**: from the preview, the editor's URL is left alone; a
  push to a route of the canvas becomes the prototype's navigation (`events.navigateTo`). Answers
  the writing half of 5. Reading `location` cannot be patched (`location` is unforgeable): a router
  still reads the editor's URL, so the answer for reading stays `MemoryRouter` in
  `providersModule`, as the pitfall says.
- **`document.head` and the title**: what the preview inserts into the head is kept out of it:
  `<title>`, `<meta>`, icons in a holder that is not in the document; `document.title` set from the
  preview is ignored. `<style>` written by CSS-in-JS goes into a hidden shadow root (so its sheet
  exists for `insertRule`) and its rules are mirrored into the frames' shared sheet, rewritten by
  `frameCss`, as `__edStyles` does for Vite's. Answers 6. Cost: low for the head and the title;
  medium for CSS-in-JS (patching `CSSStyleSheet.prototype.insertRule` for the held sheets, batched
  per microtask).
- **`<html>` and `<body>` attributes and styles** (theme classes, scroll locks): the same test on
  `classList`, `setAttribute` and the `style` of the two elements, writing to the frames' host and
  body instead. Answers 7. Cost: medium, a long tail (`dataset`, `cssText`, `setProperty`).
- **`localStorage`, `sessionStorage`** answered to the preview through a prefix
  (`ultrapaint:preview:`); **relative `fetch` and `XMLHttpRequest`** rebased on `/preview/`, which
  could then inherit the anchor's `server.proxy` and reach the app's backend. Answer 14 and 15.
  Cost: low each.
- **HMR leftovers**: the listener guard knows each listener's module URL, which Vite versions
  (`?t=`); listeners from a module's older evaluation are removed when it updates. Answers 12 for
  listeners only. Cost: low on top of the listener guard.

What C does not do: per-frame `innerWidth` and `matchMedia` on the design canvas, `location`
reads, globals the app overwrites (`window.fetch`, `console`), the shared module state (13).
Performance: nothing on the canvas's draw, pan and zoom paths.

### D. Errors

- `error` and `unhandledrejection` listeners in `preview-core`: an error whose stack holds the
  preview's base belongs to the preview; it is told to the frame that last drew or took input
  (exact for a click handler, close for a timer), through the frame's existing `error` event,
  which the editor already shows on the frame (`setHostError`). Answers 11.
- `createRoot`'s `onUncaughtError` and `onRecoverableError` per frame, for what React reports
  outside the boundary.
- React's minified messages: the editor links to React's decoder (the message carries the URL).
- Cost: low. Performance: nothing until something throws.

### E. A heavy render, a loop

- **Time-slicing the first draw** (`startTransition` as later draws already are): React yields
  every 5 ms between components, so a heavy page no longer holds the editor for its whole draw.
  It cannot slice one component's own work or a loop. Cost: one line; to be measured on load,
  where it can delay the first picture.
- **A watchdog in a Worker**: the editor's thread posts a heartbeat every 250 ms and tells the
  worker which frame it starts to draw. The worker cannot stop the loop, but it sees the silence,
  and after 3 s writes to IndexedDB which page was drawing. On the next load that page is not
  drawn: the frame says the page froze the editor last time, with "Draw anyway". This breaks the
  freeze-reload-freeze loop, which is the only part that is truly unrecoverable today. Cost: low
  (a small worker, one IndexedDB record). Performance: a message every 250 ms.
- **In the desktop app**, Electron's `unresponsive` event can offer to reload the window, which
  the watchdog's record then opens without the page. Cost: low.
- **Long draws shown**: a frame that took over 200 ms to draw says so. Cost: low; optional.

### F. Animations in parked frames (10)

Wrap `requestAnimationFrame` for preview callers (one stack test per call: about 0.6 ms a second
for ten 60 fps loops) and hold their callbacks while no frame is interactive, or run them at a low
rate while designing. Cost: low to medium; it changes how the canvas looks (animations frozen or
slow), which is a product choice. Not biting today (1% idle on Redesign).

### G. CSS crossing the boundary (18)

Reset the editor's custom properties at `:host` in the base sheet: the list read once from the
editor's `:root` and `.dark` rules, each set to `initial`, before the app's sheet, which defines
its own over them. Cost: very low; `:host` already carries the page's tokens and the zoom does not
restyle it. `rem` and font-face names are left as they are until a repository needs them.

### H. The narrow escape hatch: one frame in an iframe

For a page known to misbehave (the watchdog's record, or a flag in `canvas.json`):

- **Same-origin iframe**, loading its own copy of the generated entry (a `frame.html` under
  `/preview/`), the editor calling its `preview.mountFrame` directly: same thread, so
  synchronous calls still work. Isolates `window`, `document`, `location`, `history`, head,
  listeners and module state; does **not** isolate a loop (same thread) or storage (same origin).
  Cost: medium (a second boot path, offsets for hit tests and pictures); 0.3–2.7 s to boot and
  6–14 MB for that frame, as before ADR 0034.
- **Cross-site iframe** (another host name for the loopback, `localhost` against `127.0.0.1`, which
  Chrome puts in another process): the only way to isolate a loop. It needs the asynchronous
  `postMessage` bridge back, which ADR 0034 deleted, and a host name that survives SSH and the
  desktop app. Cost: high.
- Verdict: not built. The same-origin one is the fallback if C misses something that matters on
  a real page; the cross-site one only if loops turn out to be common, which nothing suggests.

### Not handled, by choice

- **One copy of the app for every frame (13).** Inherent to ADR 0034's gain; only H separates
  frames. Written down in the ADR as a behaviour.
- **Globals the app overwrites** (`window.fetch`, `console`, `WebSocket`, Sentry's
  instrumentation): freezing them would break the apps that do it; their effect on the editor is
  small. Written down.
- **`console` (16)**: noise in the editor's console only. Tagging by stack would cost a test per
  log line.
- **Base UI and Radix marking the editor `aria-hidden` (7)**: assistive technology only, while a
  modal is open in the prototype, undone on close.

## Recommendation

The smallest set that covers what bites today (sacro-cuore's header, invisible errors, the
editor's variables in frames) and the high risks that cost little (keys, the URL, the head and
title, unsaved-changes prompts, a frozen page reopening forever):

| Step | What | Answers | Cost | Canvas cost |
|---|---|---|---|---|
| 1 | `preview-core/sandbox.ts`: the stack test shared with `portals.ts`; listener guard on `window` and `document`; scroll bridged in the prototype; `history` writes; head insertions and `document.title` | 1, 3, 4 (prototype), 5 (writes), 6 (title, meta), 8 | low | none: registration-time only |
| 2 | Errors: `error` and `unhandledrejection` attributed by stack to the frame, root error callbacks, React's decoder link | 11 | low | none |
| 3 | Editor variables reset at `:host` | 18 | very low | none expected; bench |
| 4 | Watchdog Worker and the page that froze drawn as a placeholder; the desktop app's `unresponsive` | 9 | low | a message every 250 ms |
| 5 | The fixture host as a test: Playwright against `pnpm dev`, one assertion per probe | regression | low | — |

Next, only when a repository needs them: CSS-in-JS mirroring (6, styles), `<html>`/`<body>` writes
(7), HMR leftovers (12), storage and `fetch` (14, 15), parked animations (F), first-draw slicing
(E, measured first), per-frame `matchMedia` on the canvas (A).

Each step is gated on `pnpm bench:canvas` against this baseline, taken on 2026-10-26 before any
change (Redesign, 10 frames, 4,287 layers):

| | ADR 0034 | Today, before changes |
|---|---|---|
| Load, every frame drawn | 402–418 ms | 362 ms |
| Pan: busy / longest task | 14–16% / 9 ms | 16–18% / 9–10 ms, nothing blank |
| Zoom: busy | 28–29% | 35%, no frame over 33 ms |
| Switching canvas and back | 27–75 ms | 24–66 ms |
| Renderer / all processes | 340–454 / 582–692 MB | 446 / 639 MB |

Zoom is busier than the ADR measured, before any of this plan; the cause is not known (the
shell's cards landed since, and one run is noisy). Today's numbers are the ones to compare
against, not the ADR's.

## Open questions

1. Is the recommended set the right scope, or should CSS-in-JS mirroring and `<html>`/`<body>`
   writes come in now rather than when a repository needs them?
2. A page that froze the editor: drawn as a placeholder with "Draw anyway" on the next load, and
   in the desktop app an offer to reload when the window stops responding. Agreed?
3. Shared module state between frames (a cart in one frame is the cart in all): accepted as how
   the canvas works now, written into the ADR?
4. The iframe escape hatch stays unbuilt, a documented last resort?
5. JavaScript animations while designing (F): leave them running, or slow or hold them when no
   frame is interactive?
6. The fixture host: committed as an end-to-end test fixture in this repository (with its own
   small `package.json`), or kept in `~/Code/ultrapaint-lab`?
