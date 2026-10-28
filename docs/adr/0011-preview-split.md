# ADR 0011: Editor, preview core, renderer and framework

Status: accepted, 2026-09-17. Supersedes 0001 and 0006; builds on 0002, 0003 and 0007.

> Amended by [0037](0037-deep-modules.md), 2026-10-28 (`docs/PLAN-architecture.md`, step 13). The seams stay, each with its one
> adapter (one framework, one renderer, one style system), as decided. The renderer's interface
> describes one host, the editor's page: `RenderSetup` gives the design's stylesheet to the core
> (`setDesignCss`), says when the frame draws and how high a page is at least (its frame's), and
> no renderer puts a sheet in the document's head. The entry of the module the editor's page
> loads is preview-core's (`editor.ts`), which takes a `RenderToCanvas`; the framework's build
> gives it its renderer, so the renderer depends on `framework-api`'s interface and not on the
> core, as Storybook's does.

> Amended by [0034](0034-frames-in-the-editors-page.md), 2026-10-26. The split stands; the iframe
> goes. The preview core and the renderer run in the editor's own page, loaded once from the
> preview's server through the editor's server (`/preview/`), and draw every frame in a shadow
> root; the editor calls them directly instead of posting messages.

> Amended by [0015](0015-design-documents.md), 2026-09-25. The split stands; what crosses it
> changed. The preview no longer renders a page module and walks its fibers: the editor sends it
> a design document, the renderer draws it with the repository's components (imported through a
> generated registry), and hit-testing reads the node ids on the DOM. A framework package now
> gives the design system scan, the catalogue and the preview server; it no longer stamps or
> edits source.

## Context

React, JSX and Vite were wired through the server and the iframe runtime: the generated entry
called `createRoot`, the runtime walked fibers, the server edited JSX and catalogued TypeScript
props. Storybook separates the same concerns: a prebuilt manager that never loads user code, a
preview built by the user's bundler with the user's framework copy, a framework-neutral preview
core, a renderer whose whole contract is `renderToCanvas`, and a framework package that pairs
renderer and builder on the Node side. We want that separation, so that another framework is a
package and not a rewrite. Separately, requiring the designs directory to be an installed
workspace package (0006) made the first run of the command-line tool an install.

## Decision

- `apps/web` is the manager. It talks to the preview only through
  `@ultrapaint/contracts/preview`. `ed:ready` carries `PREVIEW_PROTOCOL`; the editor refuses
  a preview that speaks another version.
- `packages/preview-core` runs in the iframe and knows the DOM only: messaging, hit testing,
  rectangles, style provenance, tokens, inline text editing, screenshots.
- `packages/renderer-react` supplies the `Introspector` (fiber walk through the DevTools hook)
  and `renderToCanvas`. The introspector is bundled with the core into one script injected
  ahead of the screen, because React's hook has to exist before React loads. `render` is
  bundled with `react` left as an import, so the repository's copy renders the screen.
- `packages/framework-react-vite` is the Node side behind the `Framework` interface of
  `packages/framework-api`: screen files and templates, the JSX source editor, the catalogue
  extractor, repository detection and the preview builder. The server reaches it only through
  the `ProjectFramework` service; `locateFramework` is the one place that will later prefer a
  copy installed in the repository over the bundled one.
- Screens need no package. They resolve bare imports from an **anchor** package
  (`settings.resolveFrom`, else the nearest package around the designs directory) through a
  Vite plugin that redirects only the first hop. The anchor is the Vite root, as the project is
  for Storybook, so pre-bundled dependencies, `resolve.dedupe` (one React) and the public
  directory come from where the design system's consumers get them. Our page is served by a
  middleware from the generated directory.
- The preview uses the repository's Vite and the anchor's `vite.config` when they exist
  (aliases, CSS, `define`, plugins), and the bundled Vite and React plugin otherwise. A config
  that fails to load is reported and skipped. Plugins that belong to an application's server
  (server frameworks, routers, deployment adapters, error reporting) are left out by name.
- Vite 8 does not pre-bundle a dependency whose resolution a plugin asked for; the resolver
  registers it with the optimizer itself, as Vite's resolver does for an ordinary import.
- The preview child runs with `NODE_PATH` cleared, so it sees only what the repository resolves.

## Consequences

- An existing designs package keeps working: it is its own anchor.
- The first-run setup creates a directory, a `tsconfig.json` and, optionally, a git-ignored
  `node_modules` link to the anchor's, which is what makes editors and `tsc` resolve the
  screens' imports (`paths` mapping cannot: it ignores `exports`). Nothing is installed.
- A screen can import what the anchor can import, and nothing else.
- A second framework needs a renderer (introspector and `renderToCanvas`) and a framework
  package with its own stamper, source editor and catalogue extractor. Rendering is the small
  part; stamping and source editing per syntax are the work.
- Yarn Plug'n'Play has no `node_modules` to resolve through and is not supported.
