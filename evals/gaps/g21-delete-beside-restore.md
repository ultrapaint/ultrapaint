---
id: g21
title: Delete beside Restore in the same style
kind: missing
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-10, rated real)
skill: [references/states.md]
sections: [changes]
---

**What happened.** In the snapshot row's hover actions, Delete is a ghost icon in the same style right beside Restore and Compare, one slip away, with no visible confirm or undo.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-10). Theme: danger.

**The skill now.** `states.md`, "Destructive actions confirm or undo": "Ask first, naming what will be lost, or act at once and offer an undo that stays until dismissed." It says *or*, and nothing about where the destructive control sits or a confirm added where an undo exists.

**Proposed.** In `states.md`'s table: "A destructive action beside safe ones in the same style → apart, in the row's menu, or its destructive variant; with its undo"; "A confirm for an action that can be undone → act and offer the undo; a confirm names what is lost, in its title".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
