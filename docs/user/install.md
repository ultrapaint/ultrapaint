# Install and start

Ultrapaint needs [Node.js](https://nodejs.org) 24 or newer. Agents are optional: to use one, install it and sign in first (Claude Code: run `claude` once; Codex: `codex login`); Ultrapaint uses the login you already have.

## From a release

Each [release](https://github.com/ultrapaint/ultrapaint/releases) carries the command as a
package, `ultrapaint-<version>.tgz`: the server and the editor already built, nothing to clone.
The repository is private, so download it with the [GitHub CLI](https://cli.github.com), or from
the release page while signed in.

To try it without installing anything, run this in the repository you want to design in. It
downloads the latest release to a temporary directory and runs it from there:

```bash
dir=$(mktemp -d)
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz' --dir "$dir"
pnpm dlx "$dir"/ultrapaint-*.tgz
```

`pnpm dlx` needs the tarball's absolute path: a relative one is read from pnpm's cache, not from
where you are. Flags go after the path (`pnpm dlx "$dir"/ultrapaint-*.tgz --port 4800`).

To keep the command, install it globally instead:

```bash
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz'
pnpm add -g ./ultrapaint-*.tgz
```

pnpm installs global commands into a directory of its own; if it says that directory is not on
your `PATH`, run `pnpm setup` once and open a new shell. `npm install -g ./ultrapaint-*.tgz`
works too. To update, download the newer release and install it the same way.

## From a checkout

The checkout is the way to run what is on `main` before it is released, and to work on
Ultrapaint itself. You need [pnpm](https://pnpm.io/installation) and git as well.

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

## Starting it

Go to the repository you want to design in and start it:

```bash
cd ~/code/your-repo
ultrapaint
```

It serves the editor and its backend on `http://127.0.0.1:4770` and opens it in your browser.
Started again in a project whose server already runs, it opens that one's editor instead of
starting a second: the server leaves `run.json` in its state directory while it runs. The folder
need not be a git repository, and the tool needs no git. `ultrapaint --help` has the full
reference; the flags you are most likely to want:

| Flag | What it does |
|---|---|
| `--config <file>` | Use this configuration file instead of looking for `ultrapaint.config.json` |
| `--ephemeral` | Save nothing, even when a configuration file exists |
| `--port <number>` | Listen on another port; `0` picks a free one |
| `--host <address>` | Listen on this address instead of loopback, to reach the editor from another machine (see [From another machine](remote-access.md)) |
| `--allowed-host <name>` | Also answer requests that name the editor so: a reverse proxy's name, or a VPN's; `.example.com` allows its subdomains. Repeat it for each name |
| `--no-open` | Do not open the browser |
| `--ready-json` | Once listening, print `{"pid","port","token","url"}` as one line of JSON on stdout (logs go to stderr), for a program that starts the server |
| `--dev` | From a checkout only: run its sources with hot reload instead of its build. The server restarts and the editor reloads as the checkout changes. Listens on loopback too; `--host` opens it to the network |

## As a devDependency of your project

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
editor is a build, made once. While changing Ultrapaint itself, start it with `--dev` instead
and nothing is built: the server restarts and the editor reloads as the checkout changes.

```bash
pnpm ultrapaint --dev
```
