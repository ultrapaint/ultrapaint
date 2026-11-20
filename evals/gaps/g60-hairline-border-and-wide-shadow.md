---
id: g60
title: A card with a hairline border and a wide soft shadow
kind: missed
status: testing
found: 2026-11-10
source: Impeccable's detector (gpt-thin-border-wide-shadow), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/surfaces.md]
sections: []
---

**What happened.** A card drawn with a 1px border and, under it, a wide, faint shadow of its own: two edges for one surface. Not searched for in our runs.

**The skill now.** `SKILL.md`, Surfaces: "a shadow belongs to a level, never a custom one"; Spacing: "a line or a surface, never both". `references/surfaces.md` has the row "A custom `box-shadow` string → The level's shadow, or ask the user for a new level".

**Proposed.** No new rule: a case for the checker. A check: a 1px border on a box whose shadow has a blur of 24px or more at low alpha and matches no level of the system.

**Test.** The check run on the outside rounds' pages and on the references, which are the false-alarm set.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: border with a wide shadow 1.3 · 4/6, 0.7 · 2/6, 0.7 · 2/6. No rule was proposed; the candidate left it as the shipped skill does. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
- `gaps-nov18`, decided (the person, 2026-11-19, `decisions/gaps-nov18`): kept open, measured by the same count: 4 of 40 fresh pages; no rule has been tried.
- `g60-check`: 2026-11-20, the check built (`border-shadow` in `@ultrapaint/design-checks`, `measure --checks`: a 1px border or ring and a shadow of its own blurred 24px or more under 0.5 alpha; overlays left out), measured with no agent run. Hits, on fx-opus-main: 4 of the counter's 4 pages (fresh-backup-landing runs 1 and 2, fresh-invoicing-api runs 1 and 2), on the elements it named, and no other page of the 40; at 0.3 alpha, the limit first tried, 3 of 4 (invoicing-api run-2's shadows are 0.35 and 0.45 with a −24px spread), so the 0.5 is set in-sample. False alarms: 3 of the 9 references with a page to render (held-helply, held-workos-atlas, linear-home), and 7 of 20 well-made pages with eleven corpus landings added (attio, stripe, raycast, clerk too). Every box flagged on them is a product mockup or screenshot framed the way the Opus pages framed theirs, so geometry alone does not tell the mark from good practice (runs/g60-check/summary.md)
