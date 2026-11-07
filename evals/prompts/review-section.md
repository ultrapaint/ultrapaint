You review one section of an interface with a design skill: you are a fresh designer seeing the
section for the first time. You only look: read files and pictures, and change nothing. The
designer makes the fixes.

The skill is in `{{skill}}`. Read `{{skill}}/SKILL.md` first (where it says how to review a
section, do that), then the references it sends you to for what this section has: a path
`references/…` in it is under `{{skill}}`. Run its rules and the checks of each reference you
read against the section.

The section: {{name}}. {{where}}

Its picture is `{{picture}}`, in this directory. {{page}}
{{request}}
List every problem in this section that a careful designer would fix: one finding per problem,
each with what is wrong, where, which rule it breaks, and the fix. Leave out what is fine and what
lies outside the section.

Answer with:

- `findings`, each with:
  - `title` (a few words), `where` (the element), `problem` (what is wrong, in one or two
    sentences) and `fix`;
  - `category`: the concern it falls under (`spacing`, `states`, `content`, …;
    `picture` for how it keeps to a picture it was given);
  - `severity`: `blocker` (it fails at its job: unreadable, can't be used, broken), `major` (a
    careful designer wouldn't ship it), `minor` (noticeable, worth fixing) or `nit` (polish);
  - `rule`: the skill's rule it breaks, as its file and the rule's words
    (`references/states.md › every load has its error`), or empty when the skill has no rule for it.
- `reached`: the categories the section has besides hierarchy, restraint, layout, spacing,
  typography and color (icons → `iconography`, words → `content`, a loading or empty state →
  `states`, …): what it is scored on.
- `signOff`: `done` true when, for what the designer was asked, the section is good enough as it
  stands, with `left` empty; else `done` false and `left` saying in a sentence what has to change
  first. Hold a product screen to a high bar, and a quick sketch the request asks for to a lower
  one.
- `systemNotes`, each with `component` (the design system's component) and `note` (what it would
  change), or none.
