You are finding what the design skill an AI design agent is taught fails to teach. A round of
runs has been judged: in each run an agent designed a screen from a brief, and a judge compared
its design with the reference the brief was written from.

{{principles}}

In this directory:

- `findings.json`: every finding of every run. Its id is `<reference>/<run>#<n>`; `level` is the
  level of design it is at (layout, hierarchy, components, restraint, typography, color, spacing,
  craft); `skill` is the file of the skill whose subject it is (`SKILL.md`, its core, or a file
  under `references/`; a skill's name in a round from before the one skill); `coverage` is
  `not-covered` (the skill does not say it), `covered-not-followed` (the skill says it and the
  agent did not do it), `rule-misleads` (following the skill made it worse) or `tool-limitation`
  (the editor could not do it). `person: confirmed` marks a finding a person looked at and agreed
  with, with what they said; those they rejected are already left out.
- `unwanted-text.json`: texts the agents wrote that the brief did not have and that should not be
  there: what "less is more" measures.
- `review-notes.md`: what a person said while reviewing the round. It outweighs the judge: a gap
  a person names is a gap, and their reasons are the best wording for a rule.
- `strengths.json`: what each run did well.
- The design skill the agents were taught, in {{skills}}. `SKILL.md` is its core: the steps of a
  design and every rule that bears on most screens, a line each with its value; a check runs
  those lines against the screen. The files under `references/` hold what a line cannot, a kind
  of screen or page or a topic, each ending on a check table of what it adds. Read the core
  whole, and every file a finding names.

The runs:

{{references}}

1. Group the findings into gaps. A gap is one shortcoming of the agents, seen in one or more runs,
   whatever words each judge used for it. Every finding id goes in exactly one gap; a finding of a
   single run is a gap of its own.
2. Each gap gets:
   - `title`: the shortcoming, in a few words.
   - `level`: the level of design it is at.
   - `skill`: the file of the skill that should teach it, by its path in the skill: `SKILL.md`
     for a rule that bears on most screens, a file under `references/` for what only that kind
     of screen or that topic has, or `none`.
   - `kind`: `missing` (the skill does not teach it), `ignored` (the skill teaches it and agents
     do not do it), `misleading` (a rule of the skill makes it worse), `tool` (the editor is the
     limit, not the skill).
   - `summary`: what the agents do, and what good design does instead, in two sentences.
   - `now`: what the skill says of it today, quoted with the file it is in; empty when nothing
     does.
   - `proposal`: the one change to try, the smallest that would work: the line to add to the core
     or the row to add to a file's check table, the rule to sharpen and how, or the rule to
     remove; for `tool`, what the editor lacks. An `ignored` rule is fixed by making it harder
     to miss: an exact value, a test the agent can run, a row in its file's check table that says
     what it looks like when it is broken. A rule restated in other words stays ignored. Write it
     as the skill writes one: true for any product, with numbers, free of any reference's
     content. Never the whole text of the skill or of one of its files: a change is measured as a
     gap before the skill changes.
   - `test`: how to tell whether the change works, in a sentence: what a reviewer or a check
     looks for, and on which kind of screen.
3. `strengths`: 3 to 8 things agents already do well across runs, for the skill to keep.
