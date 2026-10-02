/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const accessibility = {
  name: "accessibility",
  text: `# Accessibility

A design that some people cannot use is not done. Design for keyboards, screen readers, low
vision, colour blindness and large text from the first frame, not as a fix later.

These are requirements, not preferences. When DESIGN.md or a request conflicts with one, tell
the user what fails.

## Contrast meets AA

Text needs \`4.5:1\` against what it sits on, large text (\`24px\`, or \`18.7px\` bold) \`3:1\`. Icons,
field borders and focus rings need \`3:1\`. Compute it from the two token values in every theme;
muted and placeholder text fail first.

## A second signal beside colour

Status carries an icon or a word, a link in running text is underlined, and a chart's series
differ by shape or label as well as hue.

## Focus is visible

Everything clickable is reachable by keyboard in reading order. Its focus ring is \`2px\` in the
ring colour, \`2px\` off the edge. Draw the focused state of any control you design yourself.

## Targets

At least \`24×24px\` everywhere, \`44×44px\` on touch and \`40×40px\` on desktop where density allows.
A small icon button reaches its target with padding, and neighbouring targets never overlap.

## Visible labels

Every field has a visible label; a placeholder is only an example. An error is tied to its field
and says how to fix it. Mark whichever of required or optional is rarer, and explain the mark.

## Real structure

One level 1 heading per page and levels in order below it. Lists are lists, tabular data is a
table, buttons act and links navigate. A header, a navigation and a main region frame the page.
In code, native elements come before ARIA.

## Names for what has no words

An image that carries meaning has \`alt\` text saying the meaning; a decorative one has an empty
\`alt\`. An icon button is named for its action: "Search", not "magnifying glass".

## Text can grow

The layout survives \`200%\` text size and a \`320px\` viewport without hiding or overlapping
content. Text containers grow with \`hug\` and \`minHeight\` rather than a fixed height.

## Before you finish

| You see | Fix |
| --- | --- |
| Muted text at \`12–14px\` on a tinted surface | Compute it; the foreground colour if it fails |
| Status shown by colour alone | Add an icon or a word |
| An icon button under \`24px\` square | Pad it to the target size |
| A field with only a placeholder | A visible label |
| Heading levels jumping from 1 to 3 | Levels in order |
| An informative image with no \`alt\` | Describe its meaning |
| A fixed \`height\` on a box of text | \`hug\` or \`minHeight\` |
`,
} as const;
