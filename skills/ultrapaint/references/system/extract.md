# Extracting a system

Reading a design system off a product that exists: its code first, then its running pages or
pictures of it. Write what you read where the product keeps its tokens (its CSS variables, its
Tailwind theme, its tokens file), or as CSS custom properties where it keeps none.

## From code

Read in this order, and stop asking the pictures what the code says:

- **Tokens**: CSS custom properties (`:root`, `.dark`, `@theme` in Tailwind 4), a Tailwind
  config's `theme.extend`, a tokens file (DTCG `*.tokens.json`, Style Dictionary), a theme object.
  shadcn's variables (`--background`, `--muted-foreground`, `--ring`) are already roles: keep
  their names.
- **The face**: where it is loaded (a `<link>`, `@font-face`, `@fontsource/…`, `next/font`) and
  where it is applied. A family in the CSS that nothing loads is not the product's face.
- **Components**: the component folder (`components/ui/`), each component's variants and sizes
  (`cva`, a `variants` map, its props) and its states. A variant no screen uses is still the
  system's; a one-off style inside one screen is not.
- **Icons**: the package imported (`lucide-react`, `@phosphor-icons/react`), its weight and stroke.

## From pages or pictures

Measure, then round to a scale:

- **Theme and accent**: dark stays dark, a purple brand stays purple. The accent is the colour of
  the primary button, not the most frequent colour.
- **Neutrals and text**: sample the page, the card and the sunken surfaces, then the text from
  darkest to lightest. Two text colours usually: the darkest is the foreground, the next muted.
- **The selected state**, as the product draws it: a neutral fill, or a solid brand fill.
- **The face**: name it from its letterforms (the `a`, `g`, `R`, `1`) and check it against what
  the page loads; when unsure, name the nearest free face of the same geometry and say so.
- **Sizes**: cluster the text sizes seen and map each cluster to a style (body, small, titles,
  display); weights the same way. Field labels and control text are often two weights.
- **Spacing and radius**: the gaps that repeat are the steps; buttons, fields, cards and badges
  each give one radius. A value seen once is a mistake or a one-off, not a step.
- **Icons**: outline or filled, the stroke, the size beside each text size.
- **Badges**: their case, radius and border; they become the neutral Badge in that shape.

## Scales and roles apart

Every colour sampled lands in two places: a step of a colour scale, and the roles that point at
it. A blue used for the primary button, the focus ring and links is one step behind three roles.
Name the roles by what screens use them for and the steps by hue and number. A colour used by one
element on one page is neither.

## Check by building

Build one screen of the product from the extracted system alone and compare it with the original
side by side. Where they differ, the extraction missed something (a weight, a surface, a radius):
fix the system, not the screen.

## Check

| You see | Fix |
| --- | --- |
| A face named in the CSS that nothing loads | The face the page renders, loaded |
| The most frequent colour taken as the accent | The primary button's colour |
| A step of the scale taken from a value seen once | Drop it |
| One colour as three tokens because three roles use it | One step, three roles pointing at it |
| Outline icons extracted from a product that draws filled ones | The set's filled style |
| An extracted system never built into a screen | Build one and compare |
