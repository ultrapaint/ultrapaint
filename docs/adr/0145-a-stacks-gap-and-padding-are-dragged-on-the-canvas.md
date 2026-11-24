# ADR 0145: A stack's gap and padding are dragged on the canvas

Status: accepted, 2026-11-24. Amends 0086 (the inspector, the one place a selection's fields are
edited).

## Context

A designer who wanted more room between a row's children, or inside a column's edges, left the
canvas for the inspector: the Layout section's Gap, or a side of the Spacing section's Padding,
picked from a list. Nothing on the canvas showed where the gap or the padding was, so the
designer also guessed which of the two made the space they were looking at. ADR 0086 made the
inspector the one place a selection's fields are edited, with one exception already: an
element's size, by a corner of its selection.

## Decision

- **A stack's spacing bands.** With one row, column or page selected (a node with the stack's
  fields, as its view draws it: a row turned column at a breakpoint is a column there), its
  selection's chrome carries a **spacing band** for each gap between two children next to each
  other in a line (each line of a wrapping stack) and one for each side of its padding. The
  pointer over a band draws it hatched in the selection's colour (blue on an element, purple on a
  component, ADR 0018) with a handle on it and a pill naming its value. Several selected, a
  group, a text, an image or an instance: no bands.
- **Worked out from what is drawn** (`spacing-bands`, pure): the stack's box and its children's
  boxes as the frame measures them, its padding and gap as its view draws them, held at what a
  drag gives them. A gap band is the space from one child to the next at the gap's own width,
  in the middle of a space a child's margin makes wider. The top and bottom padding bands run the
  box's width, the left and right between them, so a corner is one band's. A band of 0 is still
  grabbed, 6 pixels on screen at any zoom, inside the box.
- **No gap band where the alignment spreads the children** (Between, Around): the space drawn
  there is the alignment's, set in the inspector; the padding bands stay.
- **Dragged along its axis, snapped to the design system.** A press on a band drags it, and not
  the selection (`beginSpacingDrag`): a gap grows as the pointer moves along the stack, a padding
  side as it moves into the box. The length snaps to the nearest of the spacing scale's named
  steps over its base and the design system's named spacings (`spacing-gutter`), a named spacing
  winning over a step of its size and a token named as a step being that step; ⌘ (Ctrl
  elsewhere) follows the pointer to the pixel. The pill says the field, its pixels and the step
  or named spacing it is on ("Gap 16 · spacing-4"), the pixels alone off the scale. Shift sets
  both sides of a padding's axis: ⌥ already means deep select on the canvas and a copy on a drag.
- **Drawn live, saved once, as the inspector writes it.** While the pointer moves the frame draws
  the stack held at the dragged value, beside the held size of 0086 (`node-sizing`); a layer of
  an instance is drawn with it as the instance's override (ADR 0114). Let go, it is one edit,
  "Change the gap" or "Change the padding", through the node actions the inspector uses: at the
  view's breakpoint (ADR 0036), on an instance's layer as its override, a padding's other sides
  kept, a step written as its pixels and a named spacing as its token. Escape or a cancelled
  pointer puts the stack back as its document has it, and nothing is saved.
- **The inspector stays the place for every field.** The canvas edits two of them by dragging,
  as it edits an element's size by a corner; margin, the padding of anything but a stack, and
  several stacks at once stay the inspector's.

## Consequences

- A press on a padding band, or within a few pixels of a stack's edge when its padding is 0,
  drags the spacing rather than moving the selection or reaching the child under it; anywhere
  else on the selection behaves as before.
- While ⌥ measures the bands are put away, so the pointer reaches the measurement and the deep
  select.
- A held size of an instance's layer is drawn live too, as its override, where it was drawn only
  once saved.
