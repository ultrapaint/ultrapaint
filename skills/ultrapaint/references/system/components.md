# Making components

Making or changing the design system's components in code: their anatomy, variants, sizes,
states and props. A component is made once, in its own file, with its variants as a map (`cva`,
a `variants` object) and typed props; screens compose with it and never restyle it, so whatever
a screen needs to say is a variant or a prop.

## The product's anatomy

Each component keeps the anatomy the product draws, under the name of what it is. A workspace
switcher is an avatar, a name and a chevron, without a border; a toolbar select is a quiet button
with its value; a stat card is an icon tile, a big number and a quiet label. A card is its data,
and the whole card is the click target: not a title, a line of grey text and a button.

## Variants, sizes and states

Every component that acts has three axes, and the system fills every cell:

- **Variants** say what the action is: primary, secondary, outline, ghost, destructive, link.
  The secondary is a light grey fill of the primary's height; the outline a hairline. A screen
  that needs to say something the variants cannot gets a new variant, not an override.
- **Sizes**: small, default, large. Controls are about `32–36px` high in a technical product,
  `40–48px` in a humanistic one; buttons and fields of one size share a height.
- **States**: default, hover, pressed, focused, selected, disabled; a field adds filled, error and
  read-only, at the values `references/system/foundations.md` sets for each.

Icon to label is the scale's small step, the same in every button, menu item and field.

## Props a screen can fill

- Props take plain values: text, numbers, true or false, one of a list. Text inside a component is
  its text prop or its children; a slot is named for what goes in it (`icon`, `end`, `actions`).
- An icon prop takes the icon's name from the system's set (`icon="search"`), drawn by the
  system's `Icon` at the component's size and colour, so every icon comes from one set at one
  size per control.
- A component that wraps an element (a field with an icon, a select with its trigger) puts the
  `className` and `style` a screen passes on its outer element and the element's own attributes
  on the inner one: a size set from outside then reaches the box that also holds the icon, which
  stays centred.

## Quiet versions for rows and sentences

A select has a quiet variant: its value and a small chevron, no border, no fill, no fixed width.
A field has an end slot for an action such as copy, and an icon slot at its start whose icon takes
the placeholder's colour while the field is empty.

## The components a job names

Make what screens reach for, so they never assemble it from boxes: a button group with shared
borders, a segmented control, tabs, a timeline, a search field with its magnifier, a switch row,
choice cards (`references/components.md` has their anatomy). A product with a dropdown menu and no
select gets the menu.

## Components reuse each other

A table's status cell is the Badge, its people the Avatar. The Badge takes the product's case and
radius and has no coloured variants; a screen adds the status dot inside it. An avatar group is
all photos or all initials, one size, ending in "+N"; a person in data never gets an empty grey
disc.

## Surfaces and radius by default

Where the product has not chosen:

- A group that needs a surface takes a fill one step off the page first, a `1px` border second, a
  shadow last; most content needs none.
- Buttons, cards and fields share one radius per family; when buttons are pills, they are pills
  everywhere. On a public site the cards and buttons sit at about `12px` for a technical product
  and `16px` for a humanistic or expressive one.

## Check

| You see | Fix |
| --- | --- |
| A card made of a title, grey text and a button | The product's card: its data, clickable whole |
| A select where the product shows a menu | The menu |
| A table drawing its own badges or avatars | The Badge and the Avatar |
| A variant, size or state left undrawn | Every cell |
| Buttons and fields of one size at different heights | One height per size |
| An icon prop that takes an element | The icon's name, drawn by the system's `Icon` |
| A wrapping component passing `style` to its inner element | `className` and `style` on the outer one |
| A shadow where a fill or a border would hold the group | The fill, then the border |
| Pills beside rounded buttons | One radius per family |
