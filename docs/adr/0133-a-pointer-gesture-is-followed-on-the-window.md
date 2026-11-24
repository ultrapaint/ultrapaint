# ADR 0133: A pointer gesture on the canvas is followed on the window, from its press to its release

Status: accepted, 2026-11-24.

## Context

A marquee drawn inside a page stayed on the page after the pointer was let go, and came back to
life, from where it began, at the next press in that page. The marquee was followed by the page's
select layer: its pointer capture and its React handlers. Space held mid-drag takes the select
layer off the page (it is drawn only while the pointer selects), the capture went with it, the
release landed on the ground, and the page never heard it. A release outside the window, or after
the window lost the focus, did the same to any gesture followed that way. The canvas had three
owners of the pointer: frame gestures listened on the window (`frame-gesture.ts`), while the
canvas's marquee, the group or text being drawn and the ground's pan listened on the ground, and a
page's marquee and node drag on its select layer.

## Decision

Every gesture a press begins on the canvas (a marquee over the ground or inside a page, a node
dragged inside a page or by its name, a frame moved or sized, a node sized, a group or text drawn,
the ground panned) is followed by one module, `pointer-gesture.ts` (`followPointer`), from the
press to the release:

- It listens on the window, in the capture phase, to the pointer that pressed (its `pointerId`),
  so the elements the pointer crosses, frames and shadow roots included, and what is taken off the
  page under it change nothing.
- It is let go on that pointer's release, or at its first move with the button no longer held,
  the release the window never heard.
- It is put back when the browser cancels the pointer, when the window loses the focus, by Escape
  (`putBackGesture`, through `stepBack`), and by the next press, before that one begins. One is
  followed at a time.

An element still takes the pointer's capture at a press, only so the frames under the pointer show
no hover while it lasts; nothing ends on the capture or the element's own handlers. A marquee
drawn inside a page is drawn from the move that begins it.

Space pressed mid-gesture leaves the gesture going until it is let go; a pan begins with the next
press. A window that loses the focus puts the gesture back rather than letting it go: the release
was not seen, and the person may come back holding nothing in mind of it.

## Considered options

- **Keep each element's capture, and end on `lostpointercapture`.** Ends the gesture when the
  select layer goes, which is not what was meant (the person is still dragging), and leaves the
  release outside the window and after a focus loss unheard.
- **Keep the select layer on the page while a press lasts.** Fixes Space alone; any other element
  taken away, and the window's lost releases, would leave the next gesture half-alive again.
