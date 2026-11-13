# ADR 0091: The person’s folder can move

Status: accepted, 2026-11-13. Amends 0031 (where the desktop app makes new designs, what it
passes the servers it starts) and 0010 (the person’s folder, apart from the storage modes).

## Context

What is the person’s and not a project’s is kept in one folder, `~/.ultrapaint`: their name
(`profile.json`), the review models’ findings (`findings/`), what the chat remembers
(`chat/preferences.json`), custom agents (`agents/`), the tools `ultrapaint mcp` offers before
it finds a project (`mcp-tools.json`). The server calls it its `userDir`; the desktop app reads
it too, for the start screen’s models.

It moved only with `--home` (`ULTRAPAINT_HOME`), which also makes the storage `managed`:
settings and state in that folder, for `pnpm dev`. Nobody could keep their folder somewhere
else (a synced folder, a second disk) and go on saving projects beside their configuration.
The person asked for the folder to keep its name and be movable. The desktop app also makes new
projects in `~/Ultrapaint`, with no way to change it.

## Decision

**`--user-dir <dir>`, or `ULTRAPAINT_USER_DIR`, names the folder the person’s folder is in.**
The data lives in `<dir>/.ultrapaint`: the name stays, whatever the place, so the folder reads
the same in any file manager and a path in a message or a log still says what it is. The
folder given is always the parent; a path that ends in `.ultrapaint` gets one more. It is
relative to the working directory, resolved once in `bin.ts` into `ServerConfig.userDir`, and
in `ultrapaint mcp`, which passes it on to a server it starts. It changes nothing of the
storage: a configuration file, `--ephemeral` and `--home` keep their state where they did.
With `--home` and no `--user-dir`, the person’s folder is still the home, as before; with
both, `--user-dir` wins for the person’s folder.

**The project info says where the folders are** (contracts’ `ProjectFolders`, the info’s
`folders`): `user`, the person’s folder, absolute; and `project`, the project’s own state
folder (`<project>/.ultrapaint`) when its settings are saved to a configuration file. An
unsaved session’s state is a temporary or the app’s session folder, and `--home`’s is the
home: neither is the project’s, and neither is shown. Optional, for an editor talking to an
older server.

**The desktop app keeps both places in its own settings**, `folders.json` in its data folder
(`Folders`): the folder the person’s folder is in, the home folder unless moved; and the folder
new projects are made in, `~/Ultrapaint` unless changed. A choice that is the default again is
kept as no choice. Every local project’s server is started with `--user-dir`, read at each
start; the app reads the chat’s preferences from the same folder. Over SSH the remote machine’s
own folder is used and nothing is passed. `newDesign.folderFor` proposes new projects in the
chosen folder, and the start screen names it.

**Moving is the app’s, through the shell bridge** (`folders.*`, all of this machine only):

- `folders.current`: the person’s folder and the new projects’ folder.
- `folders.moveUser`: a native picker for the new place, then refused, with nothing stopped,
  when it is inside the person’s folder, is where the folder is already, or already holds a
  `.ultrapaint`. Otherwise the open project’s server stops (asking first when agents are at
  work, as a switch asks: **Stop and move**; told no, nothing moves), the folder is copied
  across with its timestamps, the setting saved, and only then the old folder removed; the
  server starts again on the new one and the editor comes back where it was
  (`OpenProject.whileStopped`). A copy that fails removes what it copied and leaves the folder
  and the setting as they were; an old folder that can’t be removed is said, with the move
  kept. The server is stopped rather than restarted after, so that nothing writes into the old
  folder between the copy and the restart. A server the app only attached to is not stopped:
  it keeps the folder it was started with.
- `folders.setNewProjects`: a native picker; the folder picked, or nothing when cancelled.
- `folders.open`: a folder shown in the system’s file manager (`shell.openPath`).

**Settings show the folders** (`FoldersGroup`, in About): Your folder, with Open and Move… in
the app, and in a browser a copy button and how to move it (`ULTRAPAINT_USER_DIR`); New
projects, with Change…, in the app; This project’s data, with Open in the app, when the project
has one. A move shows Moving… on its button, and a refusal says why under its row.

## Consequences

- The folder moves whole: whatever an older or newer version keeps there goes with it.
- `ultrapaint mcp` started by an outside agent, and the server it starts without a window, read
  `ULTRAPAINT_USER_DIR` from the agent’s environment, not the app’s setting: after a move in the
  app, the variable set in the shell the agents start from keeps them on the same folder.
  Otherwise they use `~/.ultrapaint`, which the move removed, and start a new one there.
- `pnpm dev` keeps `ULTRAPAINT_HOME`, and with it the person’s folder at `~/.ultrapaint`, unless
  `ULTRAPAINT_USER_DIR` is set too.
