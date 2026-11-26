---
id: g99
title: A neutral fill chosen without the surface it sits on
kind: missing
status: open
found: 2026-11-24
source: the person's corrections on a client app (a questionnaire's buttons, a result card's badge), usage logs of 2026-11-10 → 25
skill: [SKILL.md, references/color.md, references/components.md]
sections: []
---

**What happened.** On a client app the secondary button's light grey fill sat on a page background
of nearly the same tone (about 1.1:1), so it read as text with no edge; text actions drawn as ghost
buttons had no edge either. A grey badge sat on a strongly tinted card. The person asked for both to
change: the secondary to a fill that shows on its page, the badge to one of the product's secondary
colours.

**The skill now.** `SKILL.md`: "A surface inside another sits one tone step apart, in both themes";
`references/components.md`: "the secondary (a light grey fill)". The tone step is said of surfaces,
not of a control's or a badge's fill against what is under it, and the secondary's fill is named
without the surface it is judged on.

**Proposed.** Candidate for `SKILL.md`, Colour: "A filled secondary control or a badge differs from
the surface it sits on by at least one tone step; judge it on that surface (a card, a tinted panel),
not on the page's background. Where the system's secondary fill matches the page, the secondary is
outlined there." With a Check row in `references/color.md`.

**Test.** Briefs whose page background is a light grey or a tinted card, 2 runs each at Opus: the
contrast of each secondary and badge fill against its own surface, computed from the tokens, shipped
against the candidate.

**Result.**
