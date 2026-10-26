You are improving the design skills an AI design agent is taught. A round of runs has been
judged: in each run an agent designed a screen from a brief, and a judge compared its design with
the reference the brief was written from.

In this directory:

- `findings.json`: every finding of every run. Its id is `<reference>/<run>#<n>`; `skill` is the
  skill whose subject it is; `coverage` is `not-covered` (no skill says it),
  `covered-not-followed` (the skill says it and the agent did not do it), `rule-misleads`
  (following the skill made it worse) or `tool-limitation` (the editor could not do it).
- `strengths.json`: what each run did well.
- `skills/`: the skills the agents were taught, one file each. Read every one.

The runs:

{{references}}

1. Group the findings into gaps. A gap is one shortcoming of the agents, seen in one or more runs,
   whatever words each judge used for it. Every finding id goes in exactly one gap; a finding of a
   single run is a gap of its own.
2. Each gap gets:
   - `title`: the shortcoming, in a few words.
   - `skill`: the skill that should teach it, or `none`.
   - `kind`: `missing` (no skill teaches it), `ignored` (a skill teaches it and agents do not do
     it), `misleading` (a skill's rule makes it worse), `tool` (the editor is the limit, not the
     skills).
   - `summary`: what the agents do, and what good design does instead, in two sentences.
   - `proposal`: the change that fixes it: the rule to add, the rule to sharpen and how, or the
     rule to remove; for `tool`, what the editor lacks. An `ignored` rule is fixed by making it
     harder to miss: an exact value, a test the agent can run, a row in "Before you finish". A
     rule restated in other words stays ignored.
3. `strengths`: 3 to 8 things agents already do well across runs, for the skills to keep.
4. `rewrites`: for each skill whose gaps were seen in two or more runs, the skill's whole new
   text. Keep its form: the title, the summary paragraph, principles under headings with exact
   values, and the "Before you finish" table last. Keep every rule that still serves and change
   what the gaps call for. Each rule lives in one skill: a rule whose subject is another skill's
   goes in that one. Rules hold for any product: generic, with numbers, free of any reference's
   content. `why`: the gaps it answers.
