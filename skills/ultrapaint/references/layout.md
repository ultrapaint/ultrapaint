# Layout

How one page reflows from a phone to a wide screen, in CSS terms, and how a public page's bands
are structured by its character.

## Mobile-first, one tree

Write the smallest width as the base styles, then change what differs from a breakpoint up with
`min-width` media queries (Tailwind's `md:`, `lg:`). The markup is the same at every width: a
breakpoint changes direction, columns, gap, padding, `order` and `display`, never the content's
meaning. What only a wide screen has is hidden at the base and shown from its breakpoint up
(`hidden lg:block`); one element, never a copy for each width.

Use the design system's breakpoints; with none, Tailwind's: `sm 640`, `md 768`, `lg 1024`,
`xl 1280`, `2xl 1536`.

## Collapse late

Keep the wide layout as long as it genuinely fits; change it at the width where it starts to
crowd, not at the first breakpoint. Sizes that follow their content (text hugs, columns fill, a
box bounded by `min-width` and `max-width`) let strings grow when translated, and short labels
grow most.

## What moves at each width

| Region | Phone (base) | From `md` | From `lg` |
| --- | --- | --- | --- |
| Navigation | a menu button opening a sheet, or a bottom bar | a rail or a short top bar | the full sidebar or top bar |
| Side panel, inspector | a sheet from the bottom or side | a sheet | inline beside the main column |
| Columns, a split hero, a feature row | stacked, in reading order | two columns | the full grid |
| A table | a list of rows, the name and one or two values each | the table, fewer columns | every column |

The primary action sits at the end of a form, in the page header, or fixed to the bottom on a
phone when the screen is long; never against the bottom edge of a pane that resizing clips. A
full-width button on a phone keeps the page margins and its radius.

## A public page's structure

A new section is
a band of a new surface or a shared `1px` rule; the colour change or the rule stands in for the
gap and never sits on top of one. Sections keep one vertical rhythm, the same distance apart all
the way down; when vertical and horizontal spacing disagree, the vertical wins.

- **Technical**: a single centred column. The hero image is the product itself, a real
  screenshot. Features sit in alternating split rows, or in a bento of tiles a shade off the page.
- **Humanistic**: full-bleed bands under a photograph.
- **Expressive**: composed: freeform, editorial columns or asymmetric bands, not a bento of
  cards. The work may take the whole first screen.

On a phone every band stacks to one column; a split hero puts its words first and its image
after, and an image that bleeds keeps bleeding to the screen's edge.

## Check

| You see | Fix |
| --- | --- |
| Columns squeezed unreadable at `390` | One column at the base, the row from `md` up |
| An element written twice, one for the phone and one for wide screens | One element; hide or move it by breakpoint |
| The wide layout given up while it still fits | Change it where it starts to crowd |
| A primary action pinned to the bottom of a resizable pane | In the flow, or in fixed chrome |
| A full-width phone button touching the screen's edges | The page margins and its radius |
| Sections divided by a heading in a box | A band of a new surface, or a hairline rule |
| A section gap with a rule across it as well | The gap or the rule |
| Section gaps that drift down the page | One vertical rhythm |
