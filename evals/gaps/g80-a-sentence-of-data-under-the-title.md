---
id: g80
title: A sentence of data under an object's title
kind: missing
status: testing
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
