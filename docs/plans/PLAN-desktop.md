# Plan: a desktop app on top of the web app

Status: proposed, 2026-10-25; Phases 0, 1, 2 and 3 done 2026-10-26. Amends ADR 0017 (the desktop shell
returns, with the reason written down) through [ADR 0031](../adr/0031-the-desktop-app.md). Builds on 0004, 0008, 0010, 0013, 0019,
0023.

## Why

The tool is a command run in a repository and served to the browser (0017). That stays. The
desktop app is for what the command cannot do: keep a list of projects, local folders or folders
on another machine over SSH, and switch between them without a terminal; start a design in a
folder that has no code yet; and open a native folder picker. 0017 removed the first shell
because it took none of the cost of starting away. This one is built for the cost of starting:
Node is found the way a terminal finds it, the agent adapters ship inside the app, git is not
needed, and a new design is a button.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Form factors | The web app stays as it is. The repo-local run stays: `ultrapaint` in a repository, the package a devDependency, the editor in the browser. The desktop app is an Electron window around the same server and the same web build |
| D2 | Projects | A list in the app's data directory: a name, and either a local folder or an SSH host and a path on it. Added with a folder picker or a host and path |
| D3 | Switching | One project open at a time, chosen from a select in the window's title bar. No tabs yet. Switching stops the open project's server (asking first when an agent is working) and starts the next |
| D4 | Server | Spawned by the app per open project with Electron's own binary and `ELECTRON_RUN_AS_NODE=1`, as T3 Code does; on a free loopback port. The window loads the editor from it |
| D5 | Already running | A project whose server already runs (the command, or another window) is attached to, not started twice: the server writes a run file in its state directory with the port and a token |
| D6 | PATH | Read from the login shell at start (`$SHELL -ilc`), as T3 Code does, so fnm, Volta and Homebrew are found from an app opened in the Dock. `ELECTRON_RUN_AS_NODE` is never passed on to agents or the preview |
| D7 | Node | The user's own, for the preview and for installing a project's packages. Missing Node is a banner with the install step, not a failure in the middle of a task. A managed Node, downloaded into the app's data on first use, is a later phase |
| D8 | Agents | The adapters ship inside the app as two bundled files (about 3 MB) and run on Electron's Node. The agent is found first: `claude` and `codex` on the login shell's PATH or at the path set in the app's settings, as T3 Code does, and passed as `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`. An agent not found is offered as a download, opt-in, into the app's data (a pinned release, checked by its hash); declined, the agent stays unavailable with its install step shown. The command keeps `npx` |
| D9 | Git | Not needed, in the web app and the desktop app alike. Without git, or in a folder that is not a repository, everything works. When git is installed and the folder is a repository, the tool reads it (status, diff, branch); it never commits or runs `git init` unless the project's git setting is on (off by default). The Changes panel is redesigned (see the open questions), and the revision history may take over much of what it does |
| D10 | Snapshots without git | The design-system setup's snapshots (0023) move from git trees to the tool's own snapshot store in the state directory: files by content hash, a manifest per snapshot. The same store later carries the revision history |
| D11 | New design | A folder (a default under `~/Ultrapaint/` proposed, any other picked), a template (Blank, the default, or the starter components), and the code in `app/` or at the folder's root, the user's choice. No `git init` unless the git integration is turned on |
| D12 | SSH | The app runs the server on the remote machine through the system `ssh` (its config, keys and agent), forwards the server's port to loopback (the preview comes through it since ADR 0034), and loads the editor through it. Agents and the preview run on the remote machine |
| D13 | Window close | Quits: every server the app started stops, after asking when an agent is working |
| D14 | Platforms | macOS and Linux first (dmg, AppImage and deb). Windows once the agent sandbox exists there |
| D15 | Updates | None until the repository is public; then GitHub Releases through electron-updater |

## Measured: the agent adapters

On linux-x64, from the versions `npx` fetched (claude-agent-acp 0.95.0, codex-acp 2.2.2):

| Part | On disk | Compressed |
|---|---|---|
| claude-agent-acp, bundled with esbuild, without the Claude Code binary | 2.2 MB | 0.6 MB |
| codex-acp, bundled, without the Codex binary | 0.9 MB | 0.2 MB |
| Claude Code native binary (`@anthropic-ai/claude-agent-sdk-linux-x64`) | 293 MB | 131 MB |
| Codex native binaries (`codex`, `codex-code-mode-host`, `codex-voice-host`, `rg`) | 433 MB | 158 MB |

The adapters are small; the agents are not. Embedding both agents would add about 730 MB on disk
and 290 MB to the download, per platform and architecture. So the adapters ship (D8) and the
agents are the user's when installed; otherwise the app offers to download one (about 130 MB for
Claude Code, 160 MB for Codex), only when asked.

Two limits found on the way. Neither agent's desktop app is enough on its own: the Claude desktop
app does not put `claude` on the PATH and does not share its sign-in with Claude Code, and the
ChatGPT app's sharing of `~/.codex` is not documented. And Anthropic does not allow a third-party
product to offer claude.ai sign-in without approval; the app reuses the sign-in the user made in
Claude Code, and offers an API key field otherwise. Codex signs in with ChatGPT through the
adapter's own browser flow.

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing.

### Phase 0: groundwork in the server and the web app

Everything here helps the command too; nothing needs Electron.

- [x] 0.1 Git optional: the settings check accepts a folder that is not a work tree; the project
      folder falls back to the working directory when there is no git root; the Changes panel no
      longer waits on `git.status` together with checkpoints and snapshots; the briefing mentions
      `.git` only when there is one. A test fixture without `git init`.
- [x] 0.2 Writing to git as a setting (`git: off | on`, default off): commit and `git init` only
      when it is on; status, diff and the branch are read whenever git and a repository are
      there. A display name in settings for comments and the avatar, used when git gives none.
- [x] 0.3 Files an agent turn changed, without git: a hash of the files the turn could reach,
      before and after, ignoring what `.gitignore` ignores (or the ACP write events).
- [x] 0.4 The snapshot store (D10) and the setup's snapshots on it; the setup lists the code's
      files with a walk that respects `.gitignore`. ADR 0023 amended.
- [x] 0.5 The run file (D5) and `--ready-json`: the server prints its URL, port and token as one
      line of JSON once it listens, for whatever started it.
- [x] 0.6 `Platform` grows the hooks the desktop fills: a folder picker, the preview URL mapped
      through a forwarded port, and the project switcher's place in the header.
- [x] 0.7 ADR 0031 (the desktop app), 0017 amended, the project goal and the README.

### Phase 1: the desktop app with local projects

- [x] 1.1 `apps/desktop`: Electron main, preload and the `Platform` bridge; the window loads the
      server's editor.
- [x] 1.2 The project list (D2) in the app's data; add a folder; the select (D3).
- [x] 1.3 The server per open project (D4), attaching when one runs (D5); stopping on switch and
      on close (D13).
- [x] 1.4 Login-shell PATH (D6); Node detected, missing Node a banner with its install step.
- [x] 1.5 The adapters bundled into the app and run on Electron's Node (D8); the command keeps
      `npx`.
- [x] 1.6 Agents detected (D8): `claude` and `codex` on the PATH or at a path set in settings,
      their sign-in checked; the agent picker says which are ready.
- [x] 1.7 An agent not found is offered as a download (D8): a pinned release for the platform,
      checked by its hash, into the app's data, with progress; then its sign-in (Codex through
      the adapter's ChatGPT flow, Claude Code through its own login or an API key).
- [x] 1.8 Packaging for macOS and Linux; a Release workflow job that builds them.

### Phase 2: a new design from nothing

- [x] 2.1 The dialog (D11): name, folder, template, where the code goes, the git integration.
- [x] 2.2 Writing the project: the configuration, the designs, the scaffold in `app/` or the root,
      the packages installed; progress shown step by step.
- [x] 2.3 Blank as a template: the designs and an empty design system, no components; the starter
      components as the other.
- [x] 2.4 Opening it on Sync's define step, as the scratch case of 0025 does.

### Phase 3: projects over SSH

- [x] 3.1 A project with a host (an alias from `~/.ssh/config` or `user@host:port`) and a path.
- [x] 3.2 Starting the server there with `--ready-json`, over the system `ssh`; the remote machine
      needs Node and the `ultrapaint` command (a pinned runtime the app uploads is later).
- [x] 3.3 Forwarding the server's port, and the preview's whenever it starts or moves; the editor
      reaches the preview through the mapping of 0.6.
- [x] 3.4 Reconnecting after a dropped connection; the server stops when the app closes.

Key authentication only: `ssh` runs in batch mode, and a password or passphrase is asked of the
agent, not of the window. The New design dialog writes on this machine; on another one it is
`ultrapaint new`, run there. The preview's port is forwarded when the editor first asks for it.
ADR 0031 has the details.

### Phase 4 and after

In [PLAN-desktop-next](PLAN-desktop-next.md), with what building Phases 0 to 3 found.

## Future: revision history

In [PLAN-revision-history](PLAN-revision-history.md).

## Open questions

Moved to [PLAN-desktop-next](PLAN-desktop-next.md), with the ones building it raised.
