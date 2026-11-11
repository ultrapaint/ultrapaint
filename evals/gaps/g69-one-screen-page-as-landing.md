---
id: g69
title: A one-screen page built as a landing page
kind: missing
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md]
sections: []
---

**What happened.** `alignui-waitlist` scored 3.0, the skill's lowest page. Both runs built the waitlist as a landing page: the mark pinned top-left in a header bar, the credits split to the two bottom corners 1,200px apart, "Powered by" in colour and medium weight. The reference centres the mark over the column and stacks its notes under it. The person: "Yes, a short recipe in landing.md". Pictures: `gaps/g69/`.

**The skill now.** `references/pages/landing.md` has sections, a header and a footer for a page of several bands; nothing for a page of one column.

**Proposed.** A short part of `landing.md`, **One-screen page** (a waitlist, coming soon, a single form): the mark centred over the column, no header bar unless a control needs one (then that control alone in a corner); the column holds the headline, the form and one line; the notes and credits are one centred muted block under it or at the foot; a "Powered by" line is the quietest on the page, its mark in the same grey.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: none of the six is a one-screen page; a waitlist reference is still to find.

**Result.**
