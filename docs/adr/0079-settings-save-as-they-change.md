# ADR 0079: Settings save as they change

Status: accepted, 2026-11-11. Amends 0063 (item 8: every section's footer is now Done). Amended
2026-11-11: the dialog has no footer and no Done; the close button is its one way out.

## Context

The project's settings (Repository, Design system, the Agents' review and design skills) waited
in a draft for a Save button, while Preferences and New chats saved as they were picked; 0063 gave
those sections a Done footer and had it name the other sections' unsaved edits. Two ways of saving
in one dialog, and the person asked why there was a Save at all, since it is all local. A review
also found the display name's save answer written back into the field while it was being typed.

## Decision

**Every setting saves as it changes; there is no Save button.**

- A switch, a choice or a select saves at once. The display name saves after a pause in typing or
  when its field is left. A path (the repository, the designs directory, the application, the
  component directories, the stylesheets) saves when its field is left, Enter included: a path
  half typed names another folder, or one that doesn't exist, and the repository's would open it.
  What still waits is saved when the dialog closes.
- One save runs at a time, each with the latest value (`useAutosave`, `apps/web/src/lib/
  autosave.ts`), so an older answer never lands after a newer save. A save's answer never writes
  into a field; fields are not disabled while one runs.
- Nothing says a change was saved. One that wasn't says why under the row it was made in, and the
  reasons about a row go under that row, as a refused save's did.
- Detect saves what it fills in, with Undo in its toast. On a first run the proposal fills only
  the fields not changed meanwhile and is saved with the first change.
- The dialog has no footer and no Done (amended): the close button, or Escape, is its one way out,
  and closing saves what waits; a save that fails once the dialog is closed says why in a toast.
  Where changes are written is the Configuration file row at the end of Repository, with Rename
  while the file has its earlier name and Save to file… in a session with no configuration file.

## Consequences

- A configuration file in the repository is written at each change, not once per visit to the
  dialog.
- Cancel is gone: Undo is offered only for Detect.
- A setting refused by the server (a path that doesn't exist) stays in the form, not in force,
  until the next change saves.
