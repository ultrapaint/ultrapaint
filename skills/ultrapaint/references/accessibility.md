# Accessibility

What focus, the keyboard, a screen reader, low vision and large text need beyond the core's
Accessibility rules. These are requirements: when DESIGN.md or a request conflicts with one, tell
the user what fails.

## Contrast

Muted and placeholder text fail first, then a field's border on a tinted surface: compute those
pairs before any other.

## A second signal beside colour

A link in running text is underlined; a chart's series differ by shape or label as well as hue.

## Focus

The focus ring is `2px` in the ring colour, `2px` off the edge, at full opacity and `3:1` against
what it sits on. Draw the focused state of every control you design yourself.

## Keyboard

- Everything clickable is reached with Tab in reading order; inside one composite control (tabs,
  a menu, a radio group, a list box, a grid) the arrow keys move and Tab leaves it.
- Enter or Space acts; Escape closes the open overlay and returns focus to what opened it.
- A dialog keeps focus inside it while it is open and puts it on its first field or its primary.

## Targets

On desktop, `40×40px` where the density allows; `24×24px` is the floor, not the aim.

## Labels

A placeholder is only an example. Two fields need no label of their own: a search field with its
magnifier, and a field whose row label names it. An error is tied to its field. Mark whichever of
required or optional is rarer, and say what the mark means.

## Structure

One level-1 heading per page. Lists are lists, tabular data is a table, buttons act and links
navigate. A header, a navigation and a main region frame the page. In code, native elements come
before ARIA; a custom control states its role and its state (expanded, selected, pressed,
checked). A message that appears without focus moving (a toast, "Saved") is announced through a
live region (`role="status"`).

## Names for what has no words

An image that carries meaning has `alt` text saying the meaning; a decorative one has an empty
`alt`. An icon button is named for its action: "Search", not "magnifying glass".

## Text can grow

The layout survives `200%` text size and a `320px` viewport with nothing hidden or overlapping.

## Check

| You see | Fix |
| --- | --- |
| A focus ring at low opacity, or flush with the edge | `2px`, the ring colour, `2px` off, `3:1` |
| A control reached by the pointer only | Reachable by Tab, in reading order |
| An overlay that Escape leaves open, or that drops focus on close | Escape closes it; focus returns to its trigger |
| A custom toggle or disclosure with no state for a screen reader | Its role and its state |
| A toast or "Saved" that a screen reader never hears | A live region |
| A decorative image with descriptive `alt` | An empty `alt` |
