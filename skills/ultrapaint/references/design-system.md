# Design system

A design system is a product's look made reusable: its typeface, actually loaded; its colours by
role; its scales; its components as the product draws them. Screens built from it look like the
product without anyone restyling them. This is the job of making or changing it: creating one,
reading one off a product, importing one from Figma, making its components. Designing a screen
with it is the other job, in the router.

## Steps

1. **Name the character** (`references/character.md`). It sets the dials a system decides: the
   face, the warmth of the neutrals, the radius, the density, the accent's strength.
2. **Read what exists before deciding anything.** A product, its code or pictures of it:
   `references/design-system/extract.md`. A Figma file: `references/design-system/figma.md`. What
   the product already decides is taken as it is, even where a rule here would choose otherwise;
   say where it breaks one.
3. **Set the foundations** (`references/design-system/foundations.md`): the face, colour by role,
   the type scale and its text styles, spacing, radius and borders, elevation, motion, icons,
   widths. Every role a screen needs has a token.
4. **Make the components** (`references/design-system/components.md`): the product's anatomy, its
   variants, sizes and states, props a page can fill.
5. **Write down what is not a value**: the character, the voice, what each colour is for and what
   it is never for. In DESIGN.md where the project has one; in the token descriptions otherwise.
6. **Finish with the check.** Run the "Before you finish" table of this file and of each one you
   read, and fix what fails. Your last message names each file you read and says its table holds.

## What every system holds

- One sans for the interface, loaded; a mono beside it for a technical product. A serif only for
  a page's display headlines, when the brand asks for one.
- Neutrals neutral or warm, never blue-grey.
- Two text colours plainly apart: the foreground at `15:1` or more, muted at about `4.5–5.5:1`.
- One accent. The selected state is a neutral fill, or a solid brand fill when the product draws
  one; never a pale wash of the accent.
- One Badge, neutral. A screen adds a small coloured dot inside it where a status needs one; the
  Badge has no coloured variants.
- The radius the character gives, one family by element size.
- Names by role (`color-muted-foreground`), never by value (`color-grey-500`) where a screen
  reads them.

## Before you finish

| You see | Fix |
| --- | --- |
| A rule here chosen over what the product already does | The product's choice; say where it breaks the rule |
| A role a screen needs with no token (muted text, a field's border, focus) | Add the token |
| A token named by its value where screens use it | Name it by its role |
| Badge variants in green, red or amber | One neutral Badge; the dot is the screen's |
| A selected state drawn as a pale tint of the accent | A neutral fill, or the solid brand fill |
| A file read whose table was not run | Run it |
