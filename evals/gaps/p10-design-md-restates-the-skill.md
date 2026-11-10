---
id: p10
title: DESIGN.md restates the skill's rules, without their conditions
kind: process
status: done
found: 2026-11-06
source: this repository's DESIGN.md (commits 3104112, eb7dde4); the onboarding review (c2d3380)
skill: [SKILL.md]
sections: []
---

**What happened.** This repository's DESIGN.md took in rules the skill already states for every
product: "an empty panel takes … one action", "a primary stays pressable", "icon buttons carry a
tooltip", "a row's click does one thing", the neutral Badge. Some came from a redesign brief (p01),
some from gap fixes written there because the skill changes only on evidence (eb7dde4: g01–g04).
Copied, each lost its condition: the skill's "one action that fills it" became "one action",
flat. DESIGN.md outranks the skill (an agent is told the design system's conventions come first),
so the copy won: two of three reviewers of the onboarding screens asked to drop the empty canvas's
second way to fill it on that line alone. The person asked why those rules were in DESIGN.md at
all.

**The skill now.** `references/design-system.md`, step 5: "Write down what is not a value in
DESIGN.md: the character in its Overview, the voice, what each colour is for and what it is never
for, the reason for each choice the user did not make." Nothing says what does not go there.

**Proposed.** Step 5 ends: "Only what this product chose: its values, which variant, which of two
allowed ways, and why. A rule that holds for any product stays in this skill; copied into
DESIGN.md it loses its condition and outranks the skill." The "Before you finish" table gains: "A
line of DESIGN.md that would hold for any product | Cut it; the skill says it, with its
condition."

**Test.** Rounds that make a design system from a product's code (Define, `/init`): count the
lines of the DESIGN.md written that restate a rule of the skill, before and after.

**Result.**
- 2026-11-06: the server's DESIGN.md guide (`DESIGN_MD_GUIDE`), the briefing's precedence and
  AGENTS.md now say it (ADR 0065), and this repository's DESIGN.md was pruned to the product's
  own choices. The skill's own text waits on the lab.
- Decision of 2026-11-06 (`decisions/skill-gaps-nov6`): accepted into the skill without a round, as the person chose: `references/design-system.md` step 5 says what DESIGN.md holds, and its table cuts a line that holds for any product.
