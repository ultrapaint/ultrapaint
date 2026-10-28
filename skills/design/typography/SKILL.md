---
name: typography
description: "Text is set in the design system's text styles. Size, weight and colour are chosen from them, never invented for a screen. Use when designing or reviewing an interface's typography."
---

# Typography

Text is set in the design system's text styles. Size, weight and colour are chosen from them,
never invented for a screen.

## Text styles first

Give every text node a `textStyle`: it brings size, weight and line height as one decision.
Override one field only for what no style covers, with a token of the scale (`"$text-sm"`,
`"$font-weight-medium"`).

## Few sizes, emphasis from weight

Two or three sizes on a screen are enough: the title, the body, a small one for metadata.
Emphasis inside a role is one weight step up, `400` to `500`, not a larger size.

## Sizes descend with level

The heading's `level` comes from the page's outline. Its style makes each level smaller than or
equal to the one above it, so a subsection never outweighs its section.

## Line height by role

Where no text style sets it: headings `1.1–1.25`, body `1.5`, captions `1.4`. Any text that
wraps to three lines or more takes at least `1.4`.

## Tracking by size

Headings of `24px` and up tighten to `-0.02em`. Text a style sets in capitals opens to
`0.05em`. Body text keeps `0`.

## Cap the measure

A paragraph runs 60–75 characters per line: give it or its column a `maxWidth` of about
`"65ch"`. A paragraph that runs wider gets a narrower column, not a larger font.

## Size and weight floors

Body text `16px`, interface text (fields, menus, tables) `14px`, captions `13px`, nothing below
`12px`. Below `18px` the weight stays `400` or heavier; weights under `300` are for display
sizes, `28px` and up. In code, fields stay `16px` on phones, or iOS zooms the page.

## Muted text qualifies

Muted colour is for what qualifies its neighbour: a timestamp, a hint, a count. Paragraphs and
the labels of actions take the foreground colour.

## Wrap or truncate on purpose

A name or a title in a dense row truncates to one line with an ellipsis. Its full value stays
reachable in a tooltip or a detail view. Messages and descriptions wrap. In code, `text-wrap:
balance` on headings and `pretty` on descriptions.

## Type the real characters

Curly quotes and apostrophes (“ ” ’), an en dash for ranges (`2020–2026`), the ellipsis
character (…) and `×` for dimensions. Store copy in sentence case; capitals come from the style.

## Before you finish

| You see | Fix |
| --- | --- |
| `size` or `weight` as a raw number | A `textStyle`, or the scale's token |
| Four or more sizes on one screen | Merge to the nearest of three |
| A level 3 heading larger than its level 2 | A smaller style for the lower level |
| A paragraph wider than about 75 characters | `maxWidth` on it or its column |
| A three-line description at line height `1.1` | `1.4` or the body style |
| A light weight at `14px` | `400` or heavier |
| `...` or straight quotes in prose | `…` and curly quotes |
| Capitals typed into the text | Sentence case, uppercase from the style |
