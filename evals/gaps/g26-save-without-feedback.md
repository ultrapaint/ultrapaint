---
id: g26
title: A field that saves and loads with nothing shown
kind: missing
status: testing
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-15, rated real)
skill: [references/states.md]
sections: [settings]
---

**What happened.** The Display name field saves silently on blur and is disabled without explanation while loading. It stays disabled for good if loading fails, and save errors go to a global report instead of under the field.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 2/2. The person rated it real
(`decisions/held-out-rest`, settings-15). Theme: states.

**The skill now.** `states.md` draws "Loading, and the error" for what waits on the network, and "Errors sit where they happened". It says nothing about a loading state that never ends when the read fails, a field that saves without showing it, or an empty state that doesn't say the list is empty.

**Proposed.** In `states.md`'s table: "A loading state with no way to end but success → the error in its place, with a retry"; "A field that saves on blur with nothing shown → saving and saved beside it, its error under it"; "An empty state that doesn't say it's empty → \"None yet\" and the action that fills it".

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 1/1, shipped@cursor:gemini-4-argon 1/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), held-out-themes 1/2 (+1 partly), held-out-plain 1/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): the row ships, but caught it only 1/2 (with one partly): it stays `testing` until a design round shows it.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+1 partly), shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 1/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
