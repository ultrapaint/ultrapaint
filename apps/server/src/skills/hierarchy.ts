/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const hierarchy = {
  name: "hierarchy",
  text: `# Hierarchy

Every screen has one thing it is for. Make that the first thing the eye lands on, and rank
everything else below it.

Name the screen's purpose and its primary action in one sentence before placing a node. When you
cannot, the brief is unclear: ask the user.

## One primary action

One action per screen takes the primary variant. The others take the secondary, outline or ghost
variants by how often they are used. A destructive action sits apart from the primary, at the
far end or in a menu. Past three secondary actions, the rest go behind a "More" menu.

## The squint test

Look at the screenshot as if squinting: the content the screen is for and its primary action are
the two heaviest shapes. When five things compete for first place, demote four.

## Rank with position, then weight and colour, then size

Importance goes to the top and the leading edge first. Then a heavier weight or the foreground
colour against muted. Size is the loudest tool and comes last. One tool per step of importance;
all three on one element shouts.

## The title names the screen

The page title says what the screen is in two to four words: "Invoices", "Billing settings". The
text below it adds what the title does not say.

## Order follows use

What the user reads first goes first; what they do most goes where the hand already is. In a
row, the identifying content leads and metadata and actions trail. The one number the user came
for sits at the top of its group, larger than its label.

## Nesting stops at three levels

Past three containers deep, a heading and a gap say more than another box.

## Before you finish

| You see | Fix |
| --- | --- |
| Two buttons in the primary variant on one screen | Keep the one the screen is for; the other becomes secondary |
| The title repeated in the first paragraph or a card heading | Cut the repeat |
| The key figure below its metadata | Move it to the top of its group |
| A card in a card in a card | Replace the inner containers with a heading and a gap |
| Delete beside Save in the same style | Destructive variant, moved apart |
`,
} as const;
