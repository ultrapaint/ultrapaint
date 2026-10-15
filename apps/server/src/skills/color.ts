/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const color = {
  name: "color",
  text: `# Colour

Colour is meaning first. Use the design system's semantic tokens for what a thing is, and reach
into a palette only when the semantic set has nothing for it.

Colour has exact answers, so compute them: \`read_design_system\` gives every token's value in
every theme. A contrast you did not compute is a guess.

## Tokens by role

Surfaces, text and borders come from semantic tokens: background, foreground, muted, border,
primary, destructive and their pairs. A palette colour (\`"$color-blue-500"\`) on a screen is a
decision the design system did not make; use one only where DESIGN.md's Colors section does.

## A token only in its role

Pick a token for the job its name says, never for the value it has today. The border token used
as a text colour fades the day borders get lighter. When a role has no token, tell the user
rather than borrowing one.

## One accent

The primary colour marks the primary action and the current selection. On a button it is the
fill, with its foreground pair for the label; accent text on a neutral button reads as a link.
Headings, icons and borders stay neutral.

## One colour, one meaning

A hue means one thing across the product, and hues within about \`15°\` of each other count as the
same one. If the accent means interactive, static text in it invites clicks.

## Status colours report status

Success, warning and destructive say that something happened or will. They stay off decoration
and off chart series.

## Text on a colour takes its pair

Text on primary takes primary-foreground, on destructive destructive-foreground: that pair is
what reads in every theme. Text over a photograph sits on a scrim or a solid surface.

## States are steps of one role

Hover and pressed are a shade of the same fill: the hover tokens when the system has them, the
fill at \`90%\` opacity when it has not. Selected is the accent's subtle fill, focus is the ring
colour, disabled is \`50%\` opacity. A state brings no new hue.

## Charts

The chart colours, in their order. Sequential data is one hue from light to dark; diverging data
is two hues around a neutral midpoint.

## Every theme

A fill that works on light may vanish on dark. For every pair you set, compare the two tokens'
values in each theme the design system has.

## Before you finish

| You see | Fix |
| --- | --- |
| A hex or \`rgb()\` value in \`fill\`, \`color\` or \`border\` | The semantic token for that role |
| A palette token in a component's colours | The semantic token it stands for |
| The accent on headings, icons or dividers | Neutral; the accent stays on the action and the selection |
| A status colour as decoration or a chart series | Neutral, or the chart colours |
| Hard-coded white or grey text on a coloured fill | The fill's foreground pair |
`,
} as const;
