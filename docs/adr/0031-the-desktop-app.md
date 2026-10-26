# ADR 0031: A desktop app around the same server and web build

Status: accepted, 2026-10-26. Amends 0017 (the desktop shell returns, for a reason written down
here), 0004, 0013, 0018 and 0023 (git is no longer needed). Builds on 0008, 0010 and 0019. The
work is planned in [PLAN-desktop](../PLAN-desktop.md); this records its decisions and what Phase 0
changed in the server and the editor, and what Phases 1 and 2 added.

## Context

The tool is a command run in a repository and served to the browser (0017). That stays. What the
command cannot do is what the desktop app is for: keep a list of projects, local folders or
folders on another machine over SSH, and switch between them without a terminal; start a design
in a folder that has no code yet; and open a native folder picker.

0017 removed the first Electron shell because it took none of the cost of starting away: the
repository still had to be cloned and installed, Node present, an agent signed in, and git there.
The second shell is built for that cost: Node is found the way a terminal finds it, the agent
adapters ship inside the app, git is not needed, and a new design is a button.

Several things the shell relies on are useful to the command too, and were done first, without
Electron.

## Decision

**The desktop app is a shell around the same server and the same web build.** The web app and the
repo-local command stay as they are. The app is an Electron window that starts the server per
open project (Electron's own binary with `ELECTRON_RUN_AS_NODE=1`, on a free loopback port) and
loads the editor from it. One project is open at a time, chosen in the header; switching stops
one server and starts the next. Over SSH the server runs on the remote machine and the app
forwards its port and the preview's. The editor imports nothing of Electron: what the shell adds
reaches it through `Platform`.

**Git is not needed.** Without git, or in a folder that is no repository, everything works:

- The settings take any folder; an unsaved session proposes the git root around the working
  directory, or the working directory itself.
- The Changes panel shows snapshots and checkpoints on their own, and git's status and diffs
  only where there is a repository.
- The files an agent turn changed are found by the time and size of every file the folder's
  `.gitignore` keeps, before and after the turn; a file whose size did not change is read only
  when its content was known before, so a file touched but not changed is not counted.
- The design-system setup keeps its snapshots in the tool's own snapshot store (0023, amended).
- The briefing mentions `.git` only when there is one.

**Writing to git is a project setting, off by default** (`"git": "on"` in the configuration).
Where git is installed and the folder is a repository, the tool reads it whatever the setting:
status, diffs, the branch, the user's name. Only with the setting on does the Changes panel
commit, or offer to make a folder a repository with `git init`. Nothing else writes to git.

**The user has a display name** in Settings, kept in the user's own directory
(`~/.ultrapaint/profile.json`), not in a project's configuration, which a team shares. It signs
comments and draws the avatar when git gives no name.

**The tool's own snapshot store** is in the state directory (`store/`): each file's contents once,
by SHA-256, and a manifest per snapshot naming the hash of each file. Refs per namespace keep
manifests; what nothing keeps is collected. The setup's snapshots are its first user; the revision
history ([PLAN-revision-history](../PLAN-revision-history.md)) is meant to be the second.

**A running server is found, not started twice.** The server writes `run.json` in its state
directory once it listens: its pid, port, URL and a token. A second start on the same project
reads it, checks that the process is alive and that the server on the port answers
`/api/health` with the same token, prints where the editor is and exits; a run file whose
process is gone, or whose port another server answers, is stale and written over. The file goes
when the server stops. An unsaved session has no state directory to find before it starts, so it
is never attached to.

**The token is an id, not a credential.** The server has no authentication, and this does not
add one: the token is random per run, carried by the run file, the ready line and `/api/health`,
so that whoever found a run file can tell the server on its port is the one that wrote it and not
one that took the port since. Anyone who can reach the port can read it.

**`--ready-json`** makes the server print one line of JSON on stdout once it listens,
`{"pid","port","token","url"}`, and send its logs to stderr; a server already running prints its
own line. It is how the app, or a command over SSH, learns where the server is. `--port 0` picks
a free port. The `ultrapaint` command uses the same line to know when to open the browser, and
so opens the running editor when it attached.

**`Platform` has the hooks the shell fills**, each absent in a browser: a native folder picker
(offered beside the folder's path in Settings), the preview's URL mapped through a forwarded port,
and a project switcher in the header's place for the project's name. The shell's preload script
sets them on `window.ultrapaintPlatform`; `serverUrl` stays the hook for a backend that is not the
page's origin.

### What Phase 1 added (the app with local projects)

**The app starts a server per open project and stops what it started.** It runs the server with
`--port 0 --ready-json --stop-with-stdin` (the server binds port 0 itself and names the port it
got; it stops when the pipe on its stdin closes, however the app went) and a session directory
of its own per project, for a folder without a configuration. A server that is already running
says so in its ready line (`attached`) and exits; the app opens that one and never stops it.
`/api/health` counts the agents at work (`working`), and the app asks before a switch, a restart
or a quit stops them. The project list is `projects.json` in the app's data.

**The app's environment is the login shell's.** `$SHELL -ilc` is asked once for `PATH` and a few
other variables (`launchctl getenv PATH` on macOS when it says nothing). The server, run as Node
by Electron's binary, takes `ELECTRON_RUN_AS_NODE` out of its environment before it starts
anything, and runs the preview on the user's `node`. Missing or old Node is a banner over the
editor (`Platform.notices`).

**The agents' adapters ship in the app; the agents do not.** claude-agent-acp and codex-acp are
bundled with esbuild into two files without their native binaries, and run through a small
wrapper that deletes `ELECTRON_RUN_AS_NODE` before importing the adapter, so neither the agent
nor its shell commands inherit it. The server is handed this as its agent runtime
(`ULTRAPAINT_AGENT_RUNTIME`, read and deleted in `bin.ts`): the built-in agents then start as
`<electron> run.mjs <adapter>`, with `CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH`, and the sandbox lets
them read Electron, the adapters and the agent's own directory. The command keeps `npx`.

**An agent is found where the user has it, and downloaded only when asked.** The path set in the
app's settings, then the login shell's `PATH`, then a copy the app downloaded. Sign-in is asked
of the agent itself (`claude auth status`, `codex login status`). A missing agent is offered as a
pinned release for the platform, checked by size and SHA-256 (Claude Code from its installer's
bucket, Codex's package from its GitHub release), unpacked into the app's data and nowhere else.
Codex signs in with ChatGPT through its adapter's `chat-gpt` method; Claude Code is not signed in
from the app (a third-party product may not offer claude.ai sign-in without approval): the user
runs `claude` once, or gives an API key, which the app keeps encrypted with the system's keychain
and passes to Claude Code's adapter alone. A change to an agent's path or key restarts the
project's server, and the editor comes back where it was.

**The app is packaged without an archive** (`asar: false`): the server, the adapters and the
preview's bundles are run by other processes and read through the sandbox's binds. Linux gets an
AppImage and a deb, macOS a dmg and a zip, unsigned; the Release workflow builds both and keeps
them as artifacts.

### What Phase 2 added (a new design from nothing)

**One code path writes a new design: `ultrapaint new`.** A design from nothing has no server
to ask before it is written, so the writing is a subcommand of the server's own binary, built on
the first-run setup's scaffold (0025), and the command and the app share it. The app runs it as
it runs a project's server (its binary as Node, the login shell's `PATH`) with
`--progress-json`, and shows each line as a step: the folder made, the configuration, designs
and code written, the packages installed, the first commit when git is on, then the app's own,
opening it. The first step that fails stops the rest and leaves what was written: the project
opens as it is, and running the same again finishes it (its configuration says the files are
written; a repository without a commit gets its first).

**The dialog is the editor's, in both places.** The welcome page is now a second page of the
editor's build (`welcome.html`), served to the window under the app's own scheme
(`ultrapaint://app/`), so the New design dialog is one component, with the editor's fields,
opened from the welcome page and from the project switcher. It reaches the app through
`Platform.newDesign`.

**The folder** is `~/Ultrapaint/<name>` unless another is picked, numbered (`<name> 2`) when
one is there, and must be empty or not there yet: a new design writes `.gitignore`, `src/` and
the like, and does not write over anyone's. **The code goes in `app/` by default**, beside
`designs/` and the configuration, so the folder's top level says what is design and what is code
and a designer finds the pages without going through `src/`; at the root is offered for a folder
meant to be one package.

**Blank means no components, not no code.** Pages render with the project's own React, so both
templates start a Vite, React and Tailwind application. **Blank** (the default) has no
components, an empty component directory the settings point at, and an `@theme` that declares
nothing: Define makes the design system from nothing, and the canvas draws rows, columns, text,
images and drafts (0029). **Starter components** is the scaffold's ten. Sync takes a component
directory with no source file in it for a project with no components yet, not for settings to
put right.

**The configuration is written last**, so a folder that has one has all its files, and the
server runs on it as a project from the start: its state directory, its run file, attaching.
With git on, it says so (`"git": "on"`). **Packages are installed with pnpm when it is on the
`PATH`, npm otherwise**: npm comes with Node, which the preview needs anyway, while `npx pnpm` or
Corepack would download a package manager on first use. Without Node, the install step says so,
the banner says how to install it, and the project is written to install later.

**It opens on Sync's define step**, as 0025's scratch case goes on once its application is
started: the app loads the editor with `?new-design=<template>`, and the editor reads the
template's inventory and goes past it (a template uses only its own theme), gives the starter's
components their specs with the design's look, as an application started from Sync gets them,
and shows Sync with Define next.

## Consequences

- A project need not be a repository, and a design starts in an empty folder (Phase 2 of the
  plan). On another machine over SSH (Phase 3) it is the same `ultrapaint new`, run there with
  `--progress-json`. Teams that commit their designs keep doing so with git; the tool commits only when asked
  to.
- The first snapshot of a project copies the files `.gitignore` keeps into the state directory;
  later ones cost what changed. A setup started by a version that kept its snapshots in git
  cannot be redone from them, and says so.
- An agent in a folder without `.git` could create one, with a `core.fsmonitor` the editor's next
  `git status` would run outside the sandbox (0013's concern). On macOS the sandbox's write denial
  on `.git` holds whether it exists or not. On Linux, where a read-only bind needs something to
  bind, the sandbox seals a missing `.git` with an empty read-only directory, whose mount point it
  removes when the session ends; and the editor refuses an agent's `fs/write_text_file` into any
  `.git`, which it carries out outside the sandbox.
- The Changes panel is to be redesigned; the revision history may take over much of it.
- Packaging (Electron builds, signing, updates) is the cost 0017 avoided, and is taken now that
  there is a reason: macOS and Linux first, no updates until the repository is public.
