# Development

```bash
pnpm install
pnpm dev                                        # server and editor with hot reload, ports printed at start
pnpm dev -- --config ../your-repo/ultrapaint.config.json   # against a configuration file
pnpm dev -- --ephemeral                         # save nothing
pnpm test && pnpm typecheck && pnpm lint
```

`pnpm dev` is `ultrapaint --dev` run from the checkout, with ports in 4600–4679 derived from the
checkout's path so several worktrees, and the installed command on 4770, run side by side. It
keeps its settings in `~/.ultrapaint` unless it is given `--config` or `--ephemeral`. Read
[`AGENTS.md`](../AGENTS.md) before writing server code.

`pnpm pack:local` makes the package a release carries, in `dist/ultrapaint-<version>.tgz`. A
release is made by hand: the **Release** workflow in the Actions tab raises the version in
`package.json`, tags it and attaches the package.

## Where things are

- `apps/web` — the editor (React, Tailwind, Base UI). It talks to the origin it is served from and touches nothing of the machine.
- `apps/server` — local backend on the Effect 4 runtime: settings, pages and canvases, design documents, component files and the design system, undo, git where there is one, the snapshot store, ACP threads.
- `packages/contracts` — Effect Schema for everything on the wire, the document format included, and the `RpcGroup` that is the editor's API.
- `packages/design-document` — the document format's pure code: tree walks, ids, the operations every edit is made of, tokens and the CSS a node is drawn with, a system component's look as CSS, an instance's slots (what fills each, how each lays it out), an app component's instance as the nodes it draws, a node's JSX with the classes a style system writes.
- `packages/framework-api` — what a framework and a style system give the server.
- `packages/preview-core` — the editor's frames (`Preview`), drawn in its page by a renderer mounted through `RenderToCanvas`: shadow roots, the design's look set once, what to draw, measuring, hit-testing, pictures, text editing, the prototype's navigation.
- `packages/system-components` — the editor's own components on Base UI (ADRs 0040, 0041): the catalogue over the component files (`catalogueOf`), their components, their default look, each frame's containment, and the conversion of what came before.
- `packages/renderer-react` — draws design documents with the editor's React: elements, system components and app components (`renderToCanvas`).
- `packages/figma-import` — reads a `.fig` file: its frames to design documents by fixed rules, with a mapping that says what each Figma component becomes, and its variables and styles as tokens.
- `packages/framework-react-vite` — the Node side for React + Vite: repository detection and the application a repository can start from.
- `packages/style-tailwind-v4` — the Tailwind v4 style system: tokens read from and written to `@theme`, the theme scan, what the code's classes use and their rewrite, the preview's stylesheet, a node's utilities for the Code tab.
- `packages/acp` — the only module that imports the ACP SDK, behind an `AcpAgent` Effect interface; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — the editor's RPC connection (reconnects, typed requests, events) and small utilities.
- `apps/desktop` — the desktop app: an Electron window around the same server and editor, its project list, the server it starts per project, the agents' adapters bundled and run on Electron's Node, the agents found, downloaded and signed in; `pnpm desktop:dev` and `pnpm desktop:build`.
- `scripts/command.ts` — the `ultrapaint` command, run from a checkout (with its `--dev` mode) or bundled into the release package by `scripts/pack.ts`; `scripts/cli.ts` is it on the PATH and `scripts/dev-runner.ts` is `pnpm dev`, that mode with development's ports and settings.

## Background

Storage verdict: [`docs/decisions/storage-format.md`](decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](feature/spikes/findings.md).

## Design decisions

- [What the project is for](PROJECT-GOAL.md)
- [Where settings and state are kept](adr/0010-storage-modes.md)
- [A command run in the repository](adr/0017-a-command-in-the-repository.md), and [the desktop app around it](adr/0031-the-desktop-app.md)
- [How the preview is built: editor, preview core, renderer, framework](adr/0011-preview-split.md)
- [Spaces, pages and the router](adr/0012-spaces-pages-router.md), and [pages with optional URLs](adr/0020-pages-have-optional-urls.md)
- [Design documents instead of TSX pages](adr/0015-design-documents.md)
- [Importing a Figma file](adr/0016-figma-import.md)
- [Setting up a design system in steps](adr/0023-design-system-setup.md)
- [Style systems: tokens read and written behind one interface](adr/0024-style-systems.md)
- [One Sync for the design system and the code](adr/0025-design-system-sync.md)
- [All architecture decisions](adr/README.md)
