# ADR 0146: A colour field draws its palettes as swatches

Status: accepted, 2026-11-24.

## Context

A colour field's list was one long column: `tokenOptions` flattened every colour group of the
design system into rows, each naming its group. A design system with a few palettes holds dozens
of shades, eleven a palette at the ramp's steps, and a designer looking for `blue-600` scrolled
past every shade before it while the semantic colours, the ones a screen should use first, were
lost among them. The editor already told a palette from any other group (`isRamp`, which the
colour boards draw as ramps, ADR 0045); the field did not. Groups carry no type of their own.

## Decision

- **The field's list is for picking a node's colour from the design system** (ADR 0102): the
  colours a screen should use first at the top, and every shade a palette offers where a designer
  looks for it, by its step.
- **A palette is a ramp.** A group is drawn as a palette when `isRamp` finds it (three shades or
  more, every one named at a step) and its shades are each at a step of their own: a group whose
  shades share a step (`sky-100`, `sea-100`) stays in the list, where none of them is lost. `isRamp` lives beside
  `shadeOf` in design-document's `ramp`, which the boards and the field both read. No type is
  added to a token group.
- **The options carry it.** `tokenOptions(…, "color")` marks a palette's option with its `shade`
  (the palette, the step, the colour its swatch is), so every colour field (a fill, a text's
  colour, a border's colour, an image's tint, a system component's look) gets the grid through
  the options it already reads, and no caller changes.
- **Rows of swatches while nothing is typed.** The style combobox draws its options split by
  `splitPalettes`: the other options as the list at the top, in their order; then one row of
  swatches per palette, named for it, lightest first; then Clear. Base UI's `grid` lays it out,
  every row a `Combobox.Row`, so the arrow keys go along a palette and up and down from one row to
  the next; Enter or a click takes the token. Typing a query gives the plain list back, palettes'
  shades included, each with its group; clearing it brings the grid back. A field with no palette
  draws its list as before.
- **The steps line up.** A palette at the ramp's steps has a place at each of the eleven
  (`RAMP_STEPS`), empty where it has no shade, so a column is one step across the palettes and up
  and down keep it. An empty place is an item drawn hidden and disabled, which no key or pointer
  lands on. Left and right go to the next shade. Up and down into or out of a palette go to the
  nearest shade at the place, the lower of two as near, and from a list row to the palette's first
  shade: Base UI's grid looks only at the place and before it, so the field takes those keys and
  hands the highlight to the shade as a pointer moving over it does, Base UI leaving items no
  other way in while the focus stays in the input. A palette at steps of its own (`chart-1` to
  `chart-5`) is its shades in step order, so it never shifts the others.
- **The swatch is read under the grid.** The name and recorded value of the swatch the keyboard or
  the pointer is on, else of the field's own colour, show in a line under the palettes. Each
  swatch is named for its token and each row for its palette, for a screen reader. The field's
  colour is marked as selected.

## Consequences

- The semantic colours are the first thing a colour field shows, and a shade is found by its place
  in the ramp rather than by scrolling.
- A group named like a ramp but meant as roles (three or more tokens all ending in a number) is
  drawn as a palette. A group the person wants drawn as one is named as one.
- Swatches show a token's recorded value, as the list's swatches do, not the theme of the view.
- Fields of other kinds (spacing, radius, type) keep their lists.
