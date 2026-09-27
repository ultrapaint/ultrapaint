/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const spacing = {
  name: "spacing",
  text: `# Spacing

Space is the design system's, not the eye's. Every gap and padding is a step of its spacing
scale, and the same relationship is always the same distance.

- Pick from the scale, and from few steps: one for items inside a control, one between related
  elements, one between groups, one between sections. Do not tune a gap to look right once.
- Related things are closer to each other than to anything else. A label sits nearer its field
  than the field above it; a heading sits nearer what it introduces than what came before.
- Padding is even. A card, a dialog, a section has the same padding on every side unless there
  is a reason, and the reason is stated in DESIGN.md.
- Use gap on the container, not margins on the children. A child does not know where it is.
- Let content breathe on wide screens: a reading column stops at a comfortable measure, a form
  stops where its longest field is comfortable, and the rest is space.
- Vertical rhythm outlasts horizontal: when the two disagree, keep the vertical gaps consistent.
`,
} as const;
