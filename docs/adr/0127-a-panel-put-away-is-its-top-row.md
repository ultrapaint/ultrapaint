# ADR 0127: A panel put away is its top row

Status: accepted, 2026-11-24. Amends 0058 (the right card put away).

## Context

Put away by the person while something is selected, the right card was a small card with the
panel's toggle and the name of its open tab ("Design", "Code", or "Inspector" on a board view).
The name was not a button: it took two thirds of the card and did nothing when clicked, so the
person kept clicking it, and it said nothing they needed, since what is selected is already on the
canvas, outlined and tagged. The toggle sat at the card's start, 55px from where the open
panel's toggle sits, so the button that showed the panel was not under the pointer to put it away
again.

Three directions were drawn in the running editor: the toggle alone in a square card, the
panel's top row kept, and the whole card one button naming the selection (close to the first
version of 3 November, which named the layer and was replaced the same day). The person chose the
top row.

## Decision

- **A panel put away is its top row alone**, on both sides: the left card is its project's row
  (0058), and the right card its tabs' row, **Design** and **Code**, none of them open, and its
  toggle.
- **Each tab brings the panel back on itself**; the toggle brings it back on the tab it had. The
  toggle sits at the row's end, where it sits with the panel out.
- **The focus follows**: the panel shown or put away is drawn in place of the row its control was
  on, so the focus moves to the tab it opened on, or to the toggle where it now is.
- **On a board view**, whose inspector has no tabs, the right card put away is its toggle alone.
- The card put away covers none of the canvas: zooming to fit leaves it out, as before.

## Consequences

- Every part of the card put away does something, and the word on it is a choice between two
  tabs rather than a label.
- Showing the panel and putting it away again is two clicks at one spot.
- The closed card is wider than the old one, by the second tab.
