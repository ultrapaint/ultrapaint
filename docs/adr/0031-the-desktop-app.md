# ADR 0031: A desktop app around the same server and web build

Status: accepted, 2026-10-26. Amends 0017 (the desktop shell returns, for a reason written down
here), 0004, 0013, 0018 and 0023 (git is no longer needed). Builds on 0008, 0010 and 0019. The
work is planned in [PLAN-desktop](../plans/done/PLAN-desktop.md); this records its decisions and what Phase 0
changed in the server and the editor, and what Phases 1, 2 and 3 added.

> Writing to git amended by [0087](0087-the-designs-history-is-ultrapaints-and-git-is-apart.md),
> 2026-11-12: there is no setting; in a repository the Changes panel commits what the person
> ticks when they press Commit, and nothing makes a folder a repository but `ultrapaint new --git`.

> Amended by [0034](0034-frames-in-the-editors-page.md), 2026-10-26: the editor imports the
> preview through its own server (`/preview/`), so over SSH the app forwards the server's port
> alone. `Platform.mapPreviewUrl`, the preload's synchronous IPC and the forward made again when
> the preview moves are gone. The user's Node still runs the preview's Vite.
>
> Amended 2026-10-28 ([PLAN-architecture-2](../plans/done/PLAN-architecture-2.md), step 8): a built-in
> agent is one descriptor in acp's `built-in` (its `npx` launch, its adapter's package and bundle,
> its program and the variable that names it to the adapter, its sign-in probe and parser, a
> sign-in through its adapter, its key's variable, its variables by where it was found). The
> server's launches, the app's `Agents`, the bundling of the adapters and the downloads read the
> list; the ids are contracts' `BuiltInAgentId`, which the list must name exactly. The pinned
> releases stay the app's own table, keyed by those ids. The bridge says what the app signs an
> agent in with (`signInWith: "ChatGPT"`) rather than `signIn: "chatgpt" | "terminal"`.
>
> Amended 2026-11-10: a project can be removed from the list, in the switcher and on the start
> screen. Its entry goes, and the session the app kept for it (`<userData>/sessions/<id>`); its
> folder stays, here or on another machine, and the open project is refused. The removal asks
> first when it would delete work kept nowhere else: the session holds something and the folder
> has no configuration, beside which a saved project keeps everything. A project on another
> machine never asks: its session is there, and stays. A downloaded agent whose version is not
> the one the app pins counts as not installed, until the pinned one is downloaded in its place.
> The `new-design` address parameter went with the dialog that read it
> ([0062](0062-a-new-person-starts-from-a-prompt-or-a-project.md)).

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
history ([PLAN-revision-history](../plans/PLAN-revision-history.md)) is meant to be the second.

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

### What Phase 3 added (projects over SSH)

**A project is a local folder or a folder on another machine.** The list's second kind, `ssh`,
keeps a host as `ssh` takes it (an alias of `~/.ssh/config`, a host name, `user@host`, with a
port when one is typed as `user@host:port`), a path there (absolute or `~/…`) and, when it is not
`ultrapaint`, the command that runs the server there (`node ~/ultrapaint/scripts/cli.ts`, say).
Lists written before keep reading. **Open over SSH…**, on the welcome page and in the switcher,
is a dialog of three of the editor's fields, the host offering the `Host` aliases of the user's
configuration and of the files it includes, patterns aside.

**The app runs the system's `ssh`, not a library of its own**, so the user's configuration, keys,
agent, `ProxyJump` and known hosts apply as in a terminal. What the app relies on is given on the
command line, which wins over the configuration: `BatchMode`, no terminal, no `RemoteCommand`,
none of the configuration's forwards, a `ControlMaster` in the foreground. One connection per
open project: a master on a socket in a private temporary directory, whose own session runs `cat`
and ends when the app's end of its stdin closes, so that the connection goes with the app however
the app goes; the server in a second session on it; the ports forwarded on it with
`ssh -O forward`. The socket's directory goes with the project.

**A password or a passphrase is not asked for.** `BatchMode` makes `ssh` fail rather than prompt,
and the app says what to do instead: load the key into the agent (`ssh-add`), or set one up
(`ssh-copy-id`). A prompt in the window fed to `SSH_ASKPASS`, as T3 Code has, is left for when
someone needs it: a machine one designs on every day has a key in the agent. An unknown host key
is not accepted on the user's behalf either: they are told to connect once in a terminal and
check it there.

**The server is started by the remote user's login shell**, interactive as the app's own is read
(D6), so that what its startup files put on the `PATH` (fnm, nvm, Volta, `~/.local/bin`) is there;
it runs a POSIX script whatever that shell's syntax: into the folder, then `<command> --host
127.0.0.1 --port 0 --ready-json --stop-with-stdin --session-dir
~/.ultrapaint/desktop-sessions/<id>`, each word quoted for both shells. The ready line comes back
over `ssh`; `attached` says the project's server was running there already, which the app then
neither stops nor asks about, as for a local one. The remote machine needs Node.js and the
`ultrapaint` command; neither is uploaded (a pinned runtime the app brings is later). Failures say
which: the host unreachable, its key unknown, no key accepted, the folder missing (the script's own
exit code), the command or Node not found (exit 127, told apart by what the shell said), the server
stopping before its ready line (its last lines). The app's agent runtime is not sent, nor any
`ULTRAPAINT_` variable: the server there runs the remote machine's agents through `npx`, as the
command does, and a remote project's editor shows the server's agents rather than the app's, and
no banner about this machine's Node.

**`ultrapaint` passes `--stop-with-stdin` on.** The command gives the server its own stdin when
asked to stop with it (it gave none, which a server watching stdin took for the end at once),
opens no browser and keeps stdout to the ready line when `--ready-json` is asked for (whoever asked
opens the editor), and serves a `--web-dist` it is given as it is, without building the
checkout's editor.

**Ports are forwarded to loopback here, and the preview's URL rewritten to them.** The server's
port goes to a free local port and the window loads the editor from there: the server's host and
origin checks take `127.0.0.1` as for a local server, and the editor's socket and Vite's live
updates go through the forward as any connection does. The preview starts later, and moves when it
starts again, on a port only the remote machine knows. `Platform.mapPreviewUrl` is synchronous, so
the preload script asks the main process synchronously the first time it sees a preview URL; the
main process forwards that port then (a few milliseconds over the master) and answers the URL
through it, path and query kept, and the page keeps the answer. A preview at another port is
forwarded in its turn and the old forward cancelled. The forward is made when the editor first
asks rather than ahead of it by watching the server's state: the page waits once per start of the
preview, and nothing polls.

**A dropped connection is made again.** The master exiting (`ServerAliveInterval` notices a dead
link within half a minute), the server's session ending, or, for a server only attached to, its
health check going unanswered, starts a reconnection: at once, then after 1, 2, 4… seconds up to
half a minute, the canvas saying **Reconnecting to <host>…** with the last error as its detail
(`Platform.shellStatus`). The ports are forwarded again on the local ports they had, so the
editor's socket finds its server where it was and the page is not reloaded; it is, in the same
place, when a port was taken meanwhile or the server is another run. A server still running is
attached to; the app's own, found again after a drop its session did not survive, is still the
app's to stop, which it does by the pid of its ready line once its port answers with its token.
Switching projects or quitting stops what the app started there and closes the connection;
nothing is left running on either machine.

**For trying it without another machine**, `ULTRAPAINT_DESKTOP_SSH_CONFIG` points every `ssh` the
app runs, and the hosts it suggests, at another configuration: a throwaway `sshd` on loopback with
keys and known hosts of its own, as the app's tests run one.

## Consequences

- A project need not be a repository, and a design starts in an empty folder (Phase 2 of the
  plan). On another machine over SSH it is the same `ultrapaint new`, run there; the app's
  New design dialog writes on this machine only, for now. Teams that commit their designs keep doing so with git; the tool commits only when asked
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
