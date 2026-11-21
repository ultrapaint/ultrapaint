---
id: p13
title: The skill worded for the editor
kind: process
status: open
found: 2026-11-21
source: an audit of the skill's independence from the editor (thread of 2026-11-20)
skill: [SKILL.md, references/color.md, references/review.md, references/kinds/form.md, references/system/components.md]
sections: []
---

**What happened.** The skill ships on its own (`npx skills add`) and is read the same way inside
the editor and outside it, yet some of its lines are written for the editor:

- `SKILL.md` step 6 says "Where your work is reviewed for you (an editor's review loop), answer
  its findings": the editor's review loop (ADR 0063), named.
- `references/color.md`: "A design system names its semantic tokens in one of two presets", simple
  or detailed. Those are the editor's token presets (`TokenPreset`, ADR 0062); a system outside the
  editor may name its tokens neither way (a numbered scale, its own role names).
- Examples taken from the editor's own screens, where an ordinary product's would serve: "a size
  on its frame" (`SKILL.md`, Restraint; `references/review.md` W10), "a change badge sits at the
  row's far right" (`SKILL.md`, Components), "an inspector, settings beside a canvas"
  (`references/kinds/form.md`).
- `references/system/components.md` makes a component the React way (`cva`, `className` and
  `style`, an `Icon` with `icon="search"`), the stack the editor supports, as the only way.

Where the skill can use something the agent may have (a question tool, another agent, a reviewer
that sends findings), it says so in passing, step by step; what the editor gives in each place is
the briefing's `skillTerms`, which covers only some of them.

**The skill now.** `skills/README.md`: "The skill speaks the web's terms, with none of the editor's
words: the briefing's `skillTerms` says them in the editor." The guard test
(`apps/server/src/skills/skills.test.ts`) catches the editor's tool names and fields, not the
words "editor", "Ultrapaint" or the presets.

**Proposed.**

- A short "Where you work" part near the top of `SKILL.md`: what an environment may give (a
  reviewer that sends findings, a way to see the screen at a width, a store for the design system,
  each component's documentation), used by the step that names it where it is there, and what the
  step does where it is not. Each step names the capability in those words; `skillTerms` says,
  line for line, what the editor gives for each.
- Step 6: "Where a reviewer sends you findings, answer them. Elsewhere, …".
- `color.md`: use the naming the system has; simple roles and tokens by property and meaning are
  two common forms, given as examples. The briefing keeps saying which one a project of the
  editor uses (`DETAILED_NOTE`).
- The editor's examples replaced by an ordinary product's.
- `system/components.md`: the principle (variants as a map, typed props, the outer element takes
  what a screen passes) with `cva` and `className` as one example of it.
- The guard test also fails on "Ultrapaint" outside the front matter and the title, and on
  "editor", "canvas" and "preset".

The name stays `ultrapaint`: it is the skill's label, not a reference to the editor.

**Test.** A recall round, `--skills built-in,candidates/<fix>`, on the existing sections: recall
holds. A fresh-brief round with the candidate outside the editor and in it: no tell rises, and
inside the editor the agent still answers the review loop and uses the editor's tools where
`skillTerms` names them.

**Result.**
