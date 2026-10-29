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

## Space, a surface, a line, by what is grouped

A form or a page groups with space alone. When a screen or a dialog does several jobs (a link to
copy, people to invite, plans to choose from), each job sits on its own quiet surface: a faint
grey fill or a `1px` border, a `12–16px` radius, `16px` or more inside. The surface says what
belongs together, so the job needs no heading over it. A panel inside a dialog takes a fill that
differs from the dialog's (a muted grey on white), not the same white with a border. A short list
of toggles or options is bare rows, with no card and no dividers; only a long list of rows of
the same kind (a settings page, a table) is split by hairlines. One edge is drawn once: never a
line and a surface for the same group.

## Tight inside, loose between

A title and its one-line description sit `2–4px` apart. Groups of navigation items sit about twice
as far apart as the items inside them.

## Gap on the parent

Space between siblings is the parent's `gap`. `margin` is for the one child that stands apart.
Children that each carry their own margin drift as soon as one moves.

## Even padding, optically

A card, a dialog or a section has the same padding on every side. Where an icon makes even
padding look heavy, as in a button with a trailing icon, give the icon's side `2px` less.

## Room between controls

Filled or outlined controls side by side sit `8–12px` apart. Borderless text and icon buttons
need more, around `16–24px`, because the space is their only edge. Dense toolbars go tighter as
long as each target keeps its own area. A row of icon buttons and an avatar in a header shares one
gap and one centre line.

## Vertical rhythm wins

When vertical and horizontal spacing disagree, keep the vertical consistent: sections the same
distance apart all the way down the page.

## Before you finish

| You see | Fix |
| --- | --- |
| A pixel number in `gap` or `padding` where a spacing token exists | The nearest step of the scale |
| The same gap within groups and between them | Double the gap between groups |
| A divider between the groups of a form | Drop it; space separates them |
| A card around each row of a settings list | One surface, rows split by hairlines |
| Two jobs split only by a bold heading and a divider | A quiet surface for each |
| A card or dividers around a short list of toggles | Bare rows |
| A rule under a breadcrumb, above a copyright line, or a box around a table already on a surface | Remove it |
| Siblings spaced by their own margins | The parent's `gap` |
| A card padded `24` on top and `16` on the sides | One value on every side |
