/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const borders = {
  name: "borders",
  text: `# Borders and radius

Borders separate and outline; radius gives everything one shape. Both come from the design
system, and both are used less than it seems.

- Space separates before a border does. Add a border, a divider or a card only when spacing
  alone does not make the grouping clear.
- Border widths come from the design system: the default (usually one pixel) for outlines and
  dividers, a thicker one only for selection and focus. Use its \`borderWidths\` tokens when
  it has them.
- Border colours are the border tokens: the default border for dividers and cards, the input
  border for fields, the primary or ring colour for what is selected or focused, the
  destructive colour for a field in error. Never a palette grey picked by eye.
- One radius family. Pick the radius token by size: small controls (a badge, a checkbox) a
  small one, buttons and fields the default, cards and dialogs a larger one, avatars and pills
  full. The same kind of element always has the same radius.
- Nested corners stay concentric: an element inside a rounded container with padding takes a
  smaller radius, about the outer radius less the padding.
- Square things stay square: tables, full-bleed images, a page's own edges and anything that
  touches another element on that side.
`,
} as const;
