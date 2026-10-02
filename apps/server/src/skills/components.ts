/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const components = {
  name: "components",
  text: `# Components

The design system's components are the vocabulary. Compose with them before drawing anything
of your own, and use them the way they were meant.

- Look for a component before building one from rows, texts and fills. A button, a field, a
  badge, a dialog exist; a drawn copy will not match them and will not be implemented as them.
- Use variants for what they are for. A destructive button is the destructive variant, not the
  default one filled red; a secondary action is the secondary variant, not a smaller primary.
- Do not override a component's own spacing, radius or colour with node styles. If a component
  does not fit, the answer is another component, a different variant, or a question to the user.
- Text inside a component is the component's text, not a text node laid over it.
- Forms are fields with labels, in one column unless there is a reason, with the primary action
  at the end. Every field has a label; placeholders do not replace them.
- Take a screenshot of what you made and compare it with what you meant. Fix misalignment,
  clipped text and uneven spacing before saying it is done.
`,
} as const;
