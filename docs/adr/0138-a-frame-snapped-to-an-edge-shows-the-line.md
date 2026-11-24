# ADR 0138: A frame snapped to another's edge shows the line it lined up with

Status: accepted, 2026-11-24. Amends 0131 (what `--measure` is drawn on).

## Context

A page's frame moved by its name, with the grid off and neither Shift nor ⌘/Ctrl held, lines up
with the edges of the frames around it within 8 screen pixels (`placeFrame`, `snapToEdges`). The
designer felt the jump and saw nothing: which frame it lined up with, and how far apart the two
now were, were lost inside `snapToEdges`, which returned only the frame. Its loop kept the last
edge within reach rather than the nearest, so the edge it took depended on the order of the
frames, and nothing could draw it again.

## Decision

- **The nearest edge wins.** On each axis, of the edges within reach of one of the frame's own,
  the nearest is the one it lines up with, a tie going to the frame nearest along the other axis.
  The edge drawn is always the one the frame was placed at.
- **The line is drawn while it snaps.** Each axis the frame snaps on gives a line along the
  matched edge (`SnapGuide`, from the pure `snap`), running across the frame and every frame with
  an edge at that place, a column of pages included.
- **The space is in a pill.** The pill on the line gives the space between the frame and the
  nearest frame on it, along the line, in canvas pixels rounded to the pixel. Frames that touch or
  overlap along the line have no space between them: the line has no pill, which never says 0.
- **In `--measure`, at its size on screen.** It is a measurement (0131's colour, whose ADR kept it
  for this), drawn above the frames in the canvas's coordinates (`snap-overlay`), its line a pixel
  thick and its pill set as ⌥'s pills at any zoom.
- **State of the gesture.** The move puts the lines in a small store (`snap-guides`) and takes them
  away when the frame no longer snaps; letting go, Escape and a cancelled pointer take them away
  too. What is saved is unchanged: the frame where it was placed, rounded to the pixel.
- **Only where snapping is.** The grid on, Shift or ⌘/Ctrl held, frames picked and moved together,
  a resize and a node on the canvas snap to no frame's edge, and draw no line.

## Consequences

- A designer sees which frame a page lined up with, and the space to it, without reading
  positions.
- A frame moved near several edges lands on the one nearest it, whatever order the frames are in.
- Snapping to centres or to equal spacing, and snapping where there is none (a resize, several
  frames, a node), are not offered; each would be a change of snapping, not of showing it.
