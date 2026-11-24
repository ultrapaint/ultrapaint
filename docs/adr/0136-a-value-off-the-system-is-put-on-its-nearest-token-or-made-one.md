# ADR 0136: A value off the system is put on its nearest token, or made one

Status: accepted, 2026-11-24. Builds on 0045 (the design system's values edited in the editor),
0061 (values off the system, the general check), 0062 (the token presets) and 0054 (the reason is
for agents). Story: UP-129.

## Context

A field holding a value outside the design system said so with a dot and offered nothing more.
Bringing `#2563eb` onto the system meant guessing the closest token; keeping it meant leaving the
page for the Design system place, adding the token there, and coming back to pick it. Nothing
found a nearest token: the token table found only the tokens that hold a value exactly
(`tokensByValue`).

The field also disagreed with the off-system check about spacing. The check counts any whole or
half step of the scale as on the system (`spacingStepAt`, `isOffSystem`); the field counted only
the values it offered, which stop having half steps after 3.5, so 18px on a 4px base wore the
field's dot while the check called it on the system.

## Decision

- **The nearest token** (contracts' `nearest-token`, beside the token table, which the themes
  read, so it cannot live in it): the token of a kind nearest a value, each token read in a theme
  with the tokens it names followed (`valueInTheme`). A colour is measured in OKLab, the Euclidean
  distance between L (0 to 1), a and b, and offered only within 0.1: past that a "nearest" can
  plainly be another colour. A length is measured in pixels (a unitless zero as none, an absolute unit such as `pt`
  converted, an `em` only against an `em`), a
  weight and a unitless line height as numbers, with no limit: the value shown beside the name
  says how far it is. A spacing in pixels is nearest a whole or half step of the scale on the
  spacing base unless a named spacing is nearer. A font family and a shadow have no measure. Of
  two as near, the smaller value; of two colours as near, the first listed.
- **A field that knows its kind** offers two ways onto the system at the top of its list while
  its value is outside it and nothing is typed: **Use nearest**, with the token's name and what it
  comes to in the theme the view is drawn in (the boards' while a board view is open, else the
  canvas's), picked as an option is, and **New token from this value…**. Every field that takes a
  token has them, a system component's look's and a text style's included. A spacing step is
  written in pixels (`18`), as the list's steps are, never `$spacing-4.5`. A field that knows its
  kind asks `isOffSystem`, so the field and the check agree on every value: a half step of the
  spacing scale, a round radius (`50%`) and a keyword that is no value (`none`, `transparent`) are
  on the system.
- **New token** is a popover on the field: one name, started with the kind's prefix, or in a
  detailed system the namespace of what a colour field colours (a fill and a tint
  `background-color-`, a text `text-color-`, a border `border-color-`). The name is refused, in
  the Design system place's words, when a token has it, when it is not a token's name, and when it
  is of another kind than the field's, which would list the token where the field's are not.
  Enter adds; Escape and the close button let it go. No reason is asked (0054). Nothing is made
  while the field could not be written, such as while a point of the history is looked at.
- **One undo step for the token and the field.** `designSystem.edit` carries the field's edit:
  documents' edits (`edits`), or one system component's look change (`component`), made after its
  operations in the same journal step and under its label. The server writes the design system in
  the step that `documents.apply` or `ComponentService.change` opens (`alongside`), and follows it
  (baselines, the code, DESIGN.md) once the step is over. In the editor the field writes itself as
  any edit of it does (the view's breakpoint, an instance layer's override, a look's place), and
  the send that follows at once takes the token with it (`makeTokenFor`, `takeTokenMade`), so no
  field's write path is copied. A write that sends nothing at once leaves the token to be sent
  alone.

## Consequences

- A field's value outside the system is one pick from its nearest token, and a value chosen on
  purpose is one name from being a token, without leaving the page.
- Every way the editor sends a field's edit (`applyEdits`, `commitStyle`, `commitEdits`) asks for a
  token being made before it sends; a new way must too, or the token goes in a step of its own.
- Finding a value across a canvas (`read_page`'s match) reuses `nearestToken`; rewriting every use
  of a value is not this.
- A height has no token kind, so min and max height offer neither way.
