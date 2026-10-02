/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const components = {
  name: "components",
  text: `# Components

The design system's components are the vocabulary. Compose with them before drawing anything of
your own, and use them the way they were meant.

## Look before you draw

For a button, a field, a badge, a dialog or tabs, find the component in the palette and ask
\`get_component\` for its props and variants. A copy drawn from rows and text matches nothing, and
gets implemented as nothing.

## Variants carry the meaning

A destructive action is the destructive variant, a secondary action the secondary variant, a
small button the size prop. A default button filled red, or a primary shrunk, says something the
system does not.

## The component owns its look

Size an instance with \`width\` and \`height\`; restyle it only through its props and variants. When
none fits, choose another component or ask the user. Text inside a component is its \`text\` or
its children.

## Forms are fields

A form is labelled field components in one column, with the primary action at the end. Two
fields share a row only when they are one thing: a city and its postcode.

## Real props

Start from \`get_component\`'s example and replace every placeholder in it with real content.

## New pieces are named

What the system truly lacks is built from rows, text and tokens, named for what it is ("Plan
card"). Tell the user it is new: it will need building as a component.

## Before you finish

| You see | Fix |
| --- | --- |
| A row with a fill, a radius and a text that looks like a button | A Button instance |
| \`fill\`, \`radius\` or \`border\` set on an instance to restyle it | A variant or a prop |
| A text node laid over an instance | The instance's own text |
| "Button" or "Label" left from an example | A real label |
`,
} as const;
