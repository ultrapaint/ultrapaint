# ADR 0162: Badge draws the statuses

Status: accepted, 2026-11-27. Amends 0041 (how a project's look draws over the default one) and
0106 (what Problems lists).
Builds on 0155 (the roles the system components draw with) and 0161 (a look's own members).
Story: UP-252.

## Context

Badge's built-in `variant` had `default`, `secondary`, `outline` and `destructive`. A product's
status badges (overdue, paid, new) had no member to be. In the usage logs of 2026-11-10 to 25, an
agent on a client project overrode the fill of 7 badges by hand to get a warning colour. Those
overrides map to nothing in the product's `<Badge variant="warning">`, and the off-system check
flagged them every round. 0161 lets a project add its own member. The person chose in UP-228's
triage to grow the built-in set as well, so a project gets the statuses without adding them.

## Decision

**Badge has seven members:** `default`, `secondary`, `outline`, `destructive`, `warning`,
`success` and `info`. `destructive` keeps its name, as "danger" would be a second name for it.
Each status is filled with its role and set in its foreground, borderless as `destructive` is:
`$color-warning` and `$color-warning-foreground`, and the same for success and info.

**The status roles are roles** (system-components' `STATUS_COLORS`, part of the neutral palette
and of `SYSTEM_ROLES`). Each has a default fill and text that read at 4.5:1 or more in both
themes, and what it is for on the Color board. `/init` maps them as it maps every role (0155). A
look made with the dials (Define) writes them, in light and dark. The detailed preset has them as
`background-color-warning-bold`, `background-color-success-bold` and
`background-color-information-bold`, with `text-color-warning-inverse` or `text-color-inverse` on
them (`DETAILED_ROLES`). Setting a design system up from the code proposes the statuses the
product shows among the semantic layer.

**A look written before a member came still draws it as the default look does.** A project's look
draws unlayered over the default one (0041). A look that styles its base therefore drew a member
it never styled in its base's colours, and `/init` sets Badge's look in most projects (0155). The
members the built-in set gained later are listed per component (`LATER_MEMBERS` in
`defaults.ts`; Badge's statuses), and `lookOf` gives a look the default's style for each one it
does not style. A member it styles is its own. Every other member is drawn as it was: one the look
leaves unstyled still draws as its base.

**Problems names a status role a placed member needs that the design system lacks.** The member
draws in Ultrapaint's default for the role meanwhile. The editor counts the instances where it
counts a removed member's (0161), and lists one problem per member under design-system.json:
"`warning` Badges use Ultrapaint's colours", naming the roles and where the instances are. Its fix
is Fix with agent, whose chat has the agent add each role as a colour of the product, saying what
it is for (0054). A project with no design system is drawn in the default look, which has every
role, and gets none. Only the status roles are named, so a design system that `/init` left without
another role (0155) gets no new problem.

The design skill is unchanged. Its Colour rule keeps the neutral Badge with a dot as the default
for a status, and a product's DESIGN.md may choose the coloured members.

## Consequences

- An agent places `<Badge variant="warning">` with no override, and the code writes it as the
  product's member. `get_component`, `list_components`, the inspector's Variant field and the
  Library's board offer the seven, through the catalogue (0161). The tools' text is unchanged.
- Every existing Badge draws as it did: a member it was in is styled as before.
- A look file that adds `warning`, `success` or `info` through `members.add` is refused as adding
  a member the axis has already (0161). UP-228 shipped hours before this, in no release, so no
  released project has one.
- A starter application's `ui/badge` has the seven members in its `cva`, over the default look's
  tokens.
- Status members for Button or other components wait for evidence. A later member of theirs is
  listed beside Badge's.
