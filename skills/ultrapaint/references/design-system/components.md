# Making components

A component is a piece of the product made once: its anatomy, its variants, its sizes and its
states, with props a page fills with plain values. Screens compose with it and never restyle it,
so whatever a screen needs to say has to be a variant or a prop.

## The product's anatomy

Each component keeps the anatomy the product draws. A workspace switcher is an avatar, a name and
a chevron, without a border; a toolbar select is a quiet button with its value; a stat card is an
icon tile, a big number and a quiet label. A card is its data, and the card itself is clickable:
not a title, a line of grey text and a button. Make the components the product has, under the
names of what they are.

## Variants, sizes and states

Every component that acts has the same three axes, and the system fills every cell:

- **Variants** say what the action is: primary (one per screen), secondary, outline, ghost,
  destructive, link. A screen that needs to say something the variants cannot say needs a new
  variant, not an override.
- **Sizes**: small, default, large. Controls in a technical product are about `32–36px` high, in
  a humanistic one `40–48px`; buttons and fields of one size share a height.
- **States**: default, hover, pressed, focused, selected, disabled, and for fields filled, error
  and read-only. Each is a step of the variant's own role (`references/design-system/foundations.md`);
  focus is the ring, `2px` off the edge; disabled `50%`.

Inside, the spacing is optical: a button with a trailing icon has `2px` less padding on that
side; icon to label is the scale's small step, the same in every button, menu item and field.
Every target reaches `24×24px`, `40×40px` on desktop where density allows and `44×44px` on touch,
with padding when the glyph is smaller.

## Props a page can fill

A page sets props with plain values: text, numbers, true or false, one of a list. A prop that
shows an icon takes the icon's name from the system's set (`icon="search"`, drawn by the
system's `Icon` component), never an element: an element prop is one no page can fill, and
agents end up laying an icon over the component by hand. Text inside a component is its `text`
prop or its children; a slot is named for what goes in it (`end`, `icon`, `actions`).

A component that wraps its element (a field with an icon, a select with its trigger) puts its
`className`, its `style` and its `data-` attributes on the outer element, and the element's own
attributes on the element inside: the editor sizes and marks an instance through them, and a size
landing on the inner element leaves the icon centred on the old height.

## Quiet versions for rows and sentences

A select inside a row or a sentence is a variant of its own: its text and a small chevron, no
border, no fill, no fixed width. A field has an end slot for an action such as copy, and an icon
slot at its start whose icon takes the placeholder's colour while it is empty. A count beside a
navigation item is a plain muted number or a small grey count badge.

## The components a job names

Make what screens reach for, so they never assemble it from rows: a button group with shared
borders (Previous, Today, Next), a segmented control for the modes of one view, a timeline for
events in time, a search field with its magnifier, tabs, a switch row with the label left and the
switch at the right edge. A product with a dropdown menu and no select gets the menu.

## Components reuse each other

A table's status cell is the Badge, its people the Avatar. The Badge is neutral: one fill that
differs from a card's surface, the foreground or muted text, in the product's case and radius; a
screen adds a small coloured dot inside it for a status, and the Badge itself has no coloured
variants. An avatar group is all photos or all initials, one size, ending in "+N"; people in data
never get an empty grey disc. An unchecked box has a light border, the checked one the weight.

## Overlays attach

A menu, popover or tooltip opens against its trigger, `4px` off its edge, on the overlay level,
and leaves the page undimmed. A dialog is centred and dims the page. A nested element takes the
outer radius less the padding between them.

## Before you finish

| You see | Fix |
| --- | --- |
| A card made of a title, grey text and a button | The product's card: its data, clickable |
| A select where the product shows a menu | The menu |
| A table drawing its own badges or avatars | The Badge and the Avatar |
| Badge variants in green, red or amber | One neutral Badge |
| A variant, size or state left undrawn | Draw every cell |
| Buttons and fields of one size at different heights | One height per size |
| A focus state without the ring | The ring, `2px` off the edge |
| Control text bold | Medium, `500` |
| A wrapping component spreading `style` onto its inner element | `className`, `style`, `data-` on the outer one |
| An `icon` prop that takes an element | The icon's name, drawn by the system's `Icon` |
| A screen's job assembled from rows because no component does it | Make the component |
