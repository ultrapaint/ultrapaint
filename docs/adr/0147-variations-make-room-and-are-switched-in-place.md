# ADR 0147: Variations make room beside their page, and are switched in place

Status: accepted, 2026-11-25. Amends 0098 (choosing among the variations laid out beside the
page). Leaves UP-171 (where a new frame goes) to its own story.

## Context

On 25 Nov the person reviewed four variations of the Workbench page's side menu. Laid out beside
the page as 0098 lays them out, they lay over the frames already there: the Workbench menu page
to the right and a sign-in page under it. A variation is drawn straight on the canvas, so the
faded pages showed through it ("Sign in to Interroll" and "Continue" read inside two of them).
What each varied ("Hover fill", "Hover left bar") was cut in half under its name.

Both were built as 0098 decided:

- `besideBoxes` placed the variations from the page alone, and 0098 chose to let them lie over a
  neighbour under a scrim rather than move pages the person placed.
- The header over a variation was a frame's header: one line `24px` high, the name and what it
  varied side by side, what did not fit wrapping out of the line under `overflow: hidden`. Over a
  narrow thing (a side menu) what it varied always wrapped, and half of the second line showed.

The person asked that variations never open on top of other things, and for an easy way, close
to Done, to see each variation where it would end up, inside its page. On UP-171 they had
already said how a canvas should make room: by shifting what is in the way rather than drawing
over it.

## Decision

**What is in the way is drawn aside while the variations are open.**

- The room the variations take is their boxes and the names over the first row
  (`besideRoom`). Every frame that crowds it, a page, a view or a node beside the pages (the
  other boards, on a component's board view), is drawn to the right, past it, by one distance;
  a frame to the right of one that moves, and that it would crowd, moves with it, so what moves
  keeps its places and lands on nothing (contracts' `roomFor`, which UP-171 can reuse). What is
  left of the room, or above or under it clear of it, stays.
- Nothing is written: the distances are the variations store's `room`, which the canvas draws
  frames with (`asideBy`). Closed, every frame is back where it was. This keeps 0098's reason
  against moving the neighbours, which was moving pages the person placed: they are only drawn
  elsewhere while the choice is open.
- The scrim stays: the rest of the canvas still fades back, and a press on it still closes the
  variations.

**What a variation varied is a line of its own under its name.** Each line is cut short with an
ellipsis at the variation's width and says itself whole in its tooltip. A row whose variations
say what they varied has a quarter of the thing's larger side over it rather than an eighth
(`roomOver`), so both lines hold at the zoom that fits them.

**A switch in place hangs at the start of the preview's controls**, before Done, or Reset and
Use this: previous, where the preview is ("2 of 4"), next. It steps the preview through the
variations as ← and → do, round from the last to the first, with each one drawn in its page, and
writes nothing, as showing a variation never does. It says the place and not the name, which is
over the variation beside the page (0098, 17 Nov). It is not there while the thing has one
variation alone.

## Consequences

- No variation is ever drawn over another frame, at the price of neighbours jumping right while
  the choice is open. They do not slide there: moving them by `left` keeps each frame's own
  stacking, and the scrim's fade covers the jump.
- A frame drawn aside keeps its comments and its views with it, as each draws in its frame. A
  comment left on the canvas itself does not move: it is under the scrim.
- Hit tests and drags still read the frames where they are saved. Nothing can be pressed on a
  frame drawn aside: the scrim is over it, and selecting closes the variations.
- The preview's controls are one control wider, and the keys they mirror are named in the
  arrows' tooltips.
