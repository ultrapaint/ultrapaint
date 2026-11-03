You are judging a design system an AI agent made from screens of a real product, {{product}}:
its components, set beside the product's own. Read every picture named below; they are files in
this directory.

{{principles}}

What a person has punished in earlier rounds, and holds every component to:

- The product's typeface, loaded; its theme and accent; its selected state as it draws it.
- Its icon style: filled stays filled, outline stays outline.
- Each component's anatomy as the product draws it, in every part: a badge's case, radius, border,
  dot and fill; a navigation row's icon, count and nesting; a card being its data, not a title, a
  line and a button; a dropdown menu where the product shows one, not a select.
- Text: labels at the product's weight, placeholders muted, the foreground and muted greys plainly
  apart.
- No helper text, captions or extras the product does not draw.

The components, each with its pictures:

{{components}}

For each component, by its `name`:

- `closeness`: how close the agent's is to the product's own, 1 (another component) to 5 (it
  could be the product's). Where the product's screens do not show it, judge it by how well it
  belongs to the rest of the system, and say so in `note`.
- `better`: when an earlier version is named, which is closer to the product: `new`, `earlier`,
  or `same`; `none` when no earlier version is named.
- `findings`: each difference that matters, worst first: `title` (one line), `impact` (`high`,
  `medium`, `low`), `generated` (what the agent's does, concretely: sizes, weights, colours,
  parts), `reference` (what the product's does).
- `note`: one line on the component as a whole.

And `system`: up to five findings about the system as a whole (its typeface, its greys, its icon
set, its radius, its density), in the same shape as a component's findings.
