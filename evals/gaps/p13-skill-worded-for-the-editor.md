---
id: p13
title: The skill worded for the editor
kind: process
status: done
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
- `up88-names`: 2026-11-22, reviewers that open the skill, 17 sections × 3 runs (Opus reviewing
  and judging, effort high; runs/up88-names/report.md). There `up88-shipped` is main's skill,
  `up88-names` this change and `shipped` the review method on top (p14), at 8ddc22d9. Caught:
  main 117/168 (70%, +24 partly), this change 123/168 (73%, +19 partly), +4 points (−2 to +9);
  with p14 113/165 (68%), −1 point (−7 to +4). Recall holds. Findings no gap matched, per review:
  13.8, 13.4, 12.3, unrated.
- `up88-fx-shipped` against `up88-fx`: 2026-11-22, fresh briefs outside the editor (sprint board,
  patient intake, team calendar, charity home; 2 runs each, Opus in Claude Code, plain host), main's
  skill against this change with p14's. Tells: a side stripe on 2 of 8 pages against 1 of 8, none
  other. Blind pairwise (Opus, both orders): main 4, the change 2, ties 2; the judge's reasons are
  the runs' own (a form naming its missing fields or counting them, the brief's photos drawn as
  placeholders in one run of each), none about a line this change touches.
- `up88-editor`: 2026-11-22, in the editor (family host, `untitled-general-settings`, 1 run,
  `--review editor`): the agent used `get_component` and `get_screenshot` where `skillTerms` names
  them, and answered the review loop's findings, declining one with its reason. Its first three
  `get_component` calls by the bare name failed ("No such tool"), as in seven rounds before it.
- Decision of 2026-11-22: shipped with UP-88's first stage (#89).
