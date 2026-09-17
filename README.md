# ultrapaint

ultrapaint is a local-first design tool for teams that work with coding agents. The canvas is
your real React UI rendered with your real design system, the designs live in your repository as
source files, and agents such as Claude Code and Codex work on them next to you over
[ACP](https://agentclientprotocol.com).

Nothing is installed in your repository and nothing leaves your machine: the tool runs a local
server, reads your components where they are, and writes screens as `.tsx` files you review and
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
component library, the package your screens will resolve their imports from, the stylesheet that
sets up your design system, and a directory for the screens (`docs/designs` unless you already
have one). Confirm or change the proposals, let it create the directory, and the canvas opens.

Screens need no package of their own and nothing is installed for them. They import what the
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

Your screens are files in your repository and are written there in every case.

## Some notes

This project is very early. Expect bugs and breaking changes.

It supports React with Vite today. The preview is split the way Storybook's is, so that another
framework is a package rather than a rewrite, but none exists yet. Yarn Plug'n'Play is not
supported.

## Documentation

- [What the project is for](docs/PROJECT-GOAL.md)
- [Where settings and state are kept](docs/adr/0010-storage-modes.md)
- [How the preview is built: editor, preview core, renderer, framework](docs/adr/0011-preview-split.md)
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
- `apps/server` — local backend on the Effect 4 runtime: settings, preview host, screens, source edits, git, ACP threads.
- `apps/desktop` — Electron shell: runs the server and loads the web bundle, adds a folder picker.
- `packages/contracts` — Effect Schema for everything on the wire, and the `RpcGroup` that is the editor's API.
- `packages/framework-api` — what a renderer gives the preview and what a framework gives the server.
- `packages/preview-core` — the framework-neutral runtime injected into every screen iframe.
- `packages/renderer-react` — React's tree introspection and `renderToCanvas`, run with the repository's own React.
- `packages/framework-react-vite` — the Node side for React + Vite: JSX stamping and editing, catalogue extraction, repository detection, the preview server.
- `packages/acp` — the only module that imports the ACP SDK, behind an `AcpAgent` Effect interface; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — the editor's RPC connection (reconnects, typed requests, events) and small utilities.
- `scripts/cli.ts` — the `ultrapaint` command of a checkout; `scripts/dev-runner.ts` — `pnpm dev`.

Storage verdict: [`docs/decisions/storage-format.md`](docs/decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](docs/feature/spikes/findings.md).
