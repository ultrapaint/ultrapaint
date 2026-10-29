---
name: design-system
description: "A design system is a product's look made reusable: its typeface loaded, its colours, its components as the product draws them. Use when creating or changing tokens and components, or reading a design system off screenshots."
---

# Design system

A design system is a product's look made reusable: its typeface, actually loaded; its colours;
its components as the product draws them. Screens built from it should look like the product
without anyone restyling them.

## The typeface is loaded

The face carries much of the look. Name it precisely in the tokens and make the stylesheet load
it: Google Fonts, Fontsource, or the foundry's own CSS. A face named but not loaded renders in
the machine's fallback, and every screen looks generic. A commercial face nobody has a licence
for gives way to the nearest free one of the same character (its geometry, x-height and width),
and the user is told which.

## Choosing a face

When the product has none yet: a neo-grotesque or geometric sans for interface text (Inter,
Geist, Instrument Sans, Figtree, Space Grotesk), or a mono for a technical product. Serifs are
for a marketing headline at most, never for interface text. One family, two at most.

## Neutrals and the text colours

Neutrals are neutral or warm; a blue-grey scale makes everything look cold and generic. The
foreground and the muted text are set as far apart as the colour skill says, in every theme.

## Read off the product

When the system comes from pictures of a product:

- Its theme and its accent: dark stays dark, a purple brand stays purple.
- Its selected state, as it draws it: a quiet neutral fill, or a solid brand fill. Never a pale
  wash of the accent, never only the label tinted.
- Its icon set's style: filled glyphs need a filled set (Phosphor's fill weight, Remix's `-fill`
  icons), outline ones an outline set at the stroke the pictures show.
- Its labels' weight, usually medium; agents set them bold.
- Its badges on every axis: case, radius, border, dot, and the kind of fill.

## Components are the product's

Each component keeps the product's anatomy. A workspace switcher is an avatar, a name and a
chevron, without a border; a toolbar select is a quiet button with its value; a stat card is an
icon tile, a big number and a quiet label. A card is its data, and the card itself is clickable:
not a title, a line of grey text and a button. Make the components the product has, under the
names of what they are: a product with a dropdown menu and no select gets the menu.

A component that wraps its element (a field with an icon, a select with its trigger) puts its
`className`, its `style` and its `data-` attributes on the outer element, and the element's own
attributes on the element inside: the editor sizes and marks an instance through them, and a size
landing on the inner element leaves the icon centred on the old height.

Components reuse each other: a table's status cell is the Badge, its people the Avatar. An
avatar group is all photos or all initials, one size, ending in "+N"; people in data never get an
empty grey disc. An empty field's leading icon has the placeholder's colour; an unchecked box a
light border, the checked one the weight.

## Before you finish

| You see | Fix |
| --- | --- |
| A font named in the tokens and not loaded | Load it, or the nearest free face, and say which |
| A serif for interface text | A sans, or a mono for a technical product |
| A blue-grey neutral scale | A neutral or warm one |
| Outline icons for a product that draws filled ones | The set's filled style |
| A card made of a title, grey text and a button | The product's card: its data, clickable |
| A select where the product shows a menu | The menu |
| A table drawing its own badges or avatars | The Badge and the Avatar |
| Bold labels on buttons and tabs | The product's weight, usually medium |
| A wrapping component spreading `style` onto its inner element | `className`, `style`, `data-` on the outer one |
