---
id: g69
title: A one-screen page built as a landing page
kind: missing
status: testing
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

- `pp-in`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). alignui-waitlist: shipped 3/3 for each of the mark in a corner, the notes split to the corners and "Powered by" louder than what it trails. Candidate: 3/3 "laid out like a sign-in page: mark and notes in corners" and 3/3 "Powered by" louder. The cause is 3/3 "Waitlist page routed to the form kind": every run opened `form.md`, never `landing.md`'s One-screen page, so the recipe was never read. Pairwise: shipped 1, ties 2. No held-out one-screen page. Next: the candidate's kind table sends a waitlist or coming-soon page to `landing.md`.
