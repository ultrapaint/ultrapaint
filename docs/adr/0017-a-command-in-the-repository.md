# ADR 0017: A command run in the repository, served to the browser

Status: accepted, 2026-09-28. Amends the architecture section of the project goal and the
`managed` row of 0010. Amended 2026-10-26 by [0031](0031-the-desktop-app.md): a desktop app
returns, as a shell around the same server and web build, for the list of projects, a new design
in an empty folder and a native folder picker; the command stays as decided here.

## Context

The tool could be started three ways: the `ultrapaint` command in a repository, `pnpm dev`
from the checkout, and an Electron shell in `apps/desktop`. The shell added a window and a
native folder picker, and for the picker it needed the `managed` storage mode, whose
`settings.json` names the repository by an absolute path of one machine. That is the one
arrangement where the repository is chosen by a settings file rather than by where the command
is run.

The shell removed none of the real cost of starting: the repository still has to be cloned
with its dependencies installed, Node present and an agent signed in. It would have brought the
heaviest packaging of the project with it, Electron builds, signing and auto-update on three
platforms, for a product that has no releases yet.

A hosted version, if it comes, is a machine with the repository checked out and its toolchain
running, not a different place for the designs; the editor talks to its backend over RPC and
does not care where the backend is. Nothing about that needs a desktop shell either.

## Decision

- **The tool is a command run in the repository.** The repository is the project; the command
  finds its configuration from the working directory upwards (0010) and serves the editor to
  the browser. There is no "open project" step and no list of projects. Several repositories
  are several commands on several ports.
- **The desktop shell is removed.** `apps/desktop`, the Electron dependency and the preload
  bridge are gone. The editor's `Platform` keeps only `serverUrl`, the hook for a backend that
  is not the origin the editor was served from. The settings panel has no folder picker; the
  repository path is a field, and is read-only when a configuration file gives it.
- **`--home` stays, as a home directory of its own.** The `managed` mode is what `pnpm dev`
  uses to keep its settings across runs in `~/.ultrapaint`. It is no longer described as the
  desktop's.
- **Before there are releases, a project depends on the checkout by a link.** Nothing is
  published while the name and the format are unsettled. A project that wants the command
  pinned adds `ultrapaint@link:../ultrapaint` as a devDependency; pnpm puts the checkout's
  `bin` in `node_modules/.bin`, and the command runs the checkout's sources in the project's
  working directory, as `pnpm install:cli` does globally.
- **`--dev` is development's way to run, from any project.** The command's `--dev` starts the
  server under `tsx watch` and the editor under Vite, side by side in one scope, from the
  directory it is run in; nothing is built. `pnpm dev` in the checkout is that mode with
  ports derived from the checkout's path and a home directory for the settings, so there is
  one way to run in development and the linked command has it too.

## Consequences

- `pnpm-workspace.yaml` no longer allows Electron's build script; the lockfile loses it.
- The project goal's "one web app, multiple shells" becomes "a command in the repository, and
  the browser"; a shell may return when there is a reason, since the editor still imports
  nothing of the machine, but it is not a goal.
- A hosted version, should it come, replaces the `Storage` service's state directory and the
  launcher of the server, and adds identity to the connection. The designs stay files in a
  checkout there too. None of it is designed now.
- The link is a path on disk, so a team sharing `package.json` needs the checkout at the same
  relative path. That is accepted until a package is published.
