---
name: iconography
description: "Icons are words the user already knows. Use the product's icon set, at its sizes, and only where an icon says something faster than its label would. Use when designing or reviewing an interface's iconography."
---

# Iconography

Icons are words the user already knows. Use the product's icon set, at its sizes, and only where
an icon says something faster than its label would.

## One set

Every icon comes from the package the design system names in `icons`. When it lacks a glyph,
take its nearest one and tell the user. Another set, or a glyph drawn from shapes, breaks the
stroke and the grid.

## Size with the text

Use only the sizes the design system lists. The small one beside small text and in dense
controls, the default beside body text and in buttons, large ones for empty states and feature
tiles. The icon centres on its text's line (`crossAlign: "center"`).

## Stroke with the weight

When the set takes a stroke width, match the text beside it: `1.5` beside regular text, `2`
beside medium or semibold. One stroke width per surface.

## The colour of its text

An icon takes its label's colour: muted beside muted text, foreground beside foreground. An icon
standing alone for a secondary action (an external link, a kebab, a copy) is muted. A
status icon takes the status colour and sits beside a word. Its image node says the colour in
`tint` (a colour token): one file per glyph, drawn in any colour, never a copy per colour.

## Outline by default, filled when active

Where the set has both, outline is the resting state and filled marks a chosen one: a saved
bookmark, a checked option. In navigation the current item is marked by its row's fill. When the
design system's icons are filled, every icon of a region is filled: one style per region. When a
picture's icons are filled and the system's set has a filled style, use it; when it has none, say
so rather than mixing sets.

## A label by default

An icon stands alone only for actions everyone recognises: close, search, more, edit, delete,
add. Each icon-only button carries an accessible name and a tooltip that says it.

## One meaning per icon

The same action has the same icon everywhere, and one icon means one thing on a screen.

## Gap and optical centre

Icon to label is the small step of the scale, the same in every button, menu item and field. A
play triangle centred by its box looks off; nudge it `1–2px` toward its point.

## Icons where they speed recognition

Top-level navigation, menu actions, status, and the magnifier in a search field. Across a group
it is all rows or none. Headings, page headers, banners, dropdown triggers, child rows of a tree,
names (people take avatars), plain links and body text go without; an icon there says nothing
and costs attention.

## Before you finish

| You see | Fix |
| --- | --- |
| Icons from two packages on one screen | The design system's set only |
| An icon at a size the system does not list | The nearest listed size |
| An accent-coloured icon beside a neutral label | The label's colour |
| An icon-only button without a tooltip | Add the tooltip and the accessible name |
| The same icon for two actions | One icon per meaning |
| Icons on headings, child rows, names or plain links | Remove them |
| A folder before every item of a file tree | The chevron alone |
| Icons on some rows of a menu and not others | All or none |
| Icons on several buttons of a page header | Text only; an icon stays on at most one |
