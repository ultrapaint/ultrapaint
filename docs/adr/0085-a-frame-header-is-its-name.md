# ADR 0085: A frame's header is its name, and a page's own notes are in its toolbar

Status: accepted, 2026-11-12. Amends 0075 (the route shown on the canvas).

## Context

Over a page's frame the header said its name, its route, its size and, once the page had views,
its breakpoint. The route was a button: pressed, or caught by a drag meant for the frame, it
asked for a new route. The size said again what the breakpoint and the inspector say. And a
behaviour note written by an agent (ADR 0030) has no spot on the page, so its pin sat on the
frame's top-left corner, over the page's own corner and the header's start.

The person chose, from the variants drawn on the Redesign canvas (`frame-header.page.json`), the
quietest one: the name alone on the canvas, the page's notes shown when the page is selected.

## Decision

- **The header is the name**, and the breakpoint while the page has views (ADR 0036). The route
  and the size are the inspector's, where they already were.
- **A comment without a spot is the page's own.** One at 0 0 was written through a tool, never
  placed (`hasSpot`). It is not pinned on the canvas, nor in the prototype; it is drawn only while
  its card is open, at the corner as before.
- **The page's toolbar says them.** While the page is selected, its element toolbar ends with
  "1 note" (or "2 comments" when not all are behaviour notes), which opens the card; several are
  listed to pick from. The Comments panel lists them as it lists every comment.

## Consequences

- A page with notes looks like one without until it is selected; the Comments panel and the
  toolbar are where they are found.
- A comment the person places exactly on the page's corner pixel is taken for one without a spot.
- A note an agent writes on an element (with `nodeId`) is still at 0 0, so it too is in the page's
  toolbar rather than on its element. Pinning it on its element would need the element's place at
  the time it is drawn.
