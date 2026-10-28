---
name: spacing
description: "Space is the design system's, not the eye's. Every gap and padding is a step of its spacing scale, and the same relationship is always the same distance. Use when designing or reviewing an interface's spacing."
---

# Spacing

Space is the design system's, not the eye's. Every gap and padding is a step of its spacing
scale, and the same relationship is always the same distance.

## Four steps from the scale

Gap, padding and margin take spacing tokens (`"$spacing-4"`). Pick four steps and reuse them:
inside a control, between related elements, between groups, between sections. A gap of `13` or
`18` is a step not yet picked.

## Proximity shows the grouping

Related things sit closer to each other than to anything else. The gap between groups is at
least twice the gap within one: `8px` inside, `16px` or more between. A label sits nearer its
field than the field above it, a heading nearer what it introduces than what came before.

## Space, then a surface, then a line

Group with space first. Give a group a fill or a border when it must read as one unit, a
selectable row or a draggable card. Dividers come last, for tables and long dense lists where
space costs too much.

## Gap on the parent

Space between siblings is the parent's `gap`. `margin` is for the one child that stands apart.
Children that each carry their own margin drift as soon as one moves.

## Even padding, optically

A card, a dialog or a section has the same padding on every side. Where an icon makes even
padding look heavy, as in a button with a trailing icon, give the icon's side `2px` less.

## Room between controls

Filled or outlined controls side by side sit `8–12px` apart. Borderless text and icon buttons
need more, around `16–24px`, because the space is their only edge. Dense toolbars go tighter as
long as each target keeps its own area.

## Vertical rhythm wins

When vertical and horizontal spacing disagree, keep the vertical consistent: sections the same
distance apart all the way down the page.

## Before you finish

| You see | Fix |
| --- | --- |
| A pixel number in `gap` or `padding` where a spacing token exists | The nearest step of the scale |
| The same gap within groups and between them | Double the gap between groups |
| A divider and a large gap between the same two groups | Drop the divider |
| Siblings spaced by their own margins | The parent's `gap` |
| A card padded `24` on top and `16` on the sides | One value on every side |
