# Foundations

The values every screen draws from: the face, colour by role, the type scale, spacing, radius and
borders, elevation, motion, icons and widths. Each is a token a screen names by its role, and
each is decided once, here. The character (`references/character.md`) sets the dials, and what
the user said of it wins over a default below; the product, where there is one, sets them first.

## The face

The face carries much of the look. Name it precisely in the tokens and make the stylesheet load
it: Google Fonts, Fontsource, or the foundry's own CSS. A face named but not loaded renders in
the machine's fallback, and every screen looks generic. A face is free (the SIL Open Font
License, as on Google Fonts and Fontsource) or paid. A paid face is used only where the product
already loads it or the user says they hold its licence; otherwise the nearest free one of the
same character (its geometry, x-height and width) takes its place, and the user is told which.

When the product has none yet, the type voice picks it: a neo-grotesque or geometric sans for
interface text (Inter, Geist, Instrument Sans, Figtree, Space Grotesk); a friendly geometric or
humanist sans for a humanistic product; a mono beside the sans for code, ids and figures in a
technical one. A display face, a serif among them, for a page's headlines when the brand asks for
one; a serif for interface text only when the user asked for it. One family, two at most.

## Colour by role

Screens read colour by role, so every role has a token and its pair: background and foreground,
card, popover, muted and muted-foreground, border, input, ring, primary and primary-foreground,
secondary, destructive and destructive-foreground, and the chart colours. A palette (`blue-50`
to `blue-950`) sits beneath them; a role points at a step of it, and screens never name the steps.

The roles are written in the token preset the user chose (`tokenPreset`): **simple**, the roles
themselves, or **detailed**, tokens by property and meaning grouped Text, Background and Border
(`text-color-default`, `text-color-subtle`, `background-color-raised`,
`background-color-brand-bold`, `background-color-danger-subtle`, `border-color-input`,
`border-color-focus`), each meaning with its subtle and bold steps where screens need them.

- **Neutrals** follow the temperature: warm (a warm off-white, stone), neutral (white, a true
  grey), or cool (slate, zinc) only when the user asked for a cool, clinical feel. Unasked, a
  blue-grey scale makes every screen cold and generic.
- **Text**: the foreground is near-black, `15:1` or more against its background; a deep brand ink
  (navy, forest green) counts when it computes to that. Muted sits as light as legibility allows,
  about `4.5–5.5:1`; darker than about `6:1`, the two levels blur.
- **One accent.** Primary marks the primary action and a chosen option. Its strength follows the
  character: restrained for a technical product, livelier for a humanistic one, the brand's own
  for an expressive page.
- **Selected** is a neutral fill (the muted surface, the foreground text), or a solid brand fill
  when the product draws one. Never a pale wash of the accent, never only the label tinted.
- **States** are steps of one role: hover and pressed a shade of the same fill (hover tokens, or
  the fill at `90%`), focus the ring colour, disabled `50%` opacity. A state brings no new hue.
- **Status** colours (success, warning, destructive) are for status only. Categories (tags,
  calendar events, the steps of a process) take their own hues from the palette, at least `30°`
  from the primary and from each other; hues within about `15°` count as one.
- **Charts**: an ordered set of series colours that stay apart in every theme; sequential scales
  of one hue light to dark; diverging ones of two hues around a neutral midpoint.
- **Every theme**: each pair is computed in each theme. On dark, a surface higher up is lighter.

## The type scale

Text styles, not loose sizes: each a size, weight, line height and tracking, named by role.
Define these, and only the ones the product uses:

| Style | Size | Weight | Line height |
| --- | --- | --- | --- |
| Display (pages) | `44–90px`, about `62px` at the median | `400–500`, bold only for the brand | `1.05–1.15` |
| Heading 1–3 | each level smaller than or equal to the one above | `600` | `1.1–1.25` |
| Title (a panel, a card, a small form) | body size or one step up | `600` | `1.25–1.4` |
| Body | `14px` in a product, `16px` on a page | `400` | `1.5` |
| Field label | body size | `600`, foreground | `1.4` |
| Control text (navigation, tabs, buttons, menu items) | body size | `500`, never bold | `1.25` |
| Small (metadata, captions) | `12–13px` | `400–500` | `1.4` |
| Mono (code, ids, figures) | the body's size or a step down | `400` | `1.5` |

Floors: interface text `14px`, captions `13px`, nothing below `12px`; weights under `300` only at
`28px` and up. Tracking: headings of `24px` and up at `-0.02em`; capitals at label sizes
`0.05–0.1em`; uppercase display of `40px` and up at `0` or tighter; body `0`. A technical product
keeps four sizes or fewer on a screen; a humanistic one sets every level a step larger.

## Spacing

A `4px` base and a scale of steps: `4, 8, 12, 16, 24, 32, 48, 64, 96, 120`. Screens pick four of
them (inside a control, between related things, between groups, between sections), so the scale
needs no step between those. A surface is padded `16px` in a dialog or a tool, `24–32px` on a
page; a page's section step is about `120px`, `40–90px` for news fronts and shop grids. Density
follows the character: rows and navigation items `32–40px` in a technical product, `40–48px` in a
humanistic one.

## Radius and borders

The shape gives the radius: sharp `2–6px`, soft `6–10px` (a technical product `4–8px`), round
`12–20px` (a humanistic one), the brand's own for an expressive page. One family by element size: small (a badge, a checkbox),
default (buttons, fields), large (cards, dialogs, quiet surfaces), full (avatars, pills). Buttons
and fields share the default.

Two widths: `1px` for outlines and dividers, `2px` for selection and focus. Border colours by
role: border for dividers and cards, input for fields, ring for focus, destructive for a field in
error. The focus ring is `2px` in the ring colour, `2px` off the edge.

## Elevation

Four levels, each a surface and a shadow named together: sunken (a well, a track), default (the
page), raised (a card that stands off it or moves), overlay (menus, popovers, dialogs, tooltips).
A technical product keeps shadows for menus and dialogs only; a humanistic one may soften with
fills instead of borders. Layers stack in a fixed order, each a z-index: navigation, popovers and
menus, dialogs, tooltips and toasts. In the dark theme a higher level is a lighter surface.

## Motion

Name the curves and durations of `references/motion.md` as tokens, or the product's own: an
easing for entering and leaving (`cubic-bezier(0.23, 1, 0.32, 1)`), one for moving on screen
(`cubic-bezier(0.77, 0, 0.175, 1)`), one for sheets (`cubic-bezier(0.32, 0.72, 0, 1)`), and
durations of about `150`, `200` and `300ms`. Written exactly: a named curve is not `ease-out`.

## Icons

One set, named in the tokens (`icons`), in the style the product draws: outline at the stroke
its pictures show, or filled where its icons are filled (Phosphor's fill weight, Remix's `-fill`
icons). Sizes `16px` beside small text and in dense controls, `20px` beside body text and in
buttons, `24px` and up for empty states and feature tiles. The stroke follows the text beside it:
`1.5` beside regular, `2` beside medium or semibold.

## Widths

Containers: a product's main column (about `768px`, `container-3xl`), a form's longest field
(`container-md` or `container-lg`), a page's bands (`1200–1300px`, `container-7xl` at `1280px`),
prose at about `65ch`. Breakpoints the product supports, mobile first.

## Before you finish

| You see | Fix |
| --- | --- |
| A font named in the tokens and not loaded | Load it, or the nearest free face, and say which |
| A serif for interface text the user did not ask for | A sans, or a mono for a technical product |
| A blue-grey neutral scale where the character is not cool | A neutral or warm one |
| A dial chosen here that the user's words contradict | The user's word |
| A foreground below `15:1`, or a muted text darker than `6:1` | Move them until they compute, in every theme |
| A role with no foreground pair | Add the pair |
| Two categories, or a category and the primary, within `30°` | Move one |
| A field label and control text in one style, or control text bold | Field label `600`; control text `500` |
| Text styles for sizes the product never uses | Remove them |
| Spacing steps of `13`, `18` or other values off the base | The nearest step of the scale |
| A radius that contradicts the shape, or buttons and fields with different radii | The shape's radius; one default for both |
| Shadows on cards in a technical product | Flat cards with a border |
| A raised surface darker than the page in the dark theme | Lighter as it rises |
| Icons from two sets, or a size the scale does not list | One set; the listed sizes |
