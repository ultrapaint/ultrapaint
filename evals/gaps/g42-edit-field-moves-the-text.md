---
id: g42
title: An inline edit that moves the text
kind: missing
status: done
found: 2026-11-04
source: the Layers panel, editor redesign at f608871 (held-out finding layers-22, rated real)
skill: [references/typography.md]
sections: [layers]
---

**What happened.** When renaming, the InlineInput's px-1.5 padding and font-body move the name 6px right and drop a page name's medium weight, so the text jumps as editing starts.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, layers-22). Theme: type.

**The skill now.** `typography.md` covers styles, sizes, weights, truncation ("A name or a title in a dense row truncates to one line") and field labels. It doesn't name names in a list (they read first), tabular figures, or an edit field that must keep the text where it was.

**Proposed.** In `typography.md`'s table: "Names in a list in the body weight, as heavy as their metadata → the label style"; "Tabular figures in a face whose 1 is narrow, on numbers read alone (a size, a date) → proportional; tabular only in columns to compare"; "An inline edit that moves the text or changes its weight → the field takes the text's style and place"; "A truncating name that can't shrink → it truncates, its metadata gives way first".

**Test.** Recall on `layers`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2, held-out-themes 2/2, held-out-plain 1/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (+2 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 1/2, copy-outline 1/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 1/2, review-table@opus+told 0/2, review-table@gpt-6.1-sol+untold 0/2 (+2 partly), review-table@gpt-6.1-sol+told 0/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
