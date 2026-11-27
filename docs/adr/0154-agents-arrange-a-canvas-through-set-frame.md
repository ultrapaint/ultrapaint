# ADR 0154: Agents arrange a canvas's frames through `set_frame`, refused on overlap

Status: accepted, 2026-11-27. Follows 0018 (agents work on the canvas), 0019 (canvases), 0043
(what an agent reads), 0083 (agents outside the editor), 0138 (snapping) and 0147 (variations
make room).

## Context

A designer asks an agent to reorganise a canvas: each flow on a row of its own instead of one
long line. `set_frame` sized one frame and took no position, and `list_pages` said nothing of
where frames are, so agents rewrote `canvas.json` with a script. That skipped validation and the
editor's undo, reformatted the file, and left the agent guessing where frames and their views end
(UP-229). The pages service could already save many frames as one step, but only the editor's
frame gesture reached it.

## Decision

- **`set_frame` is the one frame tool.** It takes `canvas` and `frames`, a list of
  `{route, x?, y?, preset?, width?, height?, views?}`. One call is one undo step, whether it sizes,
  moves or both: "Arrange the canvas" when it moves a frame, "Size <page>" for one page only
  sized, "Size pages" for several. Its answer gives each frame's box after the call. No
  `arrange_frames` tool and no arrange mode: a tool costs the budget (0043), and choosing rows is
  the agent's judgement.
- **One transaction** (the pages service's `arrangeFrames`): each frame named is sized where it
  is drawn, those before it in the call in place, then put where the call says, inside one
  `edit.transaction`. `canvas.json` is written by `updateCanvas` in the server's format, every
  frame the call does not name left as saved. A frame the person placed by hand moves when it is
  named, and none moves unless named.
- **One canvas per call**: the `canvas` given, or the one the first `route` names; every route
  is looked for there. A page of another canvas refuses the call, saying where it is.
- **The grid.** `x` and `y` go to the nearest line of the canvas's 8 px grid (contracts'
  `GRID` and `onGrid`, which the editor's snapping imports). Edge snapping (0138) is a gesture's,
  and does not apply to a position an agent states.
- **Overlap: refuse, never shift.** Once every frame of a call is placed, a moved frame or one of
  its views over another frame or its views (contracts' `overlapsOf`, by intersection) refuses the
  whole call, nothing written, each moved frame named by its file with the frames under it.
  Intersection, not `FRAME_GAP`: a person may put frames closer than the server's gap, and an
  agent arranging for them may too. A call that only sizes is not checked; whether sizing makes
  room is UP-171's.
- **The read is `list_pages`**: each page gains `frame` and `bounds` (the box it takes with its
  views, `boundsOf`), as the editor draws them (`canvasFrames`), a page with no saved frame
  included.
- **The budget.** `set_frame`'s sizes keep their bounds, checked but no longer written in the
  schema (`within`): they cost more of the 13,600 characters than an agent gains from reading
  them, and one past them is refused with the bounds.
- **The turn card** says "Arranging the canvas" for a `set_frame` call whose input gives a frame
  an x or y, read from the call's input as it streams in (the tool item's `arranges`), and
  "Sizing a page" otherwise.

## Consequences

- A reorganisation is one change in the designer's history, undone in one step, with only the
  moved frames changed in `canvas.json`.
- Every caller of `set_frame` passes `frames`, the evals harness and the design briefing's
  example included.
- The pages service's `setFrame` is gone: `arrangeFrames` sizes one frame as it sizes many.
- A move written while variations are open holds once they close: their room (0147) is drawn,
  never written. An agent's arrangement landing mid-drag leaves the dragged frame where the
  pointer has it, and its save wins.
