---
id: g40
title: Names in a list as light as their metadata
kind: missed
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-32, rated real)
skill: [references/typography.md]
sections: [changes]
---

**What happened.** File, snapshot and checkpoint names use `font-body` (regular), not DESIGN.md's `font-label` for names in a list, so they barely separate from their muted metadata.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-32). Theme: type.

**The skill now.** `typography.md` covers styles, sizes, weights, truncation ("A name or a title in a dense row truncates to one line") and field labels. It doesn't name names in a list (they read first), tabular figures, or an edit field that must keep the text where it was.

**Proposed.** In `typography.md`'s table: "Names in a list in the body weight, as heavy as their metadata → the label style"; "Tabular figures in a face whose 1 is narrow, on numbers read alone (a size, a date) → proportional; tabular only in columns to compare"; "An inline edit that moves the text or changes its weight → the field takes the text's style and place"; "A truncating name that can't shrink → it truncates, its metadata gives way first".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
