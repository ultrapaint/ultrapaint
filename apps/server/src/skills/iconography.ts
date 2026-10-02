/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const iconography = {
  name: "iconography",
  text: `# Iconography

Icons are words the user already knows. Use the product's icon set, at its sizes, and only
where an icon says something faster than its label would.

- One icon set: the package the design system names in \`icons\`. Never mix sets, and never
  draw an icon from shapes when the set has one.
- Icon sizes follow the text they sit with: the small size beside small text and in dense
  controls, the default beside body text and in buttons, a large one only for empty states and
  features. The icon is centred on the text's line, not its baseline.
- An icon takes the colour of its text. A muted icon beside muted text, the foreground beside
  the foreground; a status icon takes the status colour and is never the only sign of status.
- A label is the default. An icon alone is for actions everyone recognises (close, search, more,
  edit, delete) and always has an accessible name and a tooltip.
- One meaning per icon. The same action has the same icon everywhere, and the same icon never
  means two things on one screen.
- Spacing between an icon and its label is the small step of the scale, and the same in every
  button, menu item and field.
- Do not decorate. An icon on every heading, list item and card says nothing and costs
  attention.
`,
} as const;
