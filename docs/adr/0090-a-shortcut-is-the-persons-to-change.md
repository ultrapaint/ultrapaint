# ADR 0090: A shortcut is the person's to change

Status: accepted, 2026-11-13. Amends 0032 (the command list's keys are now its defaults).

## Context

Every key the editor answers to was fixed in the command list (`apps/web/src/lib/commands.ts`),
and the `?` sheet listed them read-only. People come from Figma, Sketch and their own habits, and
one layout's keys sit badly on another's. The redesigned Settings have a Shortcuts section, and
the person approved one where each shortcut can be recorded anew and reset, as T3 Code's
keybindings page does.

## Decision

**A command's keys in the list are its defaults; the person may give it others, or none.**

- The person's keys are a preference of theirs, not the project's: kept in the browser as the
  theme and the send key are (`ultrapaint:keybindings`, `apps/web/src/state/keybindings.ts`), a
  command's id → the chords that replace its own. An empty list takes its keys away. Keys
  recorded the same as the default keep nothing.
- Keys the person gives a command replace its shown keys and its unshown ones (`also`: Delete
  beside ⌫) alike. Whatever matches or shows keys reads them now (`keysNow`, `chordsNow`): the
  key handler, the palette, the menus, the tooltips (`CommandKeys`), the `?` sheet.
- Settings › Shortcuts (`ShortcutsSection`, `apps/web/src/panels/settings-shortcuts.tsx`) lists
  every command that has keys or may be given some, in the palette's groups, with a search by
  name or keys (`⌘Z`, `mod+z`). Clicking a command's keys records the next chord pressed, saved
  at once (ADR 0079); Escape cancels, Backspace or Delete takes the keys away, Tab leaves. A
  changed command has a reset button after its name; Reset all, with Undo in its toast, sits by
  the search while anything is changed.
- A chord is refused, under the row (`apps/web/src/lib/rebind.ts`):
  - when another command reached with this one has it, shown or not ("⌘D is Duplicate’s
    shortcut."), with Use it here, which takes it from that command. The window's scopes are
    reached together; what has the focus (a row of the Layers panel) is reached alone and goes
    first, so its keys and the window's may be the same, as they were;
  - when the browser or the system keeps it: ⌘W, ⌘Q, ⌘T, ⌘N, ⌘L, ⌘R;
  - for a command that works in a text field, when it would type there: it needs ⌘, ⌃ or ⌥, or
    is a function key.
- Reset is refused the same way while another command has one of the default keys now: the
  person gave it that one.
- Some keys stay as they are, shown but not recordable: copy, cut and paste, which the browser
  turns into its clipboard events, and the arrows that walk the selection or the Layers tree,
  whose command reads which one was pressed (`fixed`).

## Consequences

- A recorded chord is written for the platform it was recorded on (`mod+u`, `ctrl+1`), as the
  list writes a chord; a chord the list writes per platform keeps its two forms only while it is
  the default.
- The keys a person sets don't follow them to another browser or to the desktop app's other
  profile.
- Matching by what a key types, or by where it sits, is the list's (`keys.ts`); a recorded chord
  is written so it matches the same way (`chordOf`).
