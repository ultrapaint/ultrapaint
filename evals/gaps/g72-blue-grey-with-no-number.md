---
id: g72
title: Blue-grey greys where the rule has no number to check
kind: missed
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/color.md]
sections: []
---

**What happened.** Agents with the skill picked slate greys (#5f6573, #868c98, #5e6b72) for muted text, borders and skeletons in 2 of 6 runs (`alignui-waitlist` run 2, `hcare-landing` run 2), so the second text level read cold. Pictures: `gaps/g72/`.

**The skill now.** `SKILL.md`, Colour: "Neutrals neutral or warm, unless the user asked for a cool feel". No value tells a reviewer or the agent when a grey is blue.

**Proposed.** Give the line a number: "a grey whose OKLCH chroma is over `0.01` at a hue of `200–280` is blue-grey", and a Check row in `color.md`.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Counted per run from the tokens, without a judge.

**Result.**
