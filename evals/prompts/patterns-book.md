You are writing a pattern book of how {{product}}, very well designed, builds its
interface, for AI design agents to learn from. Its pieces were catalogued one by one; the counts
and the notes are in this directory:

- `counts.json`: per kind of piece and overall, how often each pattern appears.
- `notes.json`: every piece's observations, by kind.
- `skills/`: the design skill the agents are taught, as a round recorded it: `SKILL.md`, its
  core, which holds every rule, and the files under `references/` with their detail. Read the
  core and the file of each kind of piece the counts have. (A round from before the one skill
  has its skills there, one file each: read every one.)

{{principles}}

Write the pattern book in markdown:

1. Per kind of piece (dialog, settings page, table, navigation, menu, form, empty state…, as the
   counts group them, the most frequent first): how it is built, as rules with numbers:
   "Dialogs (34): a featured icon, a title of 2–4 words and one line of description in 80%; the
   footer is two buttons of equal width in 60%; 24 px padding". Only what the counts and notes
   support; say how many pieces each rule rests on.
2. Across kinds: grouping (cards, dividers, space), how much descriptive text and where, spacing
   ratios, action hierarchy and placement, type scale, where icons go and where they do not, what
   the accent marks.
3. Where these pieces and the skill differ: each difference, what the skill says and in which
   file, what the pieces do and how often, and whether the skill is right. A difference worth
   acting on is a gap to measure, not a change to write.
4. Where these pieces and the principles above differ (descriptive text, labels, icons…): each one,
   neutrally, for the person to settle.

Answer with the book alone, starting at its first heading.
