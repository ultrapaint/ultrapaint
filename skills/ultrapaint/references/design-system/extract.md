# Extracting a system

When the product exists, its system is read off it, not invented: from its code, its running
pages, or pictures of it. What the product does is the system, even where a rule would choose
otherwise; record where it breaks one and tell the user, but do not correct it unasked.

## From code

Read in this order, and stop asking the pictures what the code says:

- **Tokens**: CSS custom properties (`:root`, `.dark`, `@theme` in Tailwind 4), a Tailwind config's
  `theme.extend`, a tokens file (DTCG `*.tokens.json`, Style Dictionary), a theme object. shadcn's
  variables (`--background`, `--muted-foreground`, `--ring`…) are already roles; keep their names.
- **The face**: where it is loaded (a `<link>`, `@font-face`, `@fontsource/…`, `next/font`) and
  where it is applied. A family in the CSS that nothing loads is not the product's face.
- **Components**: the component folder (`components/ui/`), each component's variants and sizes
  (`cva`, a `variants` map, props), and its states. A variant no screen uses is still the
  system's; a one-off style inside one screen is not.
- **Icons**: the package imported (`lucide-react`, `@phosphor-icons/react`), its weight and stroke.

## From pages or pictures

Measure, then round to a scale:

- **Theme and accent**: dark stays dark, a purple brand stays purple. The accent is the colour of
  the primary button, not the most frequent colour.
- **Neutrals and text**: sample the page, the card and the sunken surfaces, then the text from
  darkest to lightest. Two text colours usually: the darkest is the foreground, the next the muted.
- **The selected state**, as the product draws it: a neutral fill, or a solid brand fill.
- **The face**: name it from its letterforms (the `a`, `g`, `R`, `1`) and check it against what the
  page loads; when unsure, name the nearest free face of the same geometry and say so.
- **Sizes**: cluster the text sizes seen, and map each cluster to a style (body, small, titles,
  display); weights the same way. Labels of fields and the text of controls are often two weights.
- **Spacing and radius**: the gaps that repeat are the steps; buttons, fields, cards and badges
  each give one radius. A value seen once is a mistake or a one-off, not a step.
- **Icons**: outline or filled, the stroke, the sizes beside each text size.
- **Badges**: case, radius and border; they become the neutral Badge in that shape.

## Palette and roles apart

Every colour sampled lands in two places: a step of a palette, and the roles that point at it.
A blue used for the primary button, the focus ring and links is one palette step behind three
roles. Name the roles by what screens use them for; name the palette by hue and step. A colour
used by one element on one page is neither.

## Check by building

Draw one screen of the product from the extracted system alone, beside the original. Where they
differ, the extraction missed something: a weight, a surface, a radius. Fix the system, not the
screen.

## Before you finish

| You see | Fix |
| --- | --- |
| A rule's default where the product does something else | The product's value; note where it breaks the rule |
| A face named in the CSS that nothing loads | The face the page actually renders, loaded |
| The most frequent colour taken as the accent | The primary button's colour |
| A step of the scale taken from a value seen once | Drop it |
| Roles named after the palette (`color-blue-600`) | Named by role, pointing at the step |
| Outline icons extracted from a product that draws filled ones | The set's filled style |
| Tinted or coloured badges carried over as variants | The neutral Badge, in their shape |
| An extracted system never drawn | Build one screen from it and compare |
