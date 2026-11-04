---
id: g43
title: A name that can't truncate
kind: missed
status: testing
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-26, rated real)
skill: [references/typography.md]
sections: [changes]
---

**What happened.** The FileRow name span has `shrink-0`, so `truncate` never applies. A long name pushes out the folder and overruns the status letter.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 0/2. The person rated it real
(`decisions/held-out-rest`, changes-26). Theme: type.

**The skill now.** `typography.md` covers styles, sizes, weights, truncation ("A name or a title in a dense row truncates to one line") and field labels. It doesn't name names in a list (they read first), tabular figures, or an edit field that must keep the text where it was.

**Proposed.** In `typography.md`'s table: "Names in a list in the body weight, as heavy as their metadata → the label style"; "Tabular figures in a face whose 1 is narrow, on numbers read alone (a size, a date) → proportional; tabular only in columns to compare"; "An inline edit that moves the text or changes its weight → the field takes the text's style and place"; "A truncating name that can't shrink → it truncates, its metadata gives way first".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 0/2 (+1 partly), held-out-plain 0/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no wording caught it more often than the shipped skill (`held-out-themes` and `held-out-plain` alike); its row was not shipped. Spacing ones (g34, g35, g37) are for `pnpm evals measure` to check instead.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
