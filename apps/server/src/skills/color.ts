/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const color = {
  name: "color",
  text: `# Colour

Colour is meaning first. Use the design system's semantic tokens for what a thing is, and reach
into a palette only when the semantic set has nothing for it.

- Surfaces, text and borders come from their semantic tokens (background, foreground, muted,
  border, primary, destructive and their pairs). A named palette colour on a screen is a
  decision the design system did not make; avoid it unless DESIGN.md says otherwise.
- One accent. The primary colour marks the primary action and the current selection; spreading
  it over icons, headings and borders makes nothing stand out.
- Status colours mean status: success, warning, destructive tell the user something happened
  or will. Do not use them to decorate.
- Text on a colour uses that colour's foreground pair, so it reads in every theme.
- Interaction states are colour steps of the same role: hover and pressed are a shade of the
  fill (the design system's hover tokens when it has them, the fill at a lower opacity when it
  does not), selected is the accent's subtle fill, focus is the ring colour. Do not invent a
  new colour for a state.
- Charts use the design system's chart colours, in their order, and never the status colours
  for series. Sequential data is one hue from light to dark, not a rainbow.
- Contrast is not optional: body text on its background, and small text most of all, must be
  readable. When it looks light, it is too light.
- Every theme the design system has must work: a fill that is fine on light may vanish on dark.
  Check the other theme before calling a screen done.
`,
} as const;
