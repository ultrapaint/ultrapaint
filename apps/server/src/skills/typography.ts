/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const typography = {
  name: "typography",
  text: `# Typography

Text is set in the design system's text styles. Size, weight and colour are chosen from them,
never invented for a screen.

- Use a named text style for every text node when the design system has them; fall back to the
  scale's tokens only for something the styles do not cover.
- Two or three sizes on a screen are enough: the title, the body, a small one for metadata.
  Contrast comes from weight and colour more than from size.
- Headings are hierarchy, not decoration: one level 1, level 2 for sections, level 3 inside a
  section. Do not skip a level to get a smaller heading; pick a smaller text style instead.
- Body text stays on the body size. Long text at a small size or a large size is hard to read.
- Muted colour is for what supports the text next to it: a timestamp, a hint, a count. It is
  not for whole paragraphs, and never for the primary action's label.
- Line length matters more than font size: a paragraph wider than about seventy characters
  gets a narrower column, not a bigger font.
- Truncate with intent: a single line of a name may be cut with an ellipsis; a message or a
  description wraps.
`,
} as const;
