# Plan: guards around the preview in the editor's page

Status: built, 2026-10-27: the first round (steps 1 to 6, under "Built") and the second (steps 7 to
17, at the end; the desktop app names the line a stuck page was on since step 17). Follows
[ADR 0034](adr/0034-frames-in-the-editors-page.md) and `docs/PLAN-editor-renderer.md`, whose
"Pitfalls" it answers. The answers to its questions are under "Decisions".

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
| 4 | **`window` size, `matchMedia`, scroll.** Hooks read the editor's window: a 390 px frame read `innerWidth` 1600 and `(max-width: 640px)` false. sacro-cuore's header listens to `window` scroll: scrolling its page 600 px in the prototype left it flat. Since this was measured, ADR 0036 answers `matchMedia`, `innerWidth` and `innerHeight` for the frame that asks (`preview-core/media.ts`); scroll is left | yes | **yes**, sacro-cuore's header in the prototype | high: shadcn's `useIsMobile`, sticky headers, scroll spies |
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
- Verdict: not now. Per-frame `innerWidth` and `matchMedia` came another way, by the caller's
  stack and the frame drawing (`media.ts`, ADR 0036).

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
for ten 60 fps loops) and hold the callbacks of a frame that is parked or off the screen until it
is shown again; frames on the screen animate as they do. A loop is the frame's that was drawing
when it asked (the frame `media.ts` already knows), and a callback asked for from inside one of
its own callbacks stays that frame's. Cost: low to medium. Not biting today (1% idle on Redesign),
but chosen: a parked frame costs nothing.

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
| 5 | Animation frames held while their frame is parked or off the screen | 10 | low | one stack test per animation frame asked for |
| 6 | The fixture host in this repository as an end-to-end test: Playwright against `pnpm dev`, one assertion per probe | regression | low | — |

Next, only when a repository needs them: CSS-in-JS mirroring (6, styles), `<html>`/`<body>` writes
(7), HMR leftovers (12), storage and `fetch` (14, 15), first-draw slicing (E, measured first).

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

## Built

2026-10-27, one commit a step. `pnpm e2e:sandbox` checks all of it against `fixtures/sandbox-host`.

- [x] 1. `preview-core/sandbox.ts`, installed by `createPreview`, each frame guarded by
      `mountFrame`. A listener the preview's code puts on `window` or `document` for input hears
      its own frame's events only (`composedPath()`, the frame that was drawing when it was added);
      `beforeunload`, `unload`, `popstate`, `hashchange` are dropped, `on*` setters of them too;
      `scroll` and `resize` are told from the frame's host, `scrollY` answering the frame while
      they run. `history.pushState` of a path in a frame that takes input is the prototype's
      navigation, any other write is dropped; `scrollTo` scrolls a frame that takes input.
      `<title>`, `<meta>`, `<base>` and icon links go to a head outside the document;
      `document.title` set by the preview is ignored. sacro-cuore's header rises as its page
      scrolls in the prototype.
- [x] 2. `error` and `unhandledrejection` thrown in the preview's modules (`thrownInPreview`: the
      stack's first frame under the base) are told to the frame, shown on the canvas's banner and
      on a new one in the prototype; `onUncaughtError` on each root. React's decoder link was not
      needed: its messages carry the URL. A rejection carries nothing of where it came from: it
      goes to the frame running when it surfaces, which may be another.
- [x] 3. The editor's custom properties, read once off its `<html>` and `<body>`, are set to
      `initial` in the frames' first layer. Redesign and the fixture draw as they did (under
      0.005% of pixels, anti-aliasing).
- [x] 4. `canvas/watchdog.ts` and its worker; `Preview.onRunning` says whose page code runs (the
      frame drawing, or taking input, at most every 200 ms). Silence over 3 s while a frame's code
      ran writes the frame to IndexedDB; the editor reads it before the preview loads and draws a
      placeholder ("Draw anyway"); pictures wait for the next load. A page that was only slow is
      struck off when the beat comes back. The desktop app asks to reload on `unresponsive`.
- [x] 5. `requestAnimationFrame` asked for by the preview's code (its immediate caller read off one
      stack frame, once per callback) is its frame's and held while the frame is not intersecting
      the screen (parked or off it); pictures never are. `setTimeout` and `setInterval` run as
      their frame's, and a marker before every instance makes its effects its frame's: a timer's
      error lands on its own frame. Ten animating frames: 64% busy on screen as before, 0% parked
      (61% before), resumed when seen.
- [x] 6. `fixtures/sandbox-host` (a workspace package, React and Vite at `apps/web`'s versions) and
      `pnpm e2e:sandbox`: twelve checks, an editor of its own on free ports, stopped through the
      handle that started it.

Measured against the commit before step 1, alternately on the same machine (Redesign, 10
frames), with `pnpm bench:canvas`:

| | Before (3db4bc0) | After |
|---|---|---|
| Load, every frame drawn | 352–376 ms | 349 ms |
| Pan after load: busy | 16–17% | 17–19% |
| Pan as frames draw: busy / script | 26–27% / 168–180 ms | 26–27% / 186–188 ms |
| Zoom: busy | 34–36% | 34–35% |
| Switching canvas and back | 39–151 ms | 41–155 ms |
| Renderer / all processes | 418–423 / 681–688 MB | 418–419 / 684–685 MB |

Reading the whole stack on every timer and animation frame the editor asked for cost 25 µs a call
and 2 points of busy time while frames drew; one frame of stack, once per callback, took it back.

## Decisions

Answered 2026-10-27.

| # | Question | Answer |
|---|---|---|
| S1 | Scope of the first round | The recommended set, steps 1 to 6. CSS-in-JS mirroring and `<html>`/`<body>` writes wait for a repository that needs them |
| S2 | A page that froze the editor | Drawn as a placeholder with "Draw anyway" on the next load; the desktop app offers to reload a window that stopped responding |
| S3 | One copy of the app for every frame | Accepted, written into ADR 0034 as how the canvas works |
| S4 | The iframe escape hatch | Not built; the documented last resort |
| S5 | JavaScript animations | Held while their frame is parked or off the screen (step 5) |
| S6 | The fixture host | In this repository, as an end-to-end test against `pnpm dev` (step 6) |

## Second round: what the first left

Investigated 2026-10-27, after steps 1 to 6. What is left, per collision of the inventory, with
what was measured for it. The experiments ran in headless Chrome against small pages, not the
editor; the numbers that matter for the canvas are to be taken with `pnpm bench:canvas` when a
step is built.

### What was measured

- **Breaking a loop from outside the page.** Through the DevTools protocol, on a page stuck in
  `while (true)`: `Debugger.pause` stopped it in 2–5 ms and named the function and line
  (`stuck:4`, `go:3`); `Runtime.terminateExecution` ended it in 2 ms, and an endless chain of
  microtasks in 16 ms. The page went on (its timers ticked, `evaluate` answered), but the `finally`
  around the loop never ran: whatever the stack held half done (React's work loop, the guards'
  `runAs`) stays half done. Electron reaches the same protocol through `webContents.debugger`.
- **A check inside the application's loops.** A call at the start of every loop body that, every
  1024 iterations, compares the time with the last beat of the page and throws once the thread has
  been busy 2.5 s: it stopped the benchmark meant to measure it, which ran past that. Its cost is
  about 5 ns an iteration (3·10⁷ empty iterations: 27 ms, 200 ms with the check; a component's
  loop over 1,000 rows: 5 µs more). It needs the application's modules transformed; Vite gives
  every plugin a parser (`this.parse`, from Vite 5's Rollup to Vite 8's Rolldown), and the
  preview's server may run the repository's own Vite.
- **What a rejection carries.** Four kinds (an `async` function that throws after an `await`, a
  failed `fetch`, `JSON.parse` after an `await`, a `.then` chain that throws) all had the
  application's file and line on their stack (`at Module.load (…/src/api.js:2:87)`), even the
  failed `fetch`. The file is known; the frame is not, since every frame runs the same modules.
- **sacro-cuore today.** `photo-picker.tsx` posts to `/modifica/foto`: a relative URL, which in
  the editor reaches the editor's server (a 404, and in the packaged app its own routes). Its
  toaster reads `next-themes`. No storage, no CSS-in-JS, no writes to `<html>` or `<body>`.

### Options

| # | What | Answers | Cost | Canvas cost |
|---|---|---|---|---|
| L1 | **Loop check.** The preview's server transforms the repository's own modules (not `node_modules`), only those with a loop in them: every `for`, `while` and `do` body starts with the check. A loop that holds the editor's thread 2.5 s throws "Stopped a loop at src/x.tsx:42 that held the editor 2.5 s", which shows on its frame as any error does. No freeze past 2.5 s, no reload, on the web and the desktop. Misses loops inside dependencies, React's own endless work (a component that renders itself) and chains of microtasks without a loop | 9 | medium | one parse per module with a loop; ~5 ns an iteration; load to be measured |
| L2 | **Desktop: end what L1 misses.** The main process hears a beat over IPC; after 3 s of silence it pauses the page (the line it is stuck on), ends the script and reloads, the frame written down as step 4 does, the placeholder naming the line. Replaces the "not responding" dialog, which waits Chrome's 15 s or more and asks. Reloads rather than going on, as nothing in a half-finished draw can be trusted | 9 | low–medium | none |
| R1 | **A rejection's frame, taken when the promise is made.** A promise made while a frame's code runs (`then`, `catch`, `finally`, `fetch`) is noted as that frame's: no stack test, only when a frame is known to be running. An `async` function of the repository's (L1's transform) notes its frame on entry and marks what it throws with it. `unhandledrejection` asks the promise, then the reason. When neither knows, the canvas names the file and line, not a frame it would have to guess | 11 | medium, with L1; high without | a weak-map entry per promise made by a frame's code |
| F1 | **Relative URLs.** A relative URL asked for by the preview's code (`fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`) goes under the preview's base, never to the editor's own routes; the preview's server inherits the repository's `server.proxy` (moved under the base), so a backend that runs answers as in `vite dev` | 15 | low–medium | none |
| S1 | **Storage.** `localStorage` and `sessionStorage` asked for by the preview's code are a stand-in, shared by the frames as the modules are; IndexedDB names are prefixed. Either kept in memory, empty at every load (a canvas draws the same each time: a stored "theme" or "onboarded" does not drift it), or kept per project under a prefix (a prototype remembers, as a browser would) | 14 | low | none: one stack test per `localStorage` read |
| H1 | **`<html>` and `<body>`.** On those two elements themselves, not their prototypes: `classList`, `className`, `style`, `dataset` and the attribute methods called by the preview's code act on the frame's host and the frame's body element, which its stylesheet already maps `html` and `body` to (`html.dark` is said of the host). A theme provider's class and a modal's scroll lock land on their own frame. `prefers-color-scheme` is answered per frame from the frame's theme (`media.ts`), so `next-themes` picks the theme the editor shows | 7 | low–medium | a stack test on those calls only; the editor's own (a drag's cursor) pay it too |
| C1 | **CSS-in-JS.** A `<style>` the preview's code puts in the head goes into a hidden shadow root (it gets a `sheet`, and styles nothing there); its rules, as text and as `insertRule` (emotion and styled-components insert rules, not text, in production), are rewritten as the page's stylesheets are and kept in one sheet every frame adopts. Global rules (`body { margin: 0 }`) reach the frames' bodies, not the editor's | 6 | medium | a rewrite per rule inserted |
| K1 | **HMR leftovers.** Listeners and intervals added by a module's top-level code (the stack frame already read) are removed when Vite replaces that module. A wrapper around a global (`fetch`) is not undone | 12 | low | none |

Not proposed: anything that runs the application off the editor's thread (the cross-site iframe,
H above) while L1 and L2 cover the freezes it would; per-frame copies of the modules (S3 stands).

### Recommendation

L1 with R1 (one transform, two answers), then F1, S1, H1, and L2 for the desktop app. C1 and K1
wait for a repository that needs them, as S1 decided; C1 first when one uses emotion or
styled-components. Each step is benched against the commit before it, alternating runs, as in
the first round. The fixture gets a probe and a check per step: an endless loop in a render and
in a click, a rejected `fetch` in two frames, a relative `fetch`, a stored key, a theme class and
a scroll lock.

### Decisions

Answered 2026-10-27.

| # | Question | Answer |
|---|---|---|
| S7 | Scope of the second round | The recommendation: L1 with R1, F1, S1, H1, L2. C1 and K1 wait for a repository that needs them |
| S8 | The application's storage | In memory, empty at every load, shared by the frames |
| S9 | A stuck page in the desktop app | Paused for its line, ended, and the window reloaded with the frame as a placeholder naming the line; no dialog. Built without the line (step 11): reading it costs every session the debugger. The line came with step 17, at no cost |
| S10 | Relative URLs | Under the preview's base, with the repository's `server.proxy` moved under it |

### Built (second round)

2026-10-27, one commit a step, each benched against the commit before it, alternately.
`pnpm e2e:sandbox` checks 23 things now.

CSS-in-JS (C1) and HMR leftovers (K1), which S7 left, were asked for after (steps 12 and 14), as
was the line a stuck page was on in the desktop app, which step 11 left (step 17).

- [x] 7. L1 and R1: `framework-react-vite/guard-code.ts`, a plugin of the preview's server after
      every other, on the repository's modules with a loop or `async` in them (`this.parse`, so
      any Vite from 5 on). A loop held 2.5 s throws `LoopError` where it runs: in a render the
      page's own boundary draws it, in a click it is shown on the frame; the editor answered
      again 2.5 s after the click. An `async` function marks what it rejects with the frame it was
      called for; a `.then` chain carries no mark and, with more than one frame drawn, is a toast
      of the editor's, not shown on a frame. `Promise.prototype.then` is left alone: patching it
      would touch every promise the editor makes, and V8's own fast paths with them. The freeze
      fixture spins without a loop of its own now (`Array.prototype.find` over a long array-like,
      as a dependency's work would), which the check does not see and the watchdog still does.
      Redesign, before / after: load 371–403 / 366–384 ms, pan 17–19 / 16–18% busy, zoom 34–37 /
      34–37%, renderer 420–423 / 420–421 MB. sacro-cuore draws its four frames, no error.
- [x] 7b. What a frame is told of an error names the source's line: a stack's lines are the
      module's as the server sent it, after the React plugin and TypeScript (the loop in a click
      was said to be at line 177, a `throw` 18 lines further down the source). The
      module's inline source map, read once when something throws (`source-lines.ts`), takes it
      back. Wrong since step 2; found by step 7's checks, which now say the line.
- [x] 8. F1: `preview-core/requests.ts`. A request the preview's code makes to the editor's
      origin (`fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`, `sendBeacon`) goes under the
      base, and the preview's server takes the repository's `server.proxy` over with its keys under
      the base and the base taken off again (`framework-react-vite/proxy.ts`). Whose request it is
      is read off the whole stack, not its immediate caller: an application that wraps `fetch`
      (logging, Sentry) is called by the editor too, whose requests must stay the editor's. A
      request made where the editor's code is lower on the stack (a fetch in a render the editor
      runs synchronously) is left to the editor's origin, as before. The fixture's `/api/health`,
      which the editor's own server has a route for, now reaches the fixture's backend. Not
      benched: nothing on the canvas's way calls these.
- [x] 9. S1: `preview-core/storage.ts`. `localStorage` and `sessionStorage` asked for by the
      preview's code (its immediate caller, a dependency of the application included) are a
      `Storage` in memory, one of each for every frame, empty at every load; its keys read and
      written as properties too, and `instanceof Storage` holds. IndexedDB databases it opens
      are named under a prefix new at every load, the last loads' deleted, and it lists only its
      own. `storage` events, which tell of the editor's keys, are not heard. The fixture's
      probe finds no editor key and no `ultrapaint-watchdog`, and its `theme` never reaches
      the editor's storage.
- [x] 10. H1: `preview-core/document-elements.ts`, on the document's `<html>` and `<body>`
      themselves. Classes and attributes the preview's code writes to `<html>` go to the frame's
      host and its body element (`html.dark` is `:host(.dark)`; `.dark { … }` and `.dark *` match
      only inside), its `style` to the host, which is what scrolls; `<body>` is the body element.
      The host is the editor's element: the page adds and removes only its own classes there, and
      its whole style written at once is dropped. The frame's body defaults (theme class, style)
      now replace only what the editor put there, so a scroll lock survives a redraw.
      `prefers-color-scheme` answers the frame's theme when it is light or dark (`media.ts`). With
      the browser preferring dark, the fixture's light frame reads light, its class and scroll
      lock are on its frame, and the editor's `<html>` and `<body>` are as they were.
      Redesign, steps 8 to 10 against the commit before them, alternately: load 334–421 /
      385–417 ms (and 350–414 / 403–733 in five more), pan 16–19 / 15–20%, zoom 35–36 / 33–35%,
      renderer 418–423 / 420–422 MB. Switching back to Redesign spiked to 122–158 ms in some runs
      of both.
- [x] 11. L2, not as decided (S9): the window does not name the line. Reading it means pausing
      the page through the debugger, and `Debugger.enable` waits for a stuck thread (5 s of a
      6 s loop, measured), so the debugger would have to be on from the start: the canvas then
      loaded 385–476 ms against 334–404, the renderer held 480–494 MB against 397–422, and 570
      scripts' source maps (27.6 MB) went to the main process. Ending only the script did not do
      either: the page, let go on, beat again before it was loaded again, and the watchdog struck
      its frame off as only slow; and a session attached once the thread is stuck waits for it.
      What is built: the preload script beats every 250 ms; a page silent for 4 s that does not
      answer a script either (a hidden window's timers are slowed, not its scripts) has its process
      ended and is loaded again once it is gone; no dialog, Chrome's own hang event doing the same
      if it comes first. Checked in the app itself, hidden (`ULTRAPAINT_DESKTOP_HIDDEN`), on the
      fixture's freeze canvas: the page's process ended 6 s into its 8 s spin, the window loaded
      again, the frame a placeholder, nothing drawn.
- [x] 12. C1, asked for after the second round: `preview-core/css-in-js.ts`. A `<style>` the
      preview's code puts in the head (by `appendChild`, `insertBefore`, `append`, `prepend`;
      `removeChild` from the head finds it where it went) is held in a hidden shadow root of its
      own, where it has a `sheet` and styles nothing. What it holds, as text (seen by a mutation
      observer) or rule by rule (`insertRule` and `deleteRule`, which no observer sees, so the
      sheets' own methods say so), is written again as the page's stylesheets are, each rule
      once, into one sheet every frame adopts after the application's own, at most once a task.
      Real emotion (11.14) and styled-components (6.6), in a copy of the fixture under `/tmp` not
      kept: both wrote rule by rule, as in production; their boxes drew in their frames, a width
      query became the frame's, styled-components' global `body` outlined the frame's body and
      emotion's `<Global>` on `html` reached the host, the editor's head and body untouched. The
      fixture's probe does what they do without the dependencies, and the fixture has StyleX
      (0.19, its Babel plugin injecting at run time as it does while developing, on one file):
      its rules reach the frame, its width query the frame's. StyleX's extracted CSS (its build,
      its Vite plugin) is a stylesheet Vite loads, as the application's own. `<link
      rel="stylesheet">` the page's code adds is left to the editor's head: another site's sheet
      cannot be read. Redesign holds no such style; against the commit before, on the one pair of
      runs on a quiet machine: load 392 / 391 ms, pan 17–19 / 17–19%, zoom 36 / 38%; the other
      pairs ran while another thread's tests loaded the machine (load average 8), both sides
      swinging (zoom 39–55%).
- [x] 13. Step 8's requests, ruled by where the editor's code hands over rather than whether it is
      on the stack at all (`previewCallOn`): below the preview's caller, the first code that is
      not the preview's is the editor's bundle in the preview (the editor handing it a frame to
      draw, a timer, an event) or nothing: the preview's request; the editor's own code instead
      (it called an application's wrapper of `fetch`): the editor's. No draw is synchronous today
      (no `flushSync`), so no request of the page's had the editor below it yet; a fixture probe
      fetching in its render passed under both rules and was not kept. Unit-tested.

- [x] 14. K1: `preview-core/hmr-leftovers.ts`. The preview's server marks where each of the
      repository's modules starts and ends its top-level code (the guard transform, now on every
      module of the repository, parsing only those with a loop or `async`). A listener added to
      `window` or `document` and an interval started while it runs are that version of the
      module's; when Vite runs a newer one (`?t=`), the older versions' are taken off first.
      What effects add is React's to take back and is left alone, as is what a dependency sets
      up lazily for everyone. The fixture's module that listens and ticks at its top level, edited
      twice: one listener and one interval left (heard once, 10 ticks a second); without, three
      of each (3, 30).
- [x] 15. The loop check in dependencies too: what the preview serves from `node_modules` and
      what Vite prebundled (into its cache, which lies in the generated directory the guard
      skipped), not Vite's client nor our bundles; loops only, no marks, no module markers.
      React's module holds 282 checks. A dependency's loop never throws at once after a stop, as
      the repository's do: React runs its work loop again to draw the error's boundary, for every
      frame drawn in that task, and the first try left them all empty, the error told to another
      frame. A component that renders itself without end (React's own work loop) is stopped at
      2.5 s and drawn by the page's boundary, the other frames as they were; before, the editor
      never came back. What still stops the editor in the browser: an endless chain of promises
      with no loop, and the browser's own code spinning (the freeze fixture's
      `Array.prototype.find`), which the watchdog answers on the next load.
- [x] 16. A `<link rel="stylesheet">` the preview's code adds to the head is held as a `<style>`
      is (step 12) and its rules mirrored once it has loaded; another site's, whose rules the page
      may not read, is fetched (CORS) and written from its text, and left to the editor's head as
      before when its site does not allow that. Relative URLs in either (a font, an image) are made
      absolute against the stylesheet's address: the frames' sheet is not where it was. React
      19's own `<link precedence>` already goes into the frame's shadow root and is not concerned.
      The fixture links its own stylesheet (orange, an image beside it) and the e2e backend's
      (another origin, purple): both drawn in the frame, nothing in the editor's head. The check
      of a rejection's toast now writes toasts down as they show: the loops canvas holds the page
      longer than a toast lasts since step 15.

Steps 12 to 16 against the commit before them (97cc58c), alternately, on a machine at rest
(Redesign, 10 frames): load 374–432 / 374–478 ms, pan 18–21 / 16–21%, zoom 37–38 / 36–42%,
switching back 31–45 ms (one 132) / 32–47 ms, renderer 371–382 / 368–372 MB. Step 12's zoom of
40–44% was the machine's load, as its quiet pair said.

- [x] 17. The desktop app names where a stuck page was (`apps/desktop/src/stopped-at.ts`), without
      the debugger step 11 measured: Chrome reads the stack of the script that holds a page's
      thread for its crash reports' proposed API (`collectJavaScriptCallStack`, behind the
      feature `DocumentPolicyIncludeJSCallStacksInCrashReports`), for a page that opts in with
      `Document-Policy: include-js-call-stacks-in-crash-reports`, which the app adds to the
      editor's page. Nothing runs until the page is stuck; then it took 3 to 4 ms. The stack's
      first module the preview's server marks as the repository's (`__edModuleStarts`, step 14)
      is read again and its inline map followed back to the source (`source-lines.ts`). The page
      loaded again asks for it once: the stack goes to its console, the line onto the frame
      written down just before (within 10 s), kept with it for later loads, and shown on its
      placeholder. On the fixture's freeze canvas, hidden: "Stuck at
      src/components/probes.tsx:28", 5 s after the canvas opened. The spin is the callback on
      line 29: V8 stops a script where a function starts or a loop goes round, and the module's
      map has no point for the start of an arrow function, so the line can be the one before when
      a callback begins its own line, as DevTools would say too. The editor's own code, or a
      dependency's alone, names no line; the stack is still in the console.
