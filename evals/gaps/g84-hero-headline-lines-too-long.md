---
id: g84
title: A hero headline set in lines too long for its size
kind: missing
status: testing
found: 2026-11-20
source: the person, on held-videoask run 1 of fx-opus-dw2 (decisions/lab-nov20c)
skill: [references/pages/landing.md]
sections: []
---

**What happened.** On VideoAsk, run 1 set "Meet people face to face / with interactive video" in
two lines of 24 characters, 634px wide at 58px, where the brand sets three lines of about 16
characters, 450px wide at 60px. The person: "the max chars per row on the headline, because the run 1 is
slightly too long compared to the brand".

**The skill now.** `references/pages/landing.md`, Hero: "the headline, one line under about 30
characters, else 2–4 lines, broken right before a set-apart phrase by a forced break, never by
`text-wrap: balance` or a width cap". Nothing says how long a line of a hero headline runs.

**Proposed.** The same sentence with the line's length: "else 2–4 lines of about `12–20`
characters each". Measured first, read in Chrome at 1440px: of 13 well-made landing pages with a hero headline
(17 tried, one a placeholder, three timed out), 10 keep it to 10–19 characters a line; the others
are a one-line headline of 22 and two long ones (46, and one read as a single run of 79). Our last
21 runs that rendered (`fx-opus-hf`, `fx-opus-dw`, `fx-opus-dw2`) run over 20 in 11, up to 30,
mostly two-line technical heroes at `64px`.

**Test.** `candidates/headline-measure` (the skill on main with the line, and a Check row) on the
six landing briefs of `fx-opus-hf`, 2 runs each, Opus designing, against `fx-opus-hf`: the longest
line of each hero set in 2 or more lines, in characters, read in Chrome at 1440px; a one-line
headline passes under about 30 characters, as the line allows, and fails over it. It passes when the runs over 20
characters fall from 8 of 11 (language-app run 1 did not render) to 2 or fewer, with no headline broken into more than 4 lines.

**Result.**
- `fx-opus-hm`: 2026-11-20, the six landing briefs of `fx-opus-hf`, 2 runs each, Opus in Claude
  Code designing with `candidates/headline-measure`, read in Chrome at 1440px: heroes with a line
  over 20 characters 2 of 12 (analytics-pricing run 1, 24; invoicing-api run 1, 23), against 8 of
  11 in `fx-opus-hf`; none over 4 lines, no one-line headline. It passes the test. Longest lines,
  candidate: 13–18 in the ten others, five of them in 3 lines. The pairs are asked in
  `decisions/lab-nov20d`.

