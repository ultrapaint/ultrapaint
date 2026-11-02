# ADR 0035: `design.tokens.json` holds the values

Status: accepted, 2026-10-26. Amends 0028 (`design.tokens.json` is no longer an export compared in
Sync: it is where the values are kept). Plan: `docs/plans/done/PLAN-editor-renderer.md`, task 5.3.

## Context

Since 0028 every token's value was kept twice: in `design-system.json`, which the tool read, and
in `design.tokens.json`, written beside it with every change for Style Dictionary, Tokens Studio
and Figma's variables. Another tool could write the file back, so it was a Sync source of its own
(`dtcg`), compared with the design system against a baseline kept in `design-system.json`
(`designTokens`); while the file held another tool's values, the editor stopped writing it and
Sync waited for the user to take them. Two copies of every value, a baseline to keep them
apart, a step of Sync and a panel to settle them.

## Decision

**`design.tokens.json` holds every token's value**, in the Design Tokens format as 0028 writes
it. `design-system.json` keeps the rest: the tokens' names, groups and descriptions, the line
height paired with a font size, text styles, elevation, icons, what each component is for, and
the baselines with the code, Figma and `DESIGN.md`. It has no `value`, no `values` and no spacing
base.

**The tool reads both.** The design system is `design-system.json` with the values of
`design.tokens.json` laid over it: the file's value wins where both have one, and a token only the
file has is listed where its kind goes. A value neither has is the code's, as before.

**Another tool's change to the file is the design's value**, as soon as the file is read again.
Nothing is held and nothing waits in Sync.

**A change in the editor writes both files**, in one undo step: `design-system.json` without
values, `design.tokens.json` with them. While `design.tokens.json` does not read, the design
system is shown with `design-system.json`'s and the code's values and says why, and nothing is
written: writing it again would lose the values it holds.

**What goes:** the `designTokens` baseline, the `dtcg` Sync source and its comparison, the
"Take design.tokens.json's changes" step and its panel.

## Consequences

- A `design-system.json` written before this still reads, its values with it; the tokens file's
  win, and the next change moves the values out.
- An agent writes values through `write_design_system`, as before. One that writes
  `design-system.json` by hand puts the values in it and deletes `design.tokens.json`, whose
  values would otherwise win.
- A value edited by hand in `design-system.json` while `design.tokens.json` has one is not read.
- The code, Figma and `DESIGN.md` stay sides compared with the design system, as 0028 says.
