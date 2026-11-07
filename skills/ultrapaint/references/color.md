# Colour

Naming and adding tokens, computing contrast, colouring charts and categories, and colouring a
public page.

## Token presets

A design system names its semantic tokens in one of two presets; use the one it has.

- **Simple**: roles, in shadcn's names: `background`, `foreground`, `card`, `popover`, `muted`
  and `muted-foreground`, `border`, `input`, `ring`, `primary`, `secondary`, `destructive`, each
  with its `-foreground` pair, and the chart colours.
- **Detailed**: tokens by property and meaning, grouped text, background and border
  (`text-color-subtle`, `background-color-danger-subtle`, `border-color-focus`), each meaning with
  its subtle and bold steps where screens need them. A property takes only its own group: a
  background token never colours text.

A raw step of the colour scale (`blue-500`) appears on a screen only where DESIGN.md's colours
name it for that use.

## Adding a token

When a role has no token (a status, a category's hue, a tinted row), add it to the design system
under its role's name, write a line in DESIGN.md saying why, and tell the user. A token the system
has but gets wrong stays theirs to change: use it, and tell them.

## Computing contrast

Read every token's value in every theme the system has and compute each pair you set: text on
its surface, an icon on its fill, a border on its ground. Convert each colour to sRGB (an `oklch`
token first), linearise each channel (`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`), take the
luminance `L = 0.2126 R + 0.7152 G + 0.0722 B`, and the ratio `(L1 + 0.05) / (L2 + 0.05)`, the
lighter over the darker. A contrast not computed is a guess; a fill that works on light may
vanish on dark.

A deep brand ink (navy, forest green) counts as the foreground when it computes to `15:1`, and so
does an off-white on a dark ground. On a single-ink page, darken the ink until it computes rather
than adding black.

## One hue, one meaning

A hue means one thing across the product; hues within about `15°` count as one. When the accent
means interactive, static text in it invites a click. Categories (tags, calendar events, the
steps of a process) take their own hues, at least `30°` from the primary and from each other; one
may be green or orange in a shade that is not the status token. Each category keeps its tint
wherever it appears, and a filter for a status repeats the status's dot. A change badge
(↗ 1.2%) is the neutral Badge with its arrow; nothing in it takes a colour.

## Charts

- **Series**: the chart colours in order, apart in every theme.
- **Sequential** data: one hue from light to dark. **Diverging**: two hues around a neutral
  midpoint.
- **One series over time**: one hue: the current period solid, the previous dashed, a forecast
  hatched.
- A tooltip names what is under the pointer.

## Gradients

A gradient is light: a glow behind a product screenshot, a wash in a hero, a screenshot fading
into the page at its foot, a band fading into the next. It is never a state, so buttons stay
solid. Text on it is computed as on a photograph.

## A public page

- **Ground**: white or a warm off-white (cream, stone, warm grey paper) by default; a dark page
  is near-black, and on it a card is one step lighter, told apart by tone or a `1px` low-contrast
  border.
- **The accent**: the primary action, text links, the active tab or filter; on a technical page
  often a solid near-black primary instead of a hue.
- **A second hue's job**: categories, a promotion, or data.
- **Content that is colour** (photographs, a portfolio's work): the interface takes no hue; the
  current item is full ink against grey, or underlined.
- **Logos and showcased screenshots** in greyscale or monochrome, so the page keeps one accent.
- **A photograph under type** is darkened by an overlay or a bottom scrim, the type placed where
  the scrim is darkest; type on an undimmed bright photo fails.

## Check

| You see | Fix |
| --- | --- |
| A contrast claimed and not computed, or computed in one theme only | Compute the pair from the token values in each theme |
| Two categories, or a category and the primary, within `30°` | Move one |
| Categories flattened to the accent and grey | Each its own hue |
| A colour logo strip beside an accent | Greyscale or monochrome |
| Type on a bright photograph with no scrim | An overlay or a bottom scrim |
