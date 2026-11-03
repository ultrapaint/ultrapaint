The pictures attached are screens of one product, {{product}}, and crops of its components cut
from them (`component-*.jpg`, each with some of its surroundings). Make this project's design
system match them: its tokens and its components, so that screens built from this library look
like these.

1. Read every picture closely. A picture may sit on a backdrop or in a window or a device; only
   the product's screens count. Note the colours and what each is used for, the typefaces, the
   type sizes and weights, the spacing, the corner radii, the borders and shadows, and how each
   control is drawn in each of its states.
2. Put the values in the project's theme, the stylesheet's tokens ({{css}}), replacing what is
   there.
   - The typeface carries much of the look: name it precisely, and make the stylesheet load it
     (Google Fonts, Fontsource, or the foundry's own CSS). A font named but not loaded renders in
     the machine's fallback. When it is commercial, load the nearest free face of the same
     character (geometry, x-height, width) and say which.
   - Text has two colours whose step is plain at a glance: a near-black foreground (`15:1` or
     more) and a muted grey as light as the pictures show (about `4.5–5.5:1`).
3. Restyle the components in {{components}} to match the pictures, and add those of the list
   below the project lacks, in the same style. Keep each component's props and API; change how
   it looks.

The components the library must have, with the states the pictures show:

{{list}}

Where the pictures do not show a component or a state, design it as this product would.

What earlier extractions got wrong, and a person judged:

- The theme and the accent are the product's: dark stays dark, a purple brand stays purple.
- The selected state is read off the pictures: a quiet neutral fill, or a solid brand fill where
  the product draws one. Never a pale accent wash, never only the label tinted.
- The icon set matches the pictures' style: filled glyphs need a filled set (Phosphor's fill
  weight, Remix's `-fill` icons), outline ones an outline set, at the stroke the pictures show.
- Each component keeps the product's anatomy: a switcher is an avatar, a name and a chevron with
  no border; a toolbar select is a quiet button with its value; a stat card is an icon tile, a big
  number and a quiet label; an integration card ends in a footer with its action and switch.
- Badges copy every axis: case, radius, border, dot, and which kind of fill: solid, tinted,
  outlined, neutral with a coloured dot, or a bare number.
- Labels keep the product's weight, usually medium; agents set them bold.
- An avatar group is all photos or all initials, one size, ending in "+N"; people in data never
  get an empty grey disc.
- Components reuse each other: a table's status cell is the Badge, its people the Avatar.
- A page sets props with plain values only (text, numbers, true or false): an icon prop takes the
  icon's name, drawn by an `Icon` component of the library's own set (the paths of the icons the
  product shows), never an element.
- The stylesheet must compile: check it after every edit, as a stray brace leaves every component
  unstyled.
- A component that wraps its element (a field with an icon) puts `className`, `style` and `data-`
  attributes on its outer element and the rest on the element inside: the editor sizes an
  instance through them.
- An empty field's leading icon has the placeholder's colour; an unchecked box a light border.
When you finish, say which values you read off the pictures and which you had to decide.
