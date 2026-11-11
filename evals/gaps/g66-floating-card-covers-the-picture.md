---
id: g66
title: A floating card that covers the product picture's content
kind: missing
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md, references/surfaces.md]
sections: []
---

**What happened.** On `hcare-landing` run 1 the "3,256 Total Patients" card lifted over the dashboard picture covers its pie and donut charts; in run 2 the cards cut tiles in half and the picture took the same shadow as the cards over it. The no-skill cards sat over empty corners of the frame. Craft went to no skill on this page in both runs; the per-run judge found it in both. Pictures: `gaps/g66/`.

**The skill now.** Nothing on cards laid over a product picture. `landing.md`: "One image per section may cross an edge." `surfaces.md`: a shadow belongs to a level.

**Proposed.** `landing.md`, By character, Technical: "A card lifted over the product picture covers empty space or the picture's edge, never a chart, a figure or half an element, and stays inside the container; the picture lies at the default level and only the lifted cards take the raised shadow." A Check row for it.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: `held-eease`, `held-workos-atlas`.

**Result.**
