# Surfaces

The levels a surface sits on, how nested surfaces and overlays stack, and the borders and radii
that draw their edges.

## The four levels

| Level | For | Shadow |
| --- | --- | --- |
| Sunken | a small group in a well: a code block, a well of filters, the track of a progress bar | the sunken shadow, if the system has one |
| Default | the page and its sections | none |
| Raised | a card that stands off the page or moves | the raised shadow |
| Overlay | a menu, popover, dialog, tooltip, toast | the overlay shadow |

A shadow says the thing moves or floats; a card that does neither is the default surface with a
border, or a change of surface. A custom `box-shadow` is a level the system lacks: ask the user
before adding one. In the dark theme a higher level is a lighter surface.

## Nested surfaces

A tone step of the system's surfaces is about `0.045` of `oklch` lightness in dark. A surface
nested in another sits flush with its container's edges and draws its edge only where it meets
the container. A panel inside a dialog takes a fill that differs from the dialog's (a muted grey
on white), not the same white with a border. A floating card holding chrome and content puts its
chrome (a header, a rail) a step toward the page and its content panel a step toward the user,
raised inside it; one tone split by a hairline reads as one sheet.

## Overlays

Layers stack in a fixed order, each a z-index: navigation, then popovers and menus, then dialogs,
then tooltips and toasts. A menu, popover or tooltip is attached to what opened it and leaves the
page undimmed; a dialog is centred and dims the page behind it.

## Borders

- **Widths**: `1px` for outlines and dividers; `2px` for selection and focus only. The system's
  border-width tokens where it has them.
- **Colours by role**: `border` for dividers and cards, `input` for fields, `ring` or `primary`
  for what is selected or focused, `destructive` for a field in error.
- **Grouping** is spacing's first; a border is for an edge the eye must find: a field, a card on
  the page's own surface, a table, a selection.
- **Images** take a hairline so their edge holds on any ground: `rgb(0 0 0 / 0.1)` on light,
  `rgb(255 255 255 / 0.1)` on dark, as an `outline` with `outline-offset: -1px`. Pure black or
  white at low opacity; a tinted grey reads as dirt on the edge.
- A rule or guide across a selected row stops at the row's fill.

## Radius

- **By size**: small for a badge or a checkbox; the default for buttons and fields; large for
  cards, dialogs and quiet surfaces; full for avatars and pills. One kind of element, one radius.
- **Concentric**: a `16px` card padded `8px` holds `8px` corners. Past `24px` of padding the two
  are separate surfaces; pick each radius on its own.
- **Square where it meets**: a page's own edges and any side that touches another element. A
  table inside a card takes the card's radius on its outer corners; its rows and cells stay
  square. A segmented group rounds only its outer corners.

## Check

| You see | Fix |
| --- | --- |
| A custom `box-shadow` string | The level's shadow, or ask the user for a new level |
| A whole section on the sunken surface | The default surface |
| A raised surface darker than the page in the dark theme | Lighter as it rises |
| A panel inside a dialog in the dialog's own white, with a border | A fill a tone step apart |
| A tooltip under a dialog, or a menu under the header | The fixed order of layers |
| A menu or popover dimming the page | Undimmed; only a dialog dims |
| A `2px` border on a card or divider | `1px`; `2px` for selection and focus |
| An image's edge lost on its ground, or a grey hairline round it | The black or white `0.1` outline |
| A segmented group or a table's rows rounded inside | Round only the outer corners |
