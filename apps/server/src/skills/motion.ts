/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const motion = {
  name: "motion",
  text: `# Motion

Motion explains a change: where something came from, where it went, what it is connected to.
It is short, quiet and the same everywhere, and nothing depends on it.

- Animate state changes, not decoration. Opening, closing, moving, expanding and confirming are
  worth a transition; a page that wobbles on load is not.
- Durations come from the design system's \`motion\` tokens. Small changes (a hover, a toggle)
  are about 100–150 ms, things entering (a popover, a menu) about 150–250 ms, larger ones (a
  dialog, a sheet, a page) up to 300–400 ms. Anything longer is waiting.
- Easing has a direction: ease-out for what enters, ease-in for what leaves, ease-in-out for
  what moves from one place to another. Never linear, except for a spinner or a progress bar.
- Things come from where they live: a menu grows from its trigger, a sheet slides from its edge,
  a toast from its corner. Leaving is faster than entering.
- Respect reduced motion: with \`prefers-reduced-motion\` set, movement becomes a fade or
  nothing. No information is only in an animation.
- Loading motion is calm: skeletons shimmer slowly, spinners turn steadily, nothing flashes more
  than three times a second.
- The canvas is still. A design shows the end state of each transition; describe the motion
  in a note on the page, or in DESIGN.md when it is the product's convention.
`,
} as const;
