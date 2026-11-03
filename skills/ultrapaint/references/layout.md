# Layout

A page is a few large regions on a grid, and it holds at every width the product supports.
Decide the regions first, then fill them.

Read `references/studies/layout.md` when you design a public page. It holds widths, structures and heroes by character, with recipes.

## Regions before components

Build a page from a few regions: a header, a navigation, a main column, maybe a side panel. Lay
them out as rows and columns, then fill them with components. A public page is a stack of bands.
Each band's background reaches the edges, and its content keeps one container width. A new
section is a band of a new surface or a hairline rule, not a heading in a box.

## A few shared edges

Pick a few alignment edges and put everything on them. Left edges of text line up, labels and
values share a baseline (`crossAlign: "baseline"`) and every column starts at the same x. Each
stray edge reads as noise, even when nobody can name it. Each section picks one alignment, left
or centred, and holds it. A centred hero over left-aligned sections is fine. Both alignments
inside one section are not.

## A control sits next to what it changes

A control sits next to what it changes: suggestions that fill a field sit against the field (a
chat's starters just above the composer), and filters sit above the list they filter.

## Width has a ceiling

Keep two widths apart. In a product, the main column takes a `maxWidth` from the container
tokens (`"$container-3xl"`) and the rest is margin. On a public page, bands and grids sit in a
container of about `1200–1300px` (`"$container-7xl"`, 1280). Prose inside it keeps a measure of
about `560–760px`. A form stops at its longest comfortable field, usually `"$container-md"` or
`"$container-lg"`. The exact measure is typography's.

## A public page's structure follows its character

- **Technical:** a single centred column. The hero image is the product itself, a real
  screenshot. Features sit in alternating split rows or in a bento of tiles a shade off the page.
- **Humanistic:** full-bleed bands under a photograph.
- **Expressive:** composed, as freeform, editorial columns or asymmetric bands, not a bento of
  cards. The work can take the whole first screen.

## Sizes from content

Text and the containers around it `hug` or `fill`; translated strings grow, and short labels
grow most. Fixed pixels are for things with a real fixed size: an avatar, a thumbnail, a
sidebar. Bound a box with `minWidth` and `maxWidth` rather than fixing it.

## Collapse late, and say what moves

Check the page at the design system's breakpoints, or at `390` and `1440`[with the editor's tools:  with
`get_screenshot`'s `width` | without: ]. Keep the wide layout as long as it genuinely fits. At each
breakpoint, something moves: a side panel becomes a sheet, columns stack, a table becomes a
list.

## One page, mobile-first

A page is one tree for every width. Design the smallest screen first in the node's own fields,
then say what changes from a breakpoint up in `at`, as Tailwind's `md:` does:
`{op: "update", id, at: "md", set: {type: "row", gap: "$spacing-6"}}`. A breakpoint can change
any style field, a text's `text`, an instance's `props`, `hidden` and `order`; the tree
itself is the same. Something only a wide screen has is `hidden: true` with
`at: {lg: {hidden: false}}`; never draw a second page for the phone.[with the editor's tools:  Give the page views at the
widths you check (`set_frame`'s `views: [390, 1440]`) so the user sees them side by side. | without: ]

## The primary action stays reachable

At the end of a form, in the page header, or fixed to the bottom on a phone when the screen is
long. Keep it in the flow or in fixed chrome, away from the bottom edge of a pane that resizing
clips.

## Content bleeds, controls inset

Backgrounds, media and full-width tables may reach the edges. Text and controls stay inside the
page margins, `16px` or more on a phone. A full-width button on a phone keeps the margins and
its radius.

## One scroll region

The page scrolls, or one region of it does. A horizontal scroller lets the next item peek
`16–32px` past its edge, so it reads as scrollable.

## Settings are rows

A settings page is a stack of rows split by hairlines: the label and at most one muted line on
the left, about a third of the width, the control on the right. A row that only shows a value
reads it as text with an Edit action; it becomes a field when edited. On a phone the two sides
stack.

## Density follows the task

Compact where the user works: tables, toolbars, editors. Open where they read or decide:
settings, onboarding, empty states.

## Before you finish

| You see | Fix |
| --- | --- |
| Text touching the edge at `390` | Page padding of `16px` or more |
| A paragraph or form stretched across `1440` | `maxWidth` from a container token |
| A public page squeezed into `"$container-3xl"` | A page container of about `1200–1300px`; `"$container-3xl"` only for prose and forms |
| Sections divided by a heading in a box | A band of a new surface, or a hairline rule |
| Centred and left edges inside one section | One alignment per section; only the hero may differ |
| A button or label with a fixed pixel width | `hug`, with padding from the component |
| Columns squeezed unreadable at `390` | A column at the base, `at.md` a row |
| A second page drawn for the phone | One page; what differs in `at` |
| A row of cards ending exactly at the scroller's edge | Size them so the next one peeks |
| Two nested regions that both scroll | One scroll region |
| Suggestions or filters away from the field or list they change | Against it: starters above the composer, filters above the list |
