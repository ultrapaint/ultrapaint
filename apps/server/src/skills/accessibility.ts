/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const accessibility = {
  name: "accessibility",
  text: `# Accessibility

A design that some people cannot use is not done. Design for keyboards, screen readers, low
vision, colour blindness and large text from the first frame, not as a fix later.

- Contrast meets WCAG AA: 4.5:1 for body text, 3:1 for large text (about 18px bold or 24px),
  icons, field borders and focus rings. Muted text and placeholder text are where it fails
  first; check them in every theme.
- Colour is never the only signal. Status has an icon or a word as well, a link in text is
  underlined or otherwise marked, a chart's series differ by more than hue.
- Everything that can be clicked can be reached with the keyboard, in reading order, and shows
  a visible focus ring in the ring colour. Never remove the focus style without a replacement.
- Targets are at least 24×24 px, 44×44 px on touch screens, with space between neighbours.
- Every field has a visible label; a placeholder is not one. Errors are tied to their field and
  say how to fix them. Required fields are marked, and the mark is explained.
- Structure is real: one level 1 heading, headings in order, lists as lists, tables for tabular
  data, buttons for actions and links for navigation. Landmarks (header, nav, main) frame the
  page.
- Images that carry meaning have alt text; decorative ones have none. An icon-only button has
  an accessible name.
- Text can grow: layouts survive 200% text size and a 320px wide viewport without hiding or
  overlapping content.
`,
} as const;
