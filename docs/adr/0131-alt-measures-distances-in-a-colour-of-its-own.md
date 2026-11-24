# ADR 0131: ⌥ measures the distances from the selection, in a canvas colour of its own

Status: accepted, 2026-11-24. Amends 0018 (the canvas's colours).

> Amended by [0138](0138-a-frame-snapped-to-an-edge-shows-the-line.md), 2026-11-24: `--measure` is
> also drawn on the line a page's frame moved by its name snaps to, with the space to the frame on
> it in a pill.

## Context

The canvas told a designer one element's size (the selection's size label, ADR 0086) and nothing
about the space between two elements, or between an element and the edges of what holds it. They
worked it out from the inspector's numbers. ⌥ (Alt) was already held over the canvas, for the
innermost node on click and hover and for a copy on a drag, and nothing drew while it was held.

The canvas had three colours, each with one meaning (0018): `--selection`, `--component` and
`--agent`. Red appeared on it only as `--destructive`, which outlines a failed variation. Nothing
was left to draw a measurement in without taking another's meaning.

## Decision

- **⌥ held measures from the selection.** With an element selected, ⌥ held over another element in
  the same frame draws lines from the selection's edges to the hovered one's, each with a pill
  giving the distance in the frame's pixels, rounded to the pixel. The hovered element is the
  innermost under the pointer, as ⌥ hovers; pressing ⌥ with the pointer at rest hit-tests again
  there at once, and letting go of it hovers again what a click would select: the innermost
  still while Ctrl or ⌘ stays held. Several selected are measured from the box around them.
- **What is drawn follows how the boxes lie** (the web's `measure`, pure). Apart on an axis: the
  space between their facing edges on it, across the middle of what they share on the other axis,
  or from the selection's middle with a dashed guide to the other box when they share nothing.
  Overlapping on both axes, one inside the other included: the distances between their matching
  edges, the four insets for one inside the other. A distance under half a pixel is not drawn.
- **The parent is measured too.** Pointing at the selection's parent gives the selection's insets
  in it. Pointing at the selection itself gives the same insets, its parent measured on demand
  through the frame (`frameOf(id).measure`) and read again each time the frame draws
  (`rendered`), so a parent covered whole by its children can still be measured; a page's root,
  which has no parent, draws nothing there. Several selected in one parent give the insets of
  the box around them in it; several in different parents draw nothing there. A layer of an
  instance is measured in the layer around it (0114). Empty page space is no element: nothing is
  measured to it.
- **It is drawn as chrome**, beside the selection's (`measure-overlay`), in the frame's pixels and
  outside the page's clip, its lines a pixel thick and its pills set as the size label at any zoom.
  The selection's size label gives way while it draws, where the pill of a distance from the
  selection's bottom edge would cover it. Only the frame the selection was made in draws it:
  another page, or another view of the same page, is another drawing.
- **It goes** as ⌥ is let go, as the window loses focus, as the pointer leaves the frame or every
  element, while a drag copies, and while a marquee is drawn, which hovers nothing. ⌥ typed in a
  field, or in a text edited on the canvas, measures nothing. A click with ⌥ still selects the
  innermost node. ⌥ pressed after a press is let go hit-tests where the pointer is now.
- **A fourth canvas colour, `--measure`**, kept for measuring alone (distances now, a later
  story's snapping lines): an orange-red, `oklch(0.58 0.18 40)`, the same in the light and the dark
  theme. Its hue (40) is away from `--destructive`'s (27 light, 25 dark), so a measurement never
  reads as a failure, and white 12px text on it reaches 4.6:1, which a lighter dark-theme value
  would not. DESIGN.md lists it among the colours and in "The canvas's own language" (0065).
- **Not a command.** Holding ⌥ is a modifier with the pointer, as ⌥-click is, so Settings ›
  Shortcuts does not list it (0090 is about commands).

## Consequences

- Spacing is read off the canvas, without sums.
- `--measure` is never used for an error, a selection or an agent, and nothing else is drawn in it.
- Measuring across frames, while dragging, or once ⌥ is let go is not offered.
