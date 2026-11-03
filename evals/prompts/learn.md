You are learning what a person considers the best design, from their choices. For each card below
they saw the same thing (a component of a design system, or a section of a screen) made several
times by AI design agents, beside the reference it was made from, and picked the best one, or
said none was good. Some left a comment. The pictures are in this directory; read every one.

{{principles}}

The choices, one per card (`picked` is the winner's picture, `others` the ones not picked,
`reference` the original; a pick of `none` means none was good enough):

{{choices}}

1. Look at each card's winner beside the others and the reference: what does the winner do that
   the others do not? Be concrete: sizes, weights, colours, spacing, alignment, borders, what is
   there and what is left out.
2. Group what you see into patterns that hold across cards: what the person rewards and what they
   punish. A pattern seen once is a note; one seen three times or more is a rule. Where a comment
   says why, it is the best wording of the rule.
3. Write each rule as a design skill states one: a principle with an exact value or a test, true
   for any product, and name the skill it belongs to ({{skills}}, or `extract` for how to read a
   design system off pictures, or `none`).

Return `patterns`: each with `title`, `rule`, `skill`, `cards` (the ids it was seen in) and
`strength` (`rule` or `note`); and `summary`: three or four sentences on the person's taste.
