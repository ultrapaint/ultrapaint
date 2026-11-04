---
id: g22
title: A blocking confirm for what undo can take back
kind: missing
status: testing
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-31, rated real)
skill: [references/states.md]
sections: [changes]
---

**What happened.** The "Revert to this checkpoint?" dialog says undo can take it back, yet it still blocks with a three-sentence confirm whose title doesn't name the checkpoint.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-31). Theme: danger.

**The skill now.** `states.md`, "Destructive actions confirm or undo": "Ask first, naming what will be lost, or act at once and offer an undo that stays until dismissed." It says *or*, and nothing about where the destructive control sits or a confirm added where an undo exists.

**Proposed.** In `states.md`'s table: "A destructive action beside safe ones in the same style → apart, in the row's menu, or its destructive variant; with its undo"; "A confirm for an action that can be undone → act and offer the undo; a confirm names what is lost, in its title".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), held-out-themes 1/2 (+1 partly), held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): the row ships, but caught it only 1/2 (with one partly): it stays `testing` until a design round shows it.
