# ADR 0056: An Input holds its icon

Status: accepted, 2026-11-03. Adds a slot to the Input of 0040 and 0041. The terms are in
`GLOSSARY.md`.

## Context

The design skill tells agents that a field's icon is the field's own icon slot, at its start and
in the placeholder's colour (`references/components.md`). The system Input had no such slot, nor
had the starter application's Input, so in the design evals agents drew the icon beside a separate
Input or built the field by hand as a row, and lost to the reference every time.

## Decision

**The Input has a slot `input-icon` at its start** (`holds: "nodes"`, laid out as a row, not the
default slot): an instance's child naming it, an image tinted `currentColor` as a rule, is drawn
inside the field's box, centred on its height, the text starting after it. The Input's catalogue
description says so, the one line agents read about it; no tool description changes.

**The input keeps its part and its border.** The `input` part is still the `<input>`, so every
look that styles its border, padding, height and states keeps working. With an icon, the input and
the icon sit in a box of the editor's (`data-system="input-box"`, not a part) and the icon is laid
over the input's start: `0.75rem` from its edge, the text `2.25rem` in. The text's start is the
icon's place rather than a look's, so it wins over a look's start padding (a look's padding cannot
be read where the icon is placed); a look that moves the icon or changes its size changes where it
sits, not where the text starts. The icon part's colour is the default look's
(`$color-muted-foreground`, the placeholder's) and it dims with the field when disabled; a look
styles it as any part. Moving the border to a wrapper, as shadcn's input group does, would have
moved the `input` part's border, height and states off the element that has the focus, and broken
every look file that styles it.

**In the application it is a part, as every named slot is.** The Code tab writes the icon as an
`InputIcon` among the Input's children (`applicationNameOf`), as it writes a Dialog's footer; the
starter application's Input exports `InputIcon` and draws it the same way, with Tailwind.

## Consequences

- A field with an icon is one Input instance on the canvas and one `<Input>` in the code.
- The icon's offset and the text's start are fixed in the default layer: a design that wants them
  elsewhere cannot say so in the Input's look yet.
