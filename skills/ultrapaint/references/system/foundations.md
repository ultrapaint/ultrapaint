# Foundations

Choosing the values a design system's tokens hold: the face, colour by role, the text styles,
spacing, radius, elevation, motion, icons and widths. The character sets five dials here (the
face, the warmth of the neutrals, the radius, the density, the accent's strength); what the user
said of the feel wins over every default below.

## The face

Choose and load it as `references/typography.md` says. The system names up to three families as
tokens (`font-sans` for the interface, `font-mono` beside it in a technical product, `font-display`
for a page's headlines when the brand asks for one) and loads only the weights its text styles
use.

## Colour by role

The roles to define, each with its pair, in the naming the system uses (`references/color.md`):
`background` and `foreground`, `card`, `popover`, `muted` and `muted-foreground`, `border`,
`input`, `ring`, `primary` and `primary-foreground`, `secondary`, `destructive` and
`destructive-foreground`, the status colours, the chart colours. Beneath them
sit the colour scales (`stone-50` to `stone-950`): each role points at a step, and the step holds
the value.

- **The neutral scale** follows the temperature: warm, a warm off-white over stone; neutral,
  white over a true grey; cool, slate or zinc.
- **The accent's strength** follows the character: restrained for a technical product, livelier
  for a humanistic one, the brand's own for an expressive page.
- **States**: hover and pressed are the hover tokens or the fill at `90%`; focus is the ring
  colour; disabled is `50%` opacity.
- **Status**: success, warning and destructive, each with its foreground pair.
- **Charts**: an ordered set of series colours (`chart-1` to `chart-5`) that stay apart in every
  theme.
- **Themes**: every role has a value in every theme the product ships.

## The text styles

Each style is a size, a weight, a line height and tracking, named by role. Define these, and only
the ones the product uses:

| Style | Size | Weight | Line height |
| --- | --- | --- | --- |
| Display (pages) | `44–90px`, about `62px` | `400–500`, bold only for the brand | `1.05–1.15` |
| Heading 1–3 | each level smaller than or equal to the one above | `600` | `1.1–1.25` |
| Title (a dialog, a small form) | `18–20px` | `600` | `1.25–1.4` |
| Title (a panel, a card, a top bar) | body size | `600` | `1.25–1.4` |
| Body | `14px` in a product, `16px` on a page | `400` | `1.5` |
| Field label | body size | `600`, foreground | `1.4` |
| Control (navigation, tabs, buttons, menu items) | body size | `500` | `1.25` |
| Small (metadata, captions) | `12–13px` | `400–500` | `1.4` |
| Mono (code, ids, figures) | body size or a step down | `400` | `1.5` |

A humanistic product sets every level a step larger.

## Spacing

A `4px` base and the steps `4, 8, 12, 16, 24, 32, 48, 64, 96, 120`, as tokens; the scale needs no
step between them. Density follows the character: rows and navigation items `32–40px` high in a
technical product, `40–48px` in a humanistic one.

## Radius

The shape gives the values; the family by size is `references/surfaces.md`'s:

| Shape | Default (buttons, fields) | Character |
| --- | --- | --- |
| Sharp | `2–6px` | |
| Soft | `6–10px` | a technical product `4–8px` |
| Round | `12–20px` | a humanistic product |
| The brand's | as the brand draws it | an expressive page |

## Borders

Two width tokens, `1px` and `2px`; colour tokens by role: `border`, `input`, `ring`, and
`destructive` for a field in error. The focus ring's width and offset are
`references/accessibility.md`'s.

## Elevation

Four levels, each a surface token and a shadow token named together (sunken, default, raised,
overlay), and a z-index token per layer (navigation, popovers and menus, dialogs, tooltips and
toasts). A technical product keeps shadows for menus and dialogs; a humanistic one may lift with
fills instead of borders.

## Motion

Curves and durations as tokens, or the product's own, written exactly (a named curve is not
`ease-out`):

- entering and leaving: `cubic-bezier(0.23, 1, 0.32, 1)`;
- moving on screen: `cubic-bezier(0.77, 0, 0.175, 1)`;
- sheets and drawers: `cubic-bezier(0.32, 0.72, 0, 1)`;
- durations `150`, `200` and `300ms`.

## Icons

One set, named as a token, in the style the product draws: outline at the stroke its icons show,
or filled where they are filled (Phosphor's fill weight, Remix's `-fill` icons). Sizes `16px`
beside small text and in dense controls, `20px` beside body text and in buttons, `24px` and up for
empty states and feature tiles.

## Widths

Container tokens for the core's widths (with Tailwind: `container-3xl` at `768px` for a product's
main column, `container-md` or `container-lg` for a form, `container-7xl` at `1280px` for a page's
bands, `65ch` for prose) and the breakpoints the product supports, smallest first.

## Check

| You see | Fix |
| --- | --- |
| A role holding a raw value | Point it at a step of the scales |
| A token in one theme and missing from another | A value in every theme |
| Text styles for sizes the product never uses | Remove them |
| A radius that contradicts the shape | The shape's value |
| Shadows on cards in a technical product | Flat cards with a border |
| Motion written as `ease-out` or a loose duration | The named curve and duration |
| An icon size the scale does not list | `16`, `20` or `24px` and up |
