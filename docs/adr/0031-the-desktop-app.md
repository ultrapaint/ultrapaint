# ADR 0031: A desktop app around the same server and web build

Status: accepted, 2026-10-26. Amends 0017 (the desktop shell returns, for a reason written down
here), 0004, 0013, 0018 and 0023 (git is no longer needed). Builds on 0008, 0010 and 0019. The
work is planned in [PLAN-desktop](../PLAN-desktop.md); this records its decisions and what Phase 0
changed in the server and the editor.

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

## Consequences

- A project need not be a repository, and a design can start in an empty folder (Phase 2 of the
  plan). Teams that commit their designs keep doing so with git; the tool commits only when asked
  to.
- The first snapshot of a project copies the files `.gitignore` keeps into the state directory;
  later ones cost what changed. A setup started by a version that kept its snapshots in git
  cannot be redone from them, and says so.
- An agent in a folder without `.git` could create one. On macOS the sandbox's write denial on
  `.git` holds whether it exists or not; on Linux the read-only bind applies only to a `.git` that
  exists when the session starts, so a `.git` an agent creates is writable to it, and the editor
  reads git there afterwards (0013's concern). To close before the desktop app ships on Linux.
- The Changes panel is to be redesigned; the revision history may take over much of it.
- Packaging (Electron builds, signing, updates) is the cost 0017 avoided, and is taken now that
  there is a reason: macOS and Linux first, no updates until the repository is public.
