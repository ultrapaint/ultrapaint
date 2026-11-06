---
id: g51
title: Colours named one way, whatever the system's preset
kind: missing
status: open
found: 2026-11-06
source: ADR 0062, the token preset chosen on the look page
skill: [references/color.md, references/design-system/foundations.md]
sections: []
---

**What happened.** The person decided (ADR 0062) that a design system has one token preset:
simple roles, shadcn's names (`primary`, `muted-foreground`, `border`), or detailed tokens by
property and meaning, Atlassian's way (`text.subtle`, `background.success.subtle`, `border.focus`),
written in Tailwind v4's per-property namespaces (`--text-color-subtle`, so classes read
`text-subtle`). The look page writes either. The skill only knows the roles: it tells an agent
making a system to write semantic roles, and an agent drawing to use "the semantic token for that
role", so in a detailed system it reaches for names that are not there or puts a background
token on text.

**The skill now.** `references/color.md`, "Before you finish": "A hex or `rgb()` value in `fill`,
`color` or `border` | The semantic token for that role". `references/design-system/foundations.md`
writes colours as one semantic group of roles.

**Proposed.** `color.md` names both presets and says to read the system's (`tokenPreset`): with
the detailed one, text takes a `text-color-*`, a fill a `background-color-*` and an edge a
`border-color-*` of the meaning that fits, never one property's token on another. The
foundations reference makes a system's colours in the preset the person chose, grouped Text,
Background and Border for the detailed one, with the subtle and bold steps of each meaning.

**Test.** Rounds on a host whose system is detailed: count colour values that use a token of
another property or a role name the system does not have, before and after.

**Result.**
