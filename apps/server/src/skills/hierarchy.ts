/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const hierarchy = {
  name: "hierarchy",
  text: `# Hierarchy

Every screen has one thing it is for. Make that the first thing the eye lands on, and rank
everything else below it.

- One primary action per screen, in the primary style. Secondary actions are outlined or plain;
  destructive ones sit apart from them.
- The page title states what the screen is, in a few words. Do not repeat it in the first
  paragraph or in a card below it.
- Order follows use: what the user reads first goes first, what they do most goes where the hand
  rests. Do not sort by what was easiest to build.
- Group by proximity and separation, not by boxes. Related controls sit close; unrelated ones are
  separated by space before they are separated by a border or a card.
- Nesting stops at three levels. A card in a card in a card says nothing a heading and spacing
  would not say better.
- Align to a few edges. Left edges of text line up; labels and values share a baseline; every
  column starts at the same x. A screen with many edges reads as noise.
`,
} as const;
