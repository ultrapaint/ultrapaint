---
id: g73
title: Stand-in logos drawn as interface icons or crude marks
kind: missing
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/iconography.md, references/pages/landing.md]
sections: []
---

**What happened.** With no logo given, agents drew customer logos from the interface's icon set or as invented shapes in grey discs (`untitled-pricing` both runs), and brand marks that read as a hash or a ticket (`alignui-waitlist`, `hcare-landing`, one run each). Pictures: `gaps/g73/`.

**The skill now.** Nothing on what a stand-in is.

**Proposed.** A Check row in `landing.md`: "Customer logos drawn as interface icons or invented shapes → Short wordmarks or monograms in one grey, one style, said to the user to be stand-ins"; one in `iconography.md`: "A drawn stand-in brand mark that doesn't read at `24–32px` → One simple shape in the ink, said to be a stand-in".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**
