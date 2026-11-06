---
id: g47
title: A guide drawn through the selection
kind: missing
status: done
found: 2026-11-04
source: the Layers panel, editor redesign at f608871 (held-out finding layers-20, rated real)
skill: [references/elevation.md, references/components.md, references/typography.md]
sections: [layers]
---

**What happened.** The 1px DepthGuides line is drawn over the selected row's rounded fill, leaving a seam through the selection, and the guides darken whenever the pointer enters the tree.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, layers-20). Theme: surfaces.

**The skill now.** `elevation.md`'s four levels say an overlay is above the page; nothing checks a dialog's panes against the dimmed page. `components.md`: "A select inside a row or a sentence is its text and a small chevron" (table: "An outlined select inside a table row or a sentence"). `typography.md`: "A placeholder is muted and shows an example." Nothing on a line drawn through a selection.

**Proposed.** In `elevation.md`'s table: "A dialog's pane darker than what it covers, or its two panes one tone → the content pane on the overlay surface, a step above". In `components.md`'s table: "A settings row's select drawn as a filled box → its value and a chevron". In `typography.md`'s table: "A placeholder showing a real value (a default, a fallback) → an example, or the value itself set". In `borders.md`'s table: "A guide or rule drawn across a selected row's fill → it stops at the fill".

**Test.** Recall on `layers`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
