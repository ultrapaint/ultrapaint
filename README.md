# ultrapaint

ultrapaint is a local-first design tool for teams that work with coding agents. The canvas is
drawn with your real design system — its Tailwind v4 theme and its React components — the
designs live in your repository as plain JSON documents, and agents such as Claude Code and Codex
work on them next to you over [ACP](https://agentclientprotocol.com), then turn them into your
application's own code.

Nothing is installed in your repository and nothing leaves your machine: the tool runs a local
server, reads your components where they are, and writes pages as `.page.json` files you review
and commit like any other file.

## Installation

> [!WARNING]
> ultrapaint is not on npm yet. It is installed from a release of this repository, or run from
> a checkout of it. You need [Node.js](https://nodejs.org) 24 or newer.
>
> Agents are optional. To use one, install and sign in to it first; ultrapaint uses the login
> you already have:
>
> - Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run `claude` once to sign in
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`

### From a release

Each [release](https://github.com/ultrapaint/ultrapaint/releases) carries the command as a
package, `ultrapaint-<version>.tgz`: the server and the editor already built, nothing to clone.
The repository is private, so download it with the [GitHub CLI](https://cli.github.com) (or from
the release page while signed in) and install it globally with pnpm:

```bash
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz'
pnpm add -g ./ultrapaint-*.tgz
```

pnpm installs global commands into a directory of its own; if it says that directory is not on
your `PATH`, run `pnpm setup` once and open a new shell. `npm install -g ./ultrapaint-*.tgz`
works too. To update, download the newer release and install it the same way.

### From a checkout

The checkout is the way to run what is on `main` before it is released, and to work on
ultrapaint itself. You need [pnpm](https://pnpm.io/installation) and git as well.

```bash
git clone https://github.com/ultrapaint/ultrapaint.git
cd ultrapaint
pnpm install
pnpm install:cli
```

`pnpm install:cli` links the `ultrapaint` command into `~/.local/bin`; make sure that directory
is on your `PATH`. On Windows, or to skip the link, run `pnpm start` from the checkout instead.
The first start builds the editor, which takes a few seconds. To update, pull and install again:
`git pull && pnpm install`.

`pnpm pack:local` makes the package a release carries, from the checkout as it is, in
`dist/ultrapaint-<version>.tgz`. A release is made by hand: the **Release** workflow in the
Actions tab raises the version in `package.json`, tags it and attaches the package.

### Starting it

Go to the repository you want to design in and start it:

```bash
cd ~/code/your-repo
ultrapaint
```

It serves the editor and its backend on `http://127.0.0.1:4770` and opens it in your browser.
`ultrapaint --help` has the full reference; the flags you are most likely to want:

| Flag | What it does |
|---|---|
| `--config <file>` | Use this configuration file instead of looking for `ultrapaint.json` |
| `--ephemeral` | Save nothing, even when a configuration file exists |
| `--port <number>` | Listen on another port |
| `--host <address>` | Listen on this address instead of loopback, to reach the editor from another machine (see below) |
| `--no-open` | Do not open the browser |
| `--dev` | From a checkout only: run its sources with hot reload instead of its build. The server restarts and the editor reloads as the checkout changes. Listens on every interface unless `--host` says otherwise |

### As a devDependency of your project

A project can depend on the checkout instead, so the command is pinned to it and everyone on
the project runs the same one. Nothing is published: the dependency is a link to the checkout
on disk, and it follows every change made there.

```bash
cd ~/code/your-repo
pnpm add -D ultrapaint@link:../ultrapaint
```

That puts `ultrapaint` in `node_modules/.bin`, so `pnpm ultrapaint` starts it, or a script
does:

```json
{ "scripts": { "design": "ultrapaint" } }
```

The checkout has to be installed (`pnpm install` in it) for the link to work, and the link is
a path on disk, so everyone on the project needs the checkout at that relative path. When there
are packaged releases the link becomes a version.

The link follows the checkout: the server runs from its sources on every start, and only the
editor is a build, made once. While changing ultrapaint itself, start it with `--dev` instead
and nothing is built: the server restarts and the editor reloads as the checkout changes.

```bash
pnpm ultrapaint --dev
```

## First run

Start `ultrapaint` inside a repository and the setup looks at it for you: it proposes the
component library, the package the components resolve from, the stylesheet that sets up your
design system, and a directory for the designs (`docs/designs` unless you already have one).
Confirm or change the proposals, let it create the directory, and the canvas opens.

Only Tailwind v4 is supported: the design system is read from its `@theme`. The setup says so
when the stylesheets set up Tailwind v3 or no Tailwind at all.

Nothing is installed for the designs. Their components are imported the way the package you
picked imports them, and render with your repository's own React and Vite.

Started like this, without a configuration file, the top bar says **Not saved**: your settings
and agent threads go away when the tool stops. Click it to save an `ultrapaint.json` in the
repository. The file holds no path of your machine and is meant to be committed, so the next
person only runs `ultrapaint`.

| Started with | Settings | Agent threads, checkpoints, caches |
|---|---|---|
| an `ultrapaint.json` found from the working directory up, or `--config <file>` | that file | `.ultrapaint/` next to it, git-ignored |
| neither | not saved until you save a configuration | a temporary directory |
| `--home <dir>` (what `pnpm dev` uses) | `<dir>/settings.json` | `<dir>` |

Your pages are files in your repository and are written there in every case.

## From another machine

`ultrapaint --host <address>` listens on that address instead of loopback: this machine's
address on a private network such as Tailscale, or `0.0.0.0` for every interface. The command
prints the addresses the editor is reachable at, and the preview is served on the same address.
`--dev` listens on every interface by default, the editor's dev server included, since
development is looked at from other machines as a matter of course; `--host 127.0.0.1` keeps it
to this machine.

There is no login. Whoever reaches that port can run agents in the repository with your rights,
so keep it to a private network and prefer the network's own address over `0.0.0.0`.

## Agents stay in the repository

An agent you start here runs inside a sandbox: it reads the repository, its own files and the
toolchain, and writes nothing but the repository, its own files, the package caches and the
temporary directories. Your home directory is closed to it. That holds for the shell commands it
runs too, and it does not depend on the agent — it is the operating system's doing. Network is
open, because an agent has to reach its model.

This works on macOS, and on Linux when [bubblewrap](https://github.com/containers/bubblewrap) is
installed (`bwrap`). Elsewhere the thread says **Not scoped**: the agent runs with your own rights
until the sandbox for that platform lands.

An agent of your own, added as JSON under `~/.ultrapaint/agents/`, tells the sandbox where it
keeps its login and sessions:

```json
{
  "id": "my-agent",
  "name": "My agent",
  "command": "my-agent-acp",
  "stateDirs": ["~/.my-agent"]
}
```

## Agents ask the editor

An agent in a thread is told about the project when it starts — where the designs are, how pages
route, what the component palette is — and is given the editor's own MCP server to ask the rest:
the pages and their routes, a component's props and variants, the comments left on the canvas. It
can add and rename pages through it, answer a comment where it was left, say which page it is
working on so you can watch it, and take a screenshot of a page or a node to check its own work.
Screenshots are drawn by the editor's preview, so the editor has to be open in a browser. When a
decision is yours it asks you on a card in the chat, and waits for your answers in the same turn;
you can also decline. Any MCP server the agent uses can ask you the same way.

While it works, what it changes shows on the canvas: the elements take the agents' pink, with its
name and what it is doing on their edge, and the text it is rewriting turns to placeholders until
it is done. A selection is blue, or purple when it is a component of your library.

**Chats** lists your chats, each with a picture of what it works on, its last line, and whether it
is working or waiting for you. In **Vibe**, the element you select has a toolbar over it with what
your design system offers for it — a component's own variants, the text styles, the colour,
radius and spacing tokens — and a button that adds it to the chat. Shift-click or draw a marquee to
select several, and set what they share at once. What you send while an agent works waits in the
thread and goes when its turn ends. Right-click an element to copy
a link that opens the editor on it, or its ID (`/orders#c_8x2k1q`), which an agent takes to find
it.

It saves the agent from reading the repository to find out what the editor already knows. On four
tasks with the model pinned, two runs each, that was 32 tool calls on average without any of it,
24 with the briefing and 15 with the tools as well — and roughly half the time per task. On two
of the four the three arms do not overlap at all; on the hardest one they still do
([the measurements](docs/feature/benchmarks/), which say what they cannot yet tell apart).

An agent outside the editor can use the same tools: **Settings** shows the line that adds it.

## Design documents

A design is not code. It is a small tree of nodes, the way a design tool sees it:

| Node | What it is |
|---|---|
| `page` | A screen at a route; it lays its children out in a column |
| `row`, `column` | A flex container, horizontal or vertical: gap, alignment, padding, wrap |
| `group` | A plain container that only holds and styles its children |
| `text` | A heading (level 1–6) or a paragraph |
| `image` | A picture from the space's `assets/` directory |
| `instance` | A component of your design system, with its props |

Sizes are `fill`, `hug` or pixels, and every colour, radius, shadow, spacing and type setting can
be a token of your design system (`"$color-primary"`, `"$text-lg"`, `"$spacing-4"`), so the
design follows the theme when it changes. `get_document_format`, on the editor's MCP server,
gives an agent the whole format as a JSON Schema.

The **Layers** panel shows the whole space at once, as a design tool does: every page with its
tree, and the nodes placed on the canvas beside them. A node inside a page follows the page's
layout; a node on the canvas has its own position. Drag one from one to the other, in the layers
or on the canvas. The tree is walked with the arrow keys, a layer is renamed with a double-click or
F2, hidden with its eye and locked with its lock, so a click on the canvas passes it by; the field
at the top finds layers by name, text or component.

Several elements selected at once are changed together everywhere, in the inspector (where the
fields they differ on say "Mixed"), the menus, the toolbar and the keys, as one undo step. ⌘\
(Ctrl+\) puts the panels away, and `?` lists every shortcut, written as your platform writes
them. The workspaces are ⌃1–3 on a Mac and Alt+1–3 elsewhere.

When a page is ready, **Implement** in the Pages panel (or `/implement <url or file>` in a thread) asks
an agent to write it in your application with your own components and conventions: the tokens
become the matching Tailwind v4 classes, instances become your components.

## The design system

**Initialise** (in the Design system panel or in Settings) opens a thread with `/init` in its
composer and your default agent picked; nothing is sent until you press it. The agent reads the
Tailwind v4 theme of your stylesheets, looks at your components, their docs and your screens,
asks you what it cannot find out, and saves two files next to the designs:

- `design-system.json` — colours by palette, type sizes and text styles, fonts, spacing, radius,
  shadows, border widths, elevation levels (a surface, its shadow and its z-index), breakpoints
  and container widths, motion (easings, durations, animations), the icon set and its sizes,
  themes, and for each component a category, a description and the example props its palette
  thumbnail is drawn with;
- `DESIGN.md` — the conventions every agent is told about: what the product is, which colours
  mean what, what to always or never do.

### Setting one up step by step

A project whose code has drifted from its theme, or that has no theme to speak of, needs more
than `/init`. **Set up step by step** in the Design system panel takes it through five steps, in
order; each one stops for you before the next.

| Step | What happens |
|---|---|
| Inventory | The code is read for the colours, spacing, type sizes and weights, radii, shadows and z-index layers it uses, and the plain `<button>`s and `<input>`s where your library has a component. Each value is the design system's, one of Tailwind's own, or written out (`bg-[#3b82f6]`, `p-[13px]`, an inline style), with how often and where |
| Define | An agent writes the design system. It **adopts** the theme there is, as `/init` does, or **proposes** one from what the code uses: a palette and its semantic colours, a spacing base, a type scale, the radii and shadows, put to you on question cards and then written into the stylesheet's `@theme`. The inventory recommends one of the two; you choose |
| Map | The code is read again against the design system, and each value off it is given what it becomes: a token (`color-primary`, `spacing-3`), the library's component for a plain element, or kept as it is. Rules settle the exact matches; an agent the rest, asking you where the meaning is yours. You can change any of it in the panel |
| Migrate | The code is brought onto the design system a directory at a time. The rules rewrite what is mechanical, classes (`hover:bg-[#3b82f6]/50` → `hover:bg-primary/50`), inline styles and stylesheet declarations; the agent does the rest, a colour in a constant, a `<button>` to `Button`, then runs your type check and linter. Each batch can be reverted on its own |
| Verify | The code is read once more: how many uses are still off the system, against how many there were when the mapping was made, and how many of those are kept on purpose |

A step an agent does runs in a thread of its own, opened with `/design-system <step>` in its
composer and marked with the step it runs. **Stop** ends the agent's turn and keeps what it
did; **Resume** picks it up again. **Redo** puts back every file the step and the later ones
changed, as it was when the step started, after showing you the list, and takes the later steps
back to the start; files you changed yourself in between are left alone. Each step is kept as a
git snapshot of the working tree under `refs/ultrapaint/setup/`, and so is each batch of Migrate, so the setup needs a git
repository; your index, branch and stash are never touched. Where the setup is lives in the state
directory, not in the repository ([ADR 0023](docs/adr/0023-design-system-setup.md)).

### Design skills

Before it designs, every agent is also told how to design well, whatever the product: hierarchy,
layout, spacing, typography, colour, elevation, borders and radius, iconography, motion,
content, states, how to compose with components, and accessibility. These
skills ship with the tool and come before `DESIGN.md`, which wins where they disagree. **Settings**
lists them, with a switch to turn any off (saved in `ultrapaint.json` as `skills.disabled`).

A project takes a skill over with a markdown file in `skills/` inside the designs directory:

- a file with a built-in's name (`skills/spacing.md`) replaces it;
- the same file opening with the front matter `extends: true` is told after the built-in instead;
- a file with any other name is a skill of its own.

**Replace…** and **Extend…** in Settings start that file for you, as one undo step. The file's
first heading is its title and the paragraph after it the summary Settings show.

The **Design system** panel shows them: swatches per theme, type specimens in your own fonts,
spacing, radius, shadows, elevation, border widths, layout and motion tokens, and the icon set. The **Assets** panel lists your components or shows them as a
grid of thumbnails, drawn with the example props.

## Importing a Figma file

**Import a Figma file…** in the canvas list (or the canvas's right-click menu) takes a `.fig` file (File → Save local copy in Figma).
The server reads it by fixed rules — the frames of each page, the components and where they are
used, the images — and opens a thread with `/import-figma` in its composer. The agent then
decides, component by component, what each Figma component becomes: one of your components,
with its variants and text properties mapped to props; a custom one, kept as the layers it is
made of; or left out. Where the names do not settle it, the agent asks you in the thread, with
the likely candidates to pick from, and carries on with your answers. Each frame is then written
as a page at a route that fits its name, with its pictures in the space's `assets/`, and the
agent looks at it and mends what the rules could not carry over.

Auto-layout becomes rows and columns, text keeps its font, image fills become images, icons
become SVG files. Free-positioned layers are stacked in reading order, and the import says so.

## Pages, URLs and canvases

A **page** is a `.page.json` file in a canvas, named after its file: "Billing settings" is
`billing-settings.page.json`. Renaming a page moves the file and keeps everything that points to
it. Nodes placed on the canvas outside any page are kept in the canvas's `canvas.json`.

A page may serve a **URL** in the prototype (`/settings/billing`, `/invoices/:id`), which
`canvas.json` keeps. A screen of the application has one; a sketch or a sheet of components needs
none. A page without a URL is drawn and edited like any other, but no link reaches it, and the
prototype warns when it shows one. A canvas made before URLs were optional serves each page at
the route its path names until its pages next change.

The **Pages** panel belongs to the **prototype** workspace: every page of the canvas with its URL,
or a warning when it has none, where URLs are given, changed and taken off. Any node in a page can
link to another page (it keeps leading there when the page is renamed or its URL changes), to a
URL with its parameters, back, or to another site: in the inspector, its right-click menu or the
Vibe toolbar. The prototype's bar shows what can be pressed, and a press on nothing flashes it. It also tries the
prototype on a phone, a tablet or a desktop without changing the design, and takes comments on the
page you are on. In the prototype the whole thing is one iframe: pressing a link swaps the page inside it,
provider and component state survives, and the route is in the editor's own URL — so the
browser's back and forward buttons are the prototype's, and a prototype state can be reloaded or
pasted to someone else.

A **canvas** owns one router and its own pages; a page of one canvas cannot navigate to a page of
another. The canvas's name under the project, in every workspace, opens the list of canvases.

## Some notes

This project is very early. Expect bugs and breaking changes.

It supports React with Vite and Tailwind v4 today. The preview is split the way Storybook's is, so that another
framework is a package rather than a rewrite, but none exists yet. Yarn Plug'n'Play is not
supported.

## Documentation

- [What the project is for](docs/PROJECT-GOAL.md)
- [Where settings and state are kept](docs/adr/0010-storage-modes.md)
- [A command run in the repository, no desktop app](docs/adr/0017-a-command-in-the-repository.md)
- [How the preview is built: editor, preview core, renderer, framework](docs/adr/0011-preview-split.md)
- [Spaces, pages and the router](docs/adr/0012-spaces-pages-router.md), and [pages with optional URLs](docs/adr/0020-pages-have-optional-urls.md)
- [Design documents instead of TSX pages](docs/adr/0015-design-documents.md)
- [Importing a Figma file](docs/adr/0016-figma-import.md)
- [Setting up a design system in steps](docs/adr/0023-design-system-setup.md)
- [All architecture decisions](docs/adr/README.md)
- [Work definition](docs/discuss/work-definition.md) and [implementation plan](docs/PLAN.md)

## Development

```bash
pnpm install
pnpm dev                                        # server and editor with hot reload, ports printed at start
pnpm dev -- --config ../your-repo/ultrapaint.json   # against a configuration file
pnpm dev -- --ephemeral                         # save nothing
pnpm test && pnpm typecheck && pnpm lint
```

`pnpm dev` is `ultrapaint --dev` run from the checkout, with ports derived from the checkout's
path so several worktrees run side by side. It keeps its settings in `~/.ultrapaint` unless it
is given `--config` or `--ephemeral`. Read [`AGENTS.md`](AGENTS.md) before writing server code.

- `apps/web` — the editor (React, Tailwind, Base UI). It talks to the origin it is served from and touches nothing of the machine.
- `apps/server` — local backend on the Effect 4 runtime: settings, preview host, pages and spaces, design documents and the design system, undo, git, ACP threads.
- `packages/contracts` — Effect Schema for everything on the wire, the document format included, and the `RpcGroup` that is the editor's API.
- `packages/design-document` — the document format's pure code: tree walks, ids, the operations every edit is made of, tokens and the CSS a node is drawn with.
- `packages/framework-api` — what a renderer gives the preview and what a framework gives the server.
- `packages/preview-core` — the framework-neutral runtime injected into every preview iframe: what to draw, measuring, hit-testing, text editing, the prototype's navigation.
- `packages/renderer-react` — draws design documents with the repository's own React and components (`renderToCanvas`).
- `packages/figma-import` — reads a `.fig` file and converts its frames to design documents by fixed rules, with a mapping that says what each Figma component becomes.
- `packages/framework-react-vite` — the Node side for React + Vite: the Tailwind v4 theme scan, catalogue extraction, repository detection, the preview server and its component registry.
- `packages/acp` — the only module that imports the ACP SDK, behind an `AcpAgent` Effect interface; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — the editor's RPC connection (reconnects, typed requests, events) and small utilities.
- `scripts/command.ts` — the `ultrapaint` command, run from a checkout (with its `--dev` mode) or bundled into the release package by `scripts/pack.ts`; `scripts/cli.ts` is it on the PATH and `scripts/dev-runner.ts` is `pnpm dev`, that mode with development's ports and settings.

Storage verdict: [`docs/decisions/storage-format.md`](docs/decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](docs/feature/spikes/findings.md).
