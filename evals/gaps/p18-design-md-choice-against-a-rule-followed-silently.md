---
id: p18
title: A DESIGN.md choice that breaks a rule followed without saying so
kind: process
status: open
found: 2026-11-24
source: the person's corrections on a client app (option rows' borders, cards' radius and padding), usage logs of 2026-11-10 → 25
skill: [SKILL.md]
sections: []
---

**What happened.** A client project's DESIGN.md, written before g75 shipped, gave every control a
user operates the bold border, and its cards a radius of `2xl` with `24px` padding inside a panel of
`3xl`. Screen agents followed both: "I used it because DESIGN.md says so". The person corrected the
option rows' border and the cards' radius and padding, and asked "Maybe this is also a gap of the
ultrapaint skill?". The agent: "The skill tells me DESIGN.md wins on what it chooses", and the line
"looked like a choice, so I followed it". Nobody had been told the choice went against a rule.

**The skill now.** Designing a screen, step 1: DESIGN.md's Overview and tokens settle the character:
"Take it and ask nothing." Making the design system, step 2: "What the product already decides is
taken as it is, even where a rule here would choose otherwise; say where it breaks one." The screen
job has no "say where it breaks one".

**Proposed.** Candidate for Designing a screen, step 1: "Where DESIGN.md decides against a rule
here (a border held to `3:1` on every control, a corner larger than its container's less the
padding), draw it as DESIGN.md says, and tell the user once which rule it breaks and what the rule
would draw."

**Test.** A host whose DESIGN.md states two choices against the rules (a bold border on every
control, a card radius over its panel's); briefs that use both, 2 runs each at Opus: whether the
last message names each conflict, and whether the design still follows DESIGN.md, shipped against
the candidate.

**Result.**
