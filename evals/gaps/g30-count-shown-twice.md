---
id: g30
title: A count shown twice, a row apart
kind: missed
status: wontfix
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-24, rated real)
skill: [references/restraint.md]
sections: [changes]
---

**What happened.** "9 files changed" in RepoStatus repeats the "9" on the Design files group label one row below.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 2/2. The person rated it real
(`decisions/held-out-rest`, changes-24). Theme: repeat.

**The skill now.** `restraint.md`'s table: "A heading, caption or description that repeats what is beside it → Remove it". It holds for neighbours. A value repeated a panel away (g16), or a route that is its page's name in lower case, isn't "beside".

**Proposed.** In `restraint.md`'s table: "A value the window already shows elsewhere (a size on its frame, a count on its group, a title its nav item names) → once, where it is read or set"; "A second line that is the first in another form (a route that is its name) → only where it differs". Related: g16 (`wontfix`, caught 2/2 on the new chat, 0–1/2 here).

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no new wording: the shipped skill caught it 2/2 with a fresh reviewer per section, so what missed it was how the redesign was run (p02), now step 7 of SKILL.md.
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 1/2, shipped@cursor:grok-4.7-high 0/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 1/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
