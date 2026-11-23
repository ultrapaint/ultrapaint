# ADR 0121: Frames picked together are inspected as their roots, once the marquee is let go, and Shift or ⌘ adds one

Status: accepted, 2026-11-23. Amends 0058 (what the right panel shows).

## Context

A marquee drawn over the canvas's ground picks the frames it touches as it is drawn
(`canvas-picks`). The right panel counted those picks as something to show, so it opened while the
marquee was still being drawn, and what it showed was a note, "3 frames", with no field: several
pages could be moved and deleted together, never changed together. The person asked for Figma's
experience: nothing while dragging, and once let go the fields the frames share, a value they
differ on mixed, changed on all of them at once; and, with a frame selected, Shift or ⌘ held to
click other frames into the selection.

## Decision

- **Nothing while it is drawn.** Frames a marquee is still drawing are only outlined on the
  canvas; they are not the right panel's subject, and the inspector has nothing of them.
- **Their roots once let go.** Several frames picked are inspected as their roots, a page's or a
  node's on the canvas, as several nodes selected are: headed "N frames", each section a field
  they share, `MIXED` where they differ, and an edit there changes each root in its own document
  (`actedOn` takes them when nothing is selected). They stay picked through the edit.
- **Shift or ⌘/Ctrl adds a frame.** A frame's name clicked with Shift or ⌘/Ctrl (Ctrl where there
  is no ⌘) is added to the frames picked, or taken out when it is one of them; so is a frame
  clicked anywhere inside while frames are picked as wholes (several, or one page or canvas node
  selected by itself) and it is not that one frame. One left is the selection. Inside the one
  frame selected, and with a layer of a page selected, the keys keep their meaning there: Shift
  adds a layer, ⌘/Ctrl takes the innermost (0114).
- What a page alone shows (its route, viewport and views, its variations and behaviour notes) is
  not shown for several, as for several nodes.

## Consequences

- An edit of several frames is one change per document, undone as one.
