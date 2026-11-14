# ADR 0092: A first run just starts

Status: accepted, 2026-11-13. Amends 0062 (a folder opened for the first time is set up in a
chat) and 0073 (the setup is suggested while the settings are detected, under a title bar's
warning).

## Context

Ultrapaint opened on a folder with no `ultrapaint.config.json` (the `ultrapaint` command run in
it, or the desktop app's Open project) opened it only when it held an app. An empty folder failed
validation ("No package.json for the pages to resolve their imports from"), and the editor said
"No folder open" and sent the person to Settings › Repository, a page of path fields. A folder
with an app opened on detected settings, but the title bar carried a yellow "Not saved" chip, the
Agents list said the settings were "detected, not saved" and offered "Set up <folder>" as a chore,
and keeping them took the Save to file… dialog. The person decided: the folder is the project, and
the editor just starts.

## Decision

- **Any folder opens as a project.** An application is optional: the pages draw Ultrapaint's own
  components, so a folder without a package.json is valid. An application named (`resolveFrom`)
  must still be a package. Detection's settings are used as they are, the designs directory
  (`docs/designs` unless detection found one) among them while it is not there yet: the first
  change makes it (amended 2026-11-14; it was made as the folder opened). The
  home directory and the filesystem's root are the exception: a command run there was run in the
  wrong place, nothing is written, and the editor says "No folder open".
- **The settings are written on the first change** (the **first-change save**). A session started
  where no configuration was found (`saveOnChange`, not `--ephemeral`) writes
  `ultrapaint.config.json` into its folder, as Save to file… does, on the first change the person
  makes: a design file written through the editor or by an agent's tool, or a prompt sent to an
  agent. The server does it (`ProjectManager.changed`), so the agents' writes count as the
  editor's do; what only the watcher sees (a checkout, a file written by hand, an agent's shell)
  does not, and an agent's shell was preceded by its prompt anyway. It is tried once: the editor
  says "Saved this folder’s settings" with a way to Settings, or, when the folder refuses the file,
  why, and the change stands either way. A run started with `--ephemeral` never saves.
- **No "Not saved" chip** for a session that saves on the first change. A run that never saves
  (`--ephemeral`) keeps a quiet chip, its tooltip saying why.
- **The setup chat is optional.** The Agents list with no chats says the folder is ready to design
  in and that an agent can check what Ultrapaint found in it, *Check settings…*, which drafts
  `/setup` in a new chat's composer for the person to send (0073, 0074); a new chat's first
  starter is *Check what Ultrapaint found*. Once the first change has saved the settings, neither
  is offered.
- **"No folder open"** (the home directory or the root only now) picks a folder with the shell's
  native picker where there is one, and opens it as this session's project; otherwise its button
  opens Settings › Repository, where a path is typed.

## Consequences

- A folder only looked at is left as it was: an empty folder gets `docs/designs/`,
  `ultrapaint.config.json` and `.ultrapaint/` on the first change, and nothing before. Settings
  saved that keep the designs directory in force (a setting changed, Save to file…) make it as
  they are saved, so they count as that first change too. Until then
  the designs' watcher looks for the directory each second, and once it is there tells what is
  in it and watches it, so an agent's shell that makes it is seen too; a directory removed (a
  checkout) is looked for again the same way.
- Settings is for changing things later. Its Repository section's "Detected, not saved yet" and
  Save to file… describe a state a session leaves at its first change; Save to file… stays for a
  session that hasn't changed anything yet, or that runs with `--ephemeral`.
- Saving to a file writes the file before the session moves its state next to it, so a folder that
  refuses the file leaves the session unsaved and as it was, and Save to file… says why too.
