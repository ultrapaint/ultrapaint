# ADR 0010: Where settings and state are kept

Status: accepted, 2026-09-17. Replaces step 2.3 of the plan ("settings and tool home").

## Context

The server kept everything in one directory, `~/.ultrapaint`: the settings, agent threads,
checkpoints and the catalogue cache. The desktop app, `pnpm dev` and the `ultrapaint` command
all shared it, and `settings.json` held the absolute path of the repository, so it could not
be shared with anyone. Two ways of using the tool need different answers: the desktop app owns
its settings, and the command is run in a repository whose setup belongs to the team.

## Decision

The storage target is decided once, in `bin.ts`, and carried in `ServerConfig`:

| Mode | When | Settings | State |
|------|------|----------|-------|
| `managed` | `--home <dir>`; the desktop app always passes it | `<home>/settings.json` | `<home>` |
| `file` | `--config <file>`, or the nearest `ultrapaint.json` from the working directory up | that file | `.ultrapaint/` next to it |
| `ephemeral` | neither, or `--ephemeral` | memory | a temporary directory, removed on exit |

- One schema on disk, `ProjectConfig`: the wire `Settings` with `repoPath` optional and relative
  to the file, arrays optional, `$schema` kept. A file in a repository is written without a
  machine path and with sorted keys; the desktop's file keeps its absolute path, so existing
  files load unchanged. `Settings` at runtime and on the wire is always resolved.
- A configuration file that was passed or found and cannot be read stops the server. It is
  never replaced. Only the desktop's own file is ignored with a warning, as before.
- A file in a repository is watched; a change by an editor or a branch switch reopens the
  project. The server tells its own writes apart by remembering the text it wrote.
- The `Storage` service owns the state directory. Services ask it at the moment of use, because
  `settings.persist` turns an ephemeral session into a `file` one while it runs: the target is
  switched first, then the state is copied without overwriting, so whatever a concurrent write
  put in the new directory is kept as the newer version.
- A state directory inside a repository gets a `.gitignore` containing `*`, like the preview's
  generated directory, so transcripts cannot be committed whatever the repository ignores.
- Custom agents are user-level and only ever read: `<home>/agents` in `managed` mode,
  `~/.ultrapaint/agents` otherwise. An ephemeral session creates nothing under the home.
- `ProjectInfo.storage` carries the mode to the editor, which shows a "Not saved" control in
  the top bar and a dialog that calls `settings.persist`.

## Consequences

- Running the bare command in a directory without `ultrapaint.json` no longer reads
  `~/.ultrapaint/settings.json`. The dev runner passes `ULTRAPAINT_HOME` unless it is given
  `--config` or `--ephemeral`, so development keeps its state.
- "Not saved" is about the configuration and the agent threads. Screens are files of the
  repository and are written there in every mode.
- `theme` is part of the shared file although it is arguably a personal preference.
