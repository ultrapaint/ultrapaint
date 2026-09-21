# ultrapaint

ultrapaint is a local-first design tool for teams that work with coding agents. The canvas is
your real React UI rendered with your real design system, the designs live in your repository as
source files, and agents such as Claude Code and Codex work on them next to you over
[ACP](https://agentclientprotocol.com).

Nothing is installed in your repository and nothing leaves your machine: the tool runs a local
server, reads your components where they are, and writes pages as `.tsx` files you review and
commit like any other code.

## Installation

> [!WARNING]
> There are no packaged releases yet: ultrapaint is installed from this repository. You need
> [Node.js](https://nodejs.org) 24 or newer, [pnpm](https://pnpm.io/installation) and git.
>
> Agents are optional. To use one, install and sign in to it first; ultrapaint uses the login
> you already have:
>
> - Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run `claude` once to sign in
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`

### Command line

```bash
git clone https://github.com/ultrapaint/ultrapaint.git
cd ultrapaint
pnpm install
pnpm install:cli
```

`pnpm install:cli` links the `ultrapaint` command into `~/.local/bin`; make sure that directory
is on your `PATH`. On Windows, or to skip the link, run `pnpm start` from the checkout instead.

Then go to the repository you want to design in and start it:

```bash
cd ~/code/your-repo
ultrapaint
```

It serves the editor and its backend on `http://127.0.0.1:4770` and opens it in your browser.
The first start builds the editor, which takes a few seconds. `ultrapaint --help` has the full
reference; the flags you are most likely to want:

| Flag | What it does |
|---|---|
| `--config <file>` | Use this configuration file instead of looking for `ultrapaint.json` |
| `--ephemeral` | Save nothing, even when a configuration file exists |
| `--port <number>` | Listen on another port |
| `--no-open` | Do not open the browser |

To update, pull and install again: `git pull && pnpm install`.

### Desktop app

The desktop app is the same editor in an Electron window, with a native folder picker. It is
run from the checkout for now:

```bash
pnpm -F @ultrapaint/desktop dev
```

It keeps its settings in `~/.ultrapaint`, whichever directory it is started from.

## First run

Start `ultrapaint` inside a repository and the setup looks at it for you: it proposes the
component library, the package your pages will resolve their imports from, the stylesheet that
sets up your design system, and a directory for the designs (`docs/designs` unless you already
have one). Confirm or change the proposals, let it create the directory, and the canvas opens.

Pages need no package of their own and nothing is installed for them. They import what the
package you picked can import, and render with your repository's own React and Vite.

Started like this, without a configuration file, the top bar says **Not saved**: your settings
and agent threads go away when the tool stops. Click it to save an `ultrapaint.json` in the
repository. The file holds no path of your machine and is meant to be committed, so the next
person only runs `ultrapaint`.

| Started with | Settings | Agent threads, checkpoints, caches |
|---|---|---|
| an `ultrapaint.json` found from the working directory up, or `--config <file>` | that file | `.ultrapaint/` next to it, git-ignored |
| neither | not saved until you save a configuration | a temporary directory |
| `--home <dir>` (the desktop app) | `<dir>/settings.json` | `<dir>` |

Your pages are files in your repository and are written there in every case.

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
can add and rename pages through it, answer a comment where it was left, and say which page it is
working on so you can watch it.

It saves the agent from reading the repository to find out what the editor already knows: on four
tasks, agents went from 30 tool calls on average to 11
([the measurements](docs/feature/benchmarks/)).

An agent outside the editor can use the same tools: **Settings** shows the line that adds it.

## Pages, routes and spaces

A **page** is a `.tsx` file in the designs directory, and its path is its route, the way every
React router does it: `index.tsx` is `/`, `settings/billing.tsx` is `/settings/billing`,
`invoices/[id].tsx` is `/invoices/:id`. The **Pages** panel is that route tree.

Pages navigate through `_router.tsx`, written next to them the first time you create a page and
never overwritten:

```tsx
import { Link, useNavigate, useParams, useRoute } from "./_router.tsx";

<Link to="/settings/billing">Billing</Link>;
```

It is plain React with nothing of ultrapaint in it, so the page still compiles in your
repository. In the **prototype** workspace the whole thing is one iframe: pressing a link swaps
the page inside it, provider and component state survives, and the route is in the editor's own
URL — so the browser's back and forward buttons are the prototype's, and a prototype state can
be reloaded or pasted to someone else.

A **space** owns one router, one canvas and its own pages; a page of one space cannot navigate
to a page of another. The designs directory is one space until a `space.json` says otherwise.

## Some notes

This project is very early. Expect bugs and breaking changes.

It supports React with Vite today. The preview is split the way Storybook's is, so that another
framework is a package rather than a rewrite, but none exists yet. Yarn Plug'n'Play is not
supported.

## Documentation

- [What the project is for](docs/PROJECT-GOAL.md)
- [Where settings and state are kept](docs/adr/0010-storage-modes.md)
- [How the preview is built: editor, preview core, renderer, framework](docs/adr/0011-preview-split.md)
- [Spaces, pages and the router](docs/adr/0012-spaces-pages-router.md)
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

`pnpm dev` keeps its settings in `~/.ultrapaint`, as the desktop app does, unless it is given
`--config` or `--ephemeral`. Read [`AGENTS.md`](AGENTS.md) before writing server code.

- `apps/web` — the editor (React, Tailwind, Base UI). No Electron imports.
- `apps/server` — local backend on the Effect 4 runtime: settings, preview host, pages and spaces, source edits, git, ACP threads.
- `apps/desktop` — Electron shell: runs the server and loads the web bundle, adds a folder picker.
- `packages/contracts` — Effect Schema for everything on the wire, and the `RpcGroup` that is the editor's API.
- `packages/framework-api` — what a renderer gives the preview and what a framework gives the server.
- `packages/preview-core` — the framework-neutral runtime injected into every preview iframe, and the space's router.
- `packages/renderer-react` — React's tree introspection and `renderToCanvas`, run with the repository's own React.
- `packages/framework-react-vite` — the Node side for React + Vite: JSX stamping and editing, catalogue extraction, repository detection, the preview server.
- `packages/acp` — the only module that imports the ACP SDK, behind an `AcpAgent` Effect interface; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — the editor's RPC connection (reconnects, typed requests, events) and small utilities.
- `scripts/cli.ts` — the `ultrapaint` command of a checkout; `scripts/dev-runner.ts` — `pnpm dev`.

Storage verdict: [`docs/decisions/storage-format.md`](docs/decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](docs/feature/spikes/findings.md).
