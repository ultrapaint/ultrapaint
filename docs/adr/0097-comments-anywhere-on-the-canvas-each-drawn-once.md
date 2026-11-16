# ADR 0097: Comments go anywhere on the page canvas, and each is drawn in one place

Status: accepted, 2026-11-16. Amends 0036 (a page's comments in its views) and 0085 (where a
comment is drawn).

## Context

A comment was a page's: the comment tool placed one only on a page's frame or a view of it, so the
canvas around the pages, and the nodes placed beside them, took none. A page's comment was drawn in
the page's frame and again in each of its views, at the same pixels, so a pin left near the right
edge of a wide page fell outside a narrow view, or on another element. The comment being written
and the open card were drawn the same way: two composers at once, and each frame that held one was
lifted over its neighbours, so the later one covered the card of the first.

## Decision

- **A comment can be left anywhere on the page canvas.** On a page's frame or a view of it, as
  before. On a node beside the pages, it is the canvas's (`page` null) and pinned on that node, in
  its frame's pixels, so it moves with the node. On nothing, it is the canvas's at that point of the
  canvas. The comment tool places one wherever it is pressed; the canvas's menu has "Add a comment",
  and a node beside the pages "Comment on this". A board's generated documents take none.
- **Each comment is drawn in one place** (`commentFrame`): a page's in the view it was left in
  (`view`), else in the page's own frame, which also takes back the comments of a view taken away;
  a canvas comment in its node's frame, else on the canvas, where it also goes when its node is
  gone. The comment being written is drawn in the frame it was started in alone, and only that
  frame is lifted for the card. Every frame stacks on its own, so a neighbour's pins never rise
  over the card. The prototype still shows a page's comments from all its frames.
- **A comment on the canvas is a comment, never a behaviour note**: the canvas is implemented as
  no page (ADR 0030). The composer and the comment's menu offer the note only on a page.
- `comments.json` writes `view` only for a comment left in a view, as `kind` only for a note, so a
  file written before reads the same. The Comments panel lists the canvas's under "On the canvas";
  an agent is told where the pin's pixels are counted from.

## Consequences

- A comment left in a view is not seen in the page's own frame: the Comments panel lists it, and
  opening it there brings the view into sight.
- A comment left on a node beside the pages and moved into a page stays where it was on the canvas,
  in the pixels it had in the node's frame.
