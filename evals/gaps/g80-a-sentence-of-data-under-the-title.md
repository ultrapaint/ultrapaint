---
id: g80
title: A sentence of data under an object's title
kind: missing
status: done
found: 2026-11-18
source: the person, on the fresh-place screens of placement-3 (a paid invoice, a delivered order), decisions/placement3-nov18
skill: [SKILL.md, references/review.md]
sections: []
---

**What happened.** On an object's page, Opus put a line of data under the title. On the paid
invoice it read "£835.20 from Calder & Finch Joinery · paid 16 Nov by bank transfer, a day before
it was due". On the delivered order it read "Placed 16 Nov, 21:40 · Saoirse Mbeki". The amount,
the client, the payment and the customer's name were all shown again elsewhere on the page. The
person: "I don't like a full description with data … That's too much. We should not have important
informations there and also we should not have repeated data. Usually for important data they will
search in the sidebar." On the order: the line "should contain only some metadata but less as
possible and not repeated stuff. It really depends on the page." Pictures in `gaps/g80/`.

**The skill now.** It forbids repeats in general and a subtitle on a screen whose purpose is plain,
and never says what the line under an object's title may hold:

- `SKILL.md`, Restraint: "A value appears once, where it is read or set"; "No description that
  restates its heading, no intro or subtitle on a screen whose purpose is plain".
- `references/review.md`: "W10 A value the window already shows elsewhere … | Once, where it is
  read or set".

Reviewing the two screens with the shipped skill (Opus, 18 Nov): on the order it removes the
customer's name from the line (W10) but proposes moving the order's source into it; on the
invoice it does not mention the line at all, among 13 findings.

**Proposed.** Under an object's title, at most one quiet line of one or two facts that tell it from
its siblings (the client, the day it was placed), none of them shown elsewhere on the page; its
state is the badge beside the title. Amounts, payments and who did what are read where the page
shows them, never again in that line. With nothing to add, no line. A review row for it.

**Test.** The four `fresh-place-*` briefs (g78), 2 runs, Opus designing: the line under each
screen's title quoted, its facts counted, and those shown elsewhere on the screen counted, against
the shipped skill.

**Result.**

- Decision of 2026-11-18 (the person, `decisions/placement3-nov18`): the line is tried in
  `candidates/show-less-1`, the shipped skill with the header cap and finished-state primary of
  placement-3, this line, and rare facts under one Details disclosure (g78), with review rows
  W21–W23.
- `pf-opus-sl1`: 2026-11-18, `candidates/show-less-1` (the shipped skill with the header cap, the finished-state primary, the line under an object's title and rare facts under one Details disclosure; review rows W21–W23) on the four `fresh-place-*` briefs, 2 runs, Opus in Claude Code designing; `pf-opus`, `pf-opus-p3` and `pf-opus-sl1` scored again by Opus with the line under the title (48 screens, $19.67). Rare items in view at rest: shipped 43 of 132, placement-3 38, show-less-1 22; of them rare facts 19 of 22, 22, 7, and rare actions 24 of 110, 16, 15. Facts in the line under the title: 40, 50, 13; of those shown again on the page: 21, 38, 2 (show-less-1 drew no line on the invoice and order screens, one or two facts on the deploy and job ones). Needed but not in view: 0, 2, 0 of 72. Pointless shown: 6, 5, 11 of 74 (mostly actions in the ⋯ menu a state makes pointless, Void on a paid invoice; within the spread of about four the scorer showed on rescoring). Header over three actions: 0, 1, 1 of 16. Primary right: 15, 16, 16 of 16. Blind pairwise, both orders, Opus judging, each run alone: shipped against show-less-1 3–0–1 in run 1 and 3–1 in run 2 (pooled 6–1–1; the deploy, invoice and job briefs lean shipped in both runs, the order leans neither; hierarchy 6–0, use 5–1, restraint 1–4); placement-3 against show-less-1 0–3–1 and 0–4 (pooled 0–7–1). The judge's reasons count showing less against it: "hides the rest under a collapsed Details panel", "carries more of the brief". A failed deploy drawn with Build and Upload passing after the typecheck failed appears in all four deploy runs of the two versions made on 18 Nov (placement-3, show-less-1) and in none of the four made on 17 Nov (shipped, placement-2), whose source marks them "Not run"; the brief lists every step's time and the cause is not known. Tells: none. Read: show-less-1 halves what is shown at rest, nearly clears the line under the title of repeats, and hides nothing needed; the judge prefers the fuller shipped screens, so the person decides, in `decisions/compare-sl1-nov18` (all eight screens, both runs; my count: show-less-1 better on 4, shipped on 1, even on 3).
- `compare-sl1-nov18`, decided (the person, 2026-11-18): show-less-1 is better than the shipped skill on all eight screens (on the order and the failed deploy, one run of it "kinda weak ui-wise. but still better than the shipped"), against the blind judge's 6–1–1 for the shipped skill; ship it. Shipped as written in `candidates/show-less-1`: in `SKILL.md`, at most three actions in an object's header at rest, a finished state's primary its most used action, at most one quiet line of one or two unrepeated facts under an object's title, and facts needed only sometimes under one Details disclosure; review rows W21–W23. The failed deploy drawn with later steps passing is watched in the next rounds.
