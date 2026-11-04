---
id: g25
title: A loading state a failure leaves forever
kind: missing
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-19, rated real)
skill: [references/states.md]
sections: [changes]
---

**What happened.** If `git.status` fails, `status` stays null and the panel shows "Reading the history…" indefinitely, with the error only in a toast.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-19). Theme: states.

**The skill now.** `states.md` draws "Loading, and the error" for what waits on the network, and "Errors sit where they happened". It says nothing about a loading state that never ends when the read fails, a field that saves without showing it, or an empty state that doesn't say the list is empty.

**Proposed.** In `states.md`'s table: "A loading state with no way to end but success → the error in its place, with a retry"; "A field that saves on blur with nothing shown → saving and saved beside it, its error under it"; "An empty state that doesn't say it's empty → \"None yet\" and the action that fills it".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2 (+1 partly), shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
