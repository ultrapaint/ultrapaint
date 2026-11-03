# Typography

Text is set in the design system's text styles. Size, weight and colour are chosen from them,
never invented for a screen.

Read `references/studies/typography.md` when you set a public page (a hero, a brand, shop, editorial,
restaurant or portfolio page) or need numbers by character. It holds the counts from 4,983 sites,
how technical, humanistic and expressive sites differ, and recipes for each.

## Text styles first

Give every text node a `textStyle`: it brings size, weight and line height as one decision.
Override one field only for what no style covers, with a token of the scale (`"$text-sm"`,
`"$font-weight-medium"`).

## The face, loaded

Text is in the product's own face, actually loaded. A screen in the machine's fallback looks
generic, and an accidental fallback beside the designed face reads as a defect. A serif may carry the
display headlines of a landing or brand page when the brand asks for one. The product screens
shown beneath those headlines stay sans. A text serif fits only long-form editorial reading.
Navigation, labels, controls and tables stay sans, unless the user asked for a serif interface.

## Few sizes, emphasis from weight

Three sizes on a product screen are enough: the title, the body, a small one for metadata. A
fourth is for one display figure, such as the balance a dashboard is for. A landing, brand or
editorial page may use up to six across its sections, with one hero size. That size is about `62px` at
the median, and between `44` and `90px` on half of well-made pages. Five or more sizes in one viewport of a product still
merge. Emphasis inside a role is one weight step up, `400` to `500`, not a larger size.

## Titles sized by what they head

A page's title is large only on a page that is about one thing. The title of a top bar, a panel or
a small form ("Settings", "Reset your password") is body size, one weight step up: semibold at a
modest size, never bold and large. A key figure is large, and its weight may stay regular. A
display headline of `48px` and up ranks by its size: regular or medium by default, bold only when
the brand calls for it.
Control text (navigation items, tabs, buttons, menu items) is one style: medium, never bold.
Navigation items are in the muted colour, and the current one takes the foreground and its row's fill. A link
inside a sentence stays in the sentence, at its weight, underlined.

An eyebrow over a heading stays only when it states a fact the heading does not: a section number,
a date, a category. One that repeats its heading, or that the brief did not ask for, is removed.

Field labels are one text style wherever one sits: a field's label, the first line of a checkbox or
switch row, a group's label, a table's row label. Semibold, `600`, in the foreground colour, a
clear step heavier than the description under it. In a control that shows a label and its value
("View · Daily"), the label is muted and the value takes the foreground.

A placeholder is muted and shows an example. One set in the foreground makes a field look filled.

## Sizes descend with level

The heading's `level` comes from the page's outline. Its style makes each level smaller than or
equal to the one above it, so a subsection never outweighs its section.

## Line height by role

Where no text style sets it: headings `1.1–1.25`, body `1.5`, captions `1.4`. Any text that
wraps to three lines or more takes at least `1.4`.

## Tracking by size

Headings of `24px` and up tighten to `-0.02em`. Capitals open only at label sizes: up to about
`16px` they take `0.05–0.1em`. Uppercase display of `40px` and up stays at `0` or tightens. Body
text keeps `0`.

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

A group label outranks the details inside its group, by weight or by position: a small heading
style, or a caption-sized label set apart by space above it. It is never the same small grey as
a count or a description. In one region, muted text plays at most two roles; past that, the
labels that structure it read no different from the details that qualify a row.

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
| Text in the machine's fallback face | Load the product's face |
| A serif in navigation, labels, controls or tables the user did not ask for | The product's sans |
| On a product screen, four sizes without a display figure, or five or more | Merge to the nearest of three |
| A public page with two hero sizes, or more than six sizes | One hero size; merge the rest |
| A level 3 heading larger than its level 2 | A smaller style for the lower level |
| A `28px` bold title in a top bar or over a small form | Body size, one weight up |
| A bold display headline with no brand reason | Regular or medium |
| An eyebrow that repeats its heading | Remove it |
| A headline with two or more accents | One, or none |
| Control text in bold, or navigation all in the foreground colour | Medium, muted; the current one in the foreground |
| A field label at the same weight as its description, or muted | Semibold, the foreground |
| Field labels of fields, checkboxes, groups and table rows in different styles | One field-label style for all |
| A placeholder in the foreground colour | Muted |
| A link bold, or on its own line after its sentence | In the sentence, underlined |
| A paragraph wider than about 75 characters | `maxWidth` on it or its column |
| A three-line description at line height `1.1` | `1.4` or the body style |
| A light weight at `14px` | `400` or heavier |
| Uppercase display of `40px` and up tracked wide | `0` or tighter |
| A description under a heading in the foreground colour | Muted |
| Group labels in the same small muted style as the counts or descriptions under them | Weight or space above the label; muted plays at most two roles in a region |
| `...` or straight quotes in prose | `…` and curly quotes |
| Capitals typed into the text | Sentence case, uppercase from the style |
