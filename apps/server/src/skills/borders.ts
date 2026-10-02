/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const borders = {
  name: "borders",
  text: `# Borders and radius

Borders separate and outline; radius gives everything one shape. Both come from the design
system, and both are used less than it seems.

## A border marks an edge that must be seen

A field, a card on the same surface as the page, a table, a selection. Grouping is spacing's job
first.

## Widths from tokens

The default width, usually \`1px\`, for outlines and dividers. A thicker one, usually \`2px\`, for
selection and focus only. Use the \`borderWidths\` tokens when the system has them.

## Border colours by role

The border token for dividers and cards, the input token for fields, primary or ring for what is
selected or focused, destructive for a field in error.

## One radius family, by size

Small controls such as a badge or a checkbox take the small radius. Buttons and fields take the
default, cards and dialogs a larger one, avatars and pills full. The same kind of element always
takes the same radius.

## Concentric corners

An element inside a rounded container takes the outer radius less the padding between them: a
\`16px\` card with \`8px\` padding holds \`8px\` corners. Past \`24px\` of padding they are separate
surfaces; pick each radius on its own.

## Square where it meets

Tables, full-bleed images, a page's own edges and any side that touches another element stay
square. A segmented group rounds only its outer corners.

## Images take a hairline

An image on a surface takes a \`1px\` border of \`rgb(0 0 0 / 0.1)\` on light and \`rgb(255 255 255 /
0.1)\` on dark, so its edge holds on any background. Pure black or white at low opacity: a tinted
grey reads as dirt on the edge. In code it is an \`outline\` with \`-1px\` offset.

## Before you finish

| You see | Fix |
| --- | --- |
| A card and the button inside it with the same radius | Outer radius less the padding |
| A border colour as hex | The border token for its role |
| Buttons and fields with different radii | The default radius for both |
| Rounded corners on a full-bleed image or a table | Square |
`,
} as const;
