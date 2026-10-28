---
name: components
description: "The design system's components are the vocabulary. Compose with them before drawing anything of your own, and use them the way they were meant. Use when designing or reviewing an interface's components."
---

# Components

The design system's components are the vocabulary. Compose with them before drawing anything of
your own, and use them the way they were meant.

## Look before you draw

For a button, a field, a badge, a dialog or tabs, find the component in the palette and [with the editor's tools: ask
`get_component` | without: read its line among the components listed] for its props and variants. A copy drawn from rows and text matches nothing, and
gets implemented as nothing.

## Variants carry the meaning

A destructive action is the destructive variant, a secondary action the secondary variant, a
small button the size prop. A default button filled red, or a primary shrunk, says something the
system does not.

## The component owns its look

Size an instance with `width` and `height`; restyle it only through its props and variants. When
none fits, choose another component or ask the user. Text inside a component is its `text` or
its children.

## Forms are fields

A form is labelled field components in one column, with the primary action at the end. Two
fields share a row only when they are one thing: a city and its postcode.

## Controls inside rows stay quiet

A select inside a row or a sentence ("Can view") is its text and a small chevron: no border, no
fill, no fixed width. A copy action for a link sits at the field's right end, not as a button
beside it. A helper action over a column ("Disable all") is a muted link. A switch in a list of
settings sits at the row's right edge, the label at its left. Only what the user types into gets
a field's box.

## Badges sit at the edge

A change badge (↗ 1.2%) is small, sits on the value's row at the card's far right, and carries
no caption. A status or plan badge ("Popular", "High risk") goes in its card's
top-right corner, opposite the title. A badge that only shows a value never opens a menu: no
chevron on it. A count beside a navigation item is a plain muted number at the row's right end,
without a pill.

## The component the job names

Previous, Today and Next are one button group with shared borders, not three buttons. Events in
time are a timeline: nodes on a vertical line, not rows split by dividers. Modes of one dialog
are a segmented control across its full width. A filter button is its word and, when it is set,
its value; no icon in front. A short list of details reads inline, a muted label and its value
after it ("Phone (629) 555-0123"); columns are for many rows scanned down.

## Search is a field

Where there is room, search is a field with its magnifier and a placeholder, not an icon button
that opens one. An icon alone is for a toolbar too narrow for the field.

## Real props

[with the editor's tools: Start from `get_component`'s example and replace every placeholder in it with real content. | without: Give every prop real content, never a placeholder.]

## New pieces are named

What the system truly lacks is built from rows, text and tokens, named for what it is ("Plan
card"). Tell the user it is new: it will need building as a component.

## Before you finish

| You see | Fix |
| --- | --- |
| A row with a fill, a radius and a text that looks like a button | A Button instance |
| `fill`, `radius` or `border` set on an instance to restyle it | A variant or a prop |
| A text node laid over an instance | The instance's own text |
| "Button" or "Label" left from an example | A real label |
| An outlined select inside a table row or a sentence | Text and a chevron |
| A "Copy" button beside a link field | The copy action inside the field's end |
| A switch in front of its label | Label left, switch at the right edge |
| A change badge under its value, or captioned "vs last year" | Small, at the row's far right, no caption |
| Prev, Today and Next as three separate buttons | One button group |
| An icon inside a filter button | The word alone |
