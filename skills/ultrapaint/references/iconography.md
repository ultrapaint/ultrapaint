# Iconography

Choosing and drawing icons: the set and its gaps, sizes, colour, filled and illustrated styles,
where an icon may stand alone, and what a public page carries.

## The set

Every icon comes from the package the design system names, drawn as inline SVG or a component,
never an icon font, whose glyphs break when it fails to load. When the set lacks a glyph, take its
nearest one and tell the user; a glyph from another set or drawn from shapes breaks the stroke and
the grid. Third-party marks (Apple, Google, GitHub, a social network) sit outside the set in their
official form, on a chip or inside their button ("Sign up with Google"), never tinted to the
accent. Icons inside a product screenshot or mockup are the product's: its set, its sizes.

## Size, alignment, gap

- **Sizes** the system lists; with none: `16px` beside small text and in dense controls, `20px`
  beside body text and in buttons, `24px` and up for empty states and feature tiles.
- **Alignment**: centred on its text's line (`align-items: center`).
- **Gap** to its label: the small step of the spacing scale, the same in every button, menu item
  and field.
- **Optical centre**: a play triangle centred by its box looks off; nudge it `1–2px` toward its
  point.

## Colour

An icon standing alone for a secondary action (an external link, a kebab, a copy) is muted. A
status icon takes the status colour and sits beside a word. Draw each glyph once in
`currentColor` and colour it from its text, never one file per colour.

## Styles

- **Filled sets**: when the system's icons are filled, every icon of a region is filled. When a
  picture's icons are filled and the set has a filled style, use it; when it has none, say so
  rather than mixing sets.
- **Filled by nature**: star ratings, a play triangle, a status dot, a check circle and brand
  marks stay filled on an outline page; they are not a second style.
- **Illustrated**: a warmer product may draw its content marks (a row of values, of steps) as one
  illustrated set in one hand, replacing the line set for that region; utilities (search, cart,
  close) stay in the line set. Duotone is not a style to reach for.

## Standing alone

An icon stands without a label only for actions everyone knows: close, search, more, edit,
delete, add, menu, cart, account, play and pause, sound, previous and next, and platform marks.

## Where icons help

Top-level navigation, menu actions, status, the magnifier in a search field, a check or dash in a
list that compares (a small round "i" before a feature with a tooltip), and a format badge
(play, headphones, a gallery mark) on a content card whose title cannot say its format, on those
cards only. Banners, dropdown triggers (past their chevron) and body text go without.

## On a public page

Start from no icons and add one only where it says something faster than a word:

- **Header utilities**: search, account, cart or bag, wishlist, a language globe; icon-only,
  outline, at the right.
- **Markers**: a chevron on a dropdown, a hamburger, a small arrow after a text link or inside the
  primary call to action.
- **Carousels**: previous and next arrows, often in thin circles.
- **Media and dismissal**: play, pause, sound, a close × on a modal or banner. Whatever moves on
  its own (a marquee, an autoplay carousel, a hero video) carries a pause control.

An expressive page starts with none: words carry its menu and links ("Menu", "↗", "↳ Browse
all work", "[ Buy ]"), and icons stay only for what a visitor must find: cart, search, close,
sound, pause.

## Check

| You see | Fix |
| --- | --- |
| A glyph from another set, or drawn from shapes | The set's nearest glyph; tell the user |
| An icon font | SVG icons from the set |
| Icon-to-label gaps that differ between controls | One small step everywhere |
| A filled region mixing outline icons, or a second set to get filled ones | One style per region; say the set has none |
| An icon alone for an action outside the known list | Add its label |
| A format badge on a plain article card | Only where the format differs |
| A marquee, carousel or video that moves on its own with no pause | Add the pause control |
| An expressive page with icons on its links and menu | Words, a typographic arrow at most |
