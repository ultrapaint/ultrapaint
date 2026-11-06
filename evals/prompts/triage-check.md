Review models found the problem below in several designs. Decide whether it should become a gap
of the design skill: a place where designs made with the skill go wrong, which the lab then tries
to prevent with a change to the skill.

The skill is `skills/ultrapaint/` in this repository: `SKILL.md` routes to the references in
`references/`. The gaps already recorded are the files of `evals/gaps/` (`README.md` says what a
gap is). Read what you need of both before answering.

Answer:

- `real`: the findings describe a real defect a person would notice or that breaks a rule of the
  skill, not one reviewer's taste.
- `general`: it would hold for designs beyond these, in other products; a problem only these
  screens could have is not general.
- `kind`: `missed` when the skill already has a rule that prevents it (it was not applied),
  `missing` when it has none, `process` when it is about how the skill is run (reviewing,
  checking, briefing) rather than what it says.
- `rule`: for `missed`, the rule as `references/<file>.md › <heading or table row>`, quoted
  briefly; empty otherwise.
- `gap`: the id of a gap in `evals/gaps/` that already covers this problem (`g12`), or empty.
- `title`: the gap's title, the problem in a few words ("Groups as close as their rows").
- `happened`: two to four sentences: what the reviews found, where, and why it matters.
- `proposed`: the rule or check to try, in the skill's voice, short and specific; for `missed`,
  what would make the existing rule applied (a wording, a "Before you finish" row).
- `test`: how a lab round tells whether the change works, in a sentence.
- `skill`: the skill's files it concerns, as paths from `skills/ultrapaint/`.

The problem: **{{title}}**

{{findings}}
