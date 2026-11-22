---
id: g91
title: A long form drawn as one page of every field
kind: missing
status: testing
found: 2026-11-21
source: the person, on fx-opus-new20 (decisions/new20)
skill: [references/kinds/form.md]
sections: []
---

**What happened.** The clinic's new-patient form has eight sections and about forty fields, most
optional. Both runs drew all of them on one long page. The person: "the form seems so long, and
even if it seems an admin dashboard we should probably redesign it".

**The skill now.** `references/kinds/form.md` covers short forms and onboarding steps; nothing says
how a long form is cut.

**Proposed.** To try, one at a time: (a) the form in steps, one or two sections each, a vertical
stepper beside it, as onboarding is; (b) the required fields first, the optional sections closed
under their headings ("Accessibility needs · optional · Add"); (c) both. Which is a person's call
on the pictures, not a measure.

**Test.** `fresh-patient-intake`, 2 runs per version, Opus designing; the person picks on a deck.

**Result.**
- `fx-opus-g91steps`, `fx-opus-g91collapsed`, `fx-opus-g91both`: 2026-11-21, each on top of
  `candidates/new20`, `fresh-patient-intake`, 2 runs each, Opus in Claude Code designing. All four
  runs told to use steps drew one page and said why: "Receptionists tab straight through and need
  to see everything that's missing, so I didn't split the form into steps." The collapsed version
  closed only Accessibility needs (run 2).
- Decision of 2026-11-22 (`decisions/new20-ship`): steps anyway, against the agent's call of one
  page with the optional sections closed. The rule is made firm and run again.
