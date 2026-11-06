---
id: g32
title: Labels of one list in different forms
kind: missing
status: testing
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-14, rated real)
skill: [references/content/interface.md]
sections: [settings]
---

**What happened.** "Theme" and "Display name" are nouns, but "Send messages with" is a sentence fragment, so the list's labels don't share one form.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, settings-14). Theme: forms.

**The skill now.** `content.md`'s table: "Two names for one thing → the one the product already uses". Nothing says items of one list share a form (g13's proposal, dropped when the skill caught it 2/2 on the new chat), or that one fact is written one way in every list.

**Proposed.** In `content.md`'s table: "Labels of one list in different forms (nouns and a sentence fragment) → one form"; "One fact formatted two ways in two lists (a day here, a time there) → one format". Related: g13.

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 0/1, shipped@cursor:gemini-4-argon 0/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 0/2, held-out-themes 1/2, held-out-plain 0/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): the row ships, but caught it only 1/2 (with one partly): it stays `testing` until a design round shows it.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 1/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
