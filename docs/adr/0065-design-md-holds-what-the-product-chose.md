# ADR 0065: DESIGN.md holds what the product chose, the design skill what holds for any product

Status: accepted, 2026-11-06. Bounds 0027 (DESIGN.md in the open format) and 0049 (the design
skill has two jobs).

## Context

The design skill says how to design well whatever the product; DESIGN.md is a product's design
system in prose, and an agent is told its conventions come first where the two disagree. This
repository's DESIGN.md had taken in rules the skill already states for every product: an empty
panel's one action, a primary that stays pressable, a tooltip on an icon button, one meaning for a
row's click, the neutral Badge. They came from a redesign's brief (gap p01) and from corrections
written there because the skill changes only on the lab's evidence (2026-11-04, gaps g01–g04). Copied,
each lost its condition, and the copy outranked the rule it came from: two of three reviewers of
the onboarding screens asked to drop the empty canvas's second way to fill it on the flat "one
action" alone, where the skill says "one action that fills it" and lets the likely one lead.

## Decision

- **DESIGN.md holds what the product chose**: its values, which variant or component it uses for
  what, which of two allowed ways it takes, and why; its character, voice and dials. A rule that
  holds for any product is the skill's, kept there with its condition.
- **The precedence is for choices.** The design system's tokens and conventions come first for
  what they choose; where DESIGN.md only restates a rule of the skill, the rule holds as the skill
  gives it, its condition with it (the briefing's lead says so).
- **A correction that holds for any product is a gap**, measured in the lab before the skill
  changes; it never goes into DESIGN.md as a shortcut (AGENTS.md).
- Every agent that writes a DESIGN.md is told the boundary (the server's `DESIGN_MD_GUIDE`); the
  skill's own `references/design-system.md` is to say it too, which starts as gap p10.

## Consequences

- This repository's DESIGN.md was pruned to the product's choices: the empty state's anatomy and
  place stay, its count of actions goes; Undo in a toast stays, the pressable primary goes.
- A rule the person wants for every product, and that the lab has not measured yet, has no home
  but its gap until it is measured; that is the price of keeping the two apart.
