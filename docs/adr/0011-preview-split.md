# ADR 0011: Editor, preview core, renderer and framework

Status: accepted, 2026-09-17. Supersedes 0001 and 0006; builds on 0002, 0003 and 0007.

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
