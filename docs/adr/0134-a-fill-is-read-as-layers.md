# ADR 0134: A fill is read as layers, and a gradient's stops take tokens

Status: accepted, 2026-11-24. Amends 0061 (a raw string where a colour token was due is off the
system: a fill's colours are now each checked) and 0016 (the Figma import brought a linear
gradient alone, at 180 degrees). Follows 0015, 0024, 0028, 0036, 0102 and 0114. Story: UP-141.

## Context

A box's `fill` is any CSS background, and the canvas draws it as it is, but the editor offered one
colour field and refused anything else: a gradient an agent wrote could only be replaced. A token
was read only where it was the whole value, so `linear-gradient($color-primary, $color-accent)`
was drawn as broken CSS, its tokens counted as unused, and every gradient was flagged off the
system. The code wrote a gradient as one arbitrary class, and the Figma import brought a linear
gradient alone, always at 180 degrees, its stops raw. UP-141 asked for gradients in layers.

## Decision

- **The document keeps the string.** `fill` stays one CSS background (0015). A pure codec,
  `design-document`'s `fill`, reads it as layers, the top one first: colours, and linear, radial
  and conic gradients, each with its **shape**, its **stops** (a token or a CSS colour, and a
  position), its angle or side, its **geometry** as written (`circle at top`; `geometry`) and its
  **colour space** (`in oklab`; `interpolation`, with a hue method where it names one). It writes them
  back as CSS paints them; a colour above another is written as a gradient of that colour alone,
  and a first stop at 0% and a last at 100% are left where CSS puts them. A value it cannot read
  (an image among the layers, a colour anywhere but at the bottom, CSS it does not know) is one
  layer, written back as it was.
- **Tokens inside a value, in a fill only.** A token is read wherever it stands in a fill (after
  the start, a bracket, a comma or a space), but inside a `url(…)` or a quoted string: the canvas draws each as its variable with its
  fallback (`TokenResolver.fill`), and `tokensIn` counts them as the design's (0028). Every other
  value names a token only at its start, so a text saying "Save $20" names none. The shadow's
  layers (UP-142) join `tokensIn`'s list of CSS-valued fields (`TOKENS_INSIDE`) when they come.
- **On the system** (0061): a fill of several layers, or a gradient, is on the system when each of
  its colours is a token or a keyword that is no value (`transparent`); one raw stop or raw colour
  layer puts it off.
- **The code** (0024): a gradient of two or three stops placed in percent is Tailwind's own
  utilities, `bg-linear-<angle>` or `bg-linear-to-<side>`, `bg-radial`, `bg-conic-<angle>`, with
  `from-`, `via-` and `to-`, a token stop by its colour's name and a position only where it is not
  Tailwind's default; a colour under it is its `bg-` utility. Tailwind's named utilities mix in
  oklab, so a gradient that names its colour space takes them, with a modifier for one other than
  oklab (`/oklch`); one that names none is mixed as CSS mixes it, which only an arbitrary
  position says (`bg-linear-[90deg]`). What they cannot say (more stops, a stop placed in a
  length, several gradients) is one arbitrary `bg-[…]`, its tokens as their variables. A gradient's
  parts count separately across breakpoints, so a breakpoint's colour bounds the base's gradient.
- **The editor writes gradients in oklab.** A colour turned into a gradient in the inspector is a
  linear gradient from it to transparent, `in oklab`: it mixes without the grey a mix in sRGB
  gives, and it is written as Tailwind's plain utilities. A gradient written otherwise keeps its
  colour space.
- **The inspector.** The Fill section lists one row per layer, labelled by its kind; a colour's row
  is the colour field, a gradient's its stops. Every row's swatch draws its layer and opens a
  popover titled for it (0102: the section lists, the popover edits one layer): Kind (Colour or
  Gradient), a gradient's Shape, its stop bar (pressed, it adds a stop there; a stop dragged or
  moved with the arrow keys goes where it is let go) with a colour field per stop, and its Angle.
  The section's + puts a colour on top, its colours open; a row's − takes its layer off, the last
  one the fill. Every change writes the whole fill through the fill's field, one edit, at the
  view's breakpoint (0036) and on an instance's layer as its override (0114). Nodes whose fills
  differ show one field reading Mixed. Layers are not reordered; one is taken off and added again.
- **Where a stop sits.** A stop's place is a share of its gradient: a percentage, or a conic
  gradient's angle as its share of the turn (`90deg` is 25%), which is how it is written once a
  stop of it is moved or taken off. A stop placed in a length (`10px`, `calc(…)`) cannot be said
  in percent without the box: such a gradient is drawn on its bar with no stop to move, a note
  saying so, its stops' colours edited and a stop taken off leaving the others as written.
- **The Figma import** (0016) reads linear, radial and angular gradients, each at the angle its
  paint's transform gives: a linear one's stops placed where its handles' ends fall on CSS's
  gradient line, a radial one as an ellipse at its centre, an angular one as a conic gradient from
  its start handle; each stop the colour token that holds its colour, raw where none does.

## Consequences

- No page changes: a plain colour and every gradient already written open as layers, and the
  document is written only when a layer is edited.
- A system component's look and the canvas's page defaults keep their colour fields: a look's
  fields are written as the component's classes, and layers there would be a second writer.
- Image layers (UP-148) extend the codec with an image kind; until then a fill holding an image
  is one row kept as written.
- The canvas-and-code test compares gradients by their stops' drawn positions, and reads the
  declarations Tailwind nests in `@supports`.
