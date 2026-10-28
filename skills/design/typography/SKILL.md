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

Three sizes on a screen are enough: the title, the body, a small one for metadata. A fourth is
for one display figure or headline: the balance a dashboard is for, a landing page's hero.
Emphasis inside a role is one weight step up, `400` to `500`, not a larger size.

## Titles sized by what they head

A page's title is large only on a page that is about one thing. The title of a top bar, a panel or
a small form ("Settings", "Reset your password") is body size, one weight step up: semibold at a
modest size, never bold and large. A key figure is large, and its weight may stay regular.
Navigation items, tabs and buttons share one weight, usually medium, never bold; navigation items
are in the muted colour, and the current one takes the foreground and its row's fill. The label of
a field and the first line of a checkbox or switch row are one step heavier than the description
under them, `500` or `600`. A link inside a sentence stays in the sentence, at its weight,
underlined.

A placeholder is muted and shows an example. One set in the foreground makes a field look filled.

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

Two text colours, and the step between them is plain at a glance. The foreground is for what is
read first: titles, names, values, the labels of actions, reading text. Muted is for what
qualifies its neighbour: a description under a title, a hint, a timestamp, an email under a name,
a column of metadata. A description under a heading is muted, never the heading's colour. When
the two read as nearly one grey, the screen has no second level.

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
| Four sizes without a display figure, or five or more | Merge to the nearest of three |
| A level 3 heading larger than its level 2 | A smaller style for the lower level |
| A `28px` bold title in a top bar or over a small form | Body size, one weight up |
| Navigation labels in bold, or all in the foreground colour | One weight, usually medium, muted; the current one in the foreground |
| A label at the same weight as its description | One step heavier |
| A placeholder in the foreground colour | Muted |
| A link bold, or on its own line after its sentence | In the sentence, underlined |
| A paragraph wider than about 75 characters | `maxWidth` on it or its column |
| A three-line description at line height `1.1` | `1.4` or the body style |
| A light weight at `14px` | `400` or heavier |
| A description under a heading in the foreground colour | Muted |
| `...` or straight quotes in prose | `…` and curly quotes |
| Capitals typed into the text | Sentence case, uppercase from the style |
