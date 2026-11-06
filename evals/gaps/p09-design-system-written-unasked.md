---
id: p09
title: A design system written unasked in an opened app
kind: process
status: done
found: 2026-11-05
source: ADR 0062, the onboarding flows (Onboarding canvas, 3c and 3d)
skill: [SKILL.md, references/character.md]
sections: []
---

**What happened.** The person decided (ADR 0062, amending 0050) that a project has no design
system until they make one. An app opened in Ultrapaint has a look in its code even when its theme
names little of it; an agent that writes a design system before its first screen there replaces
that look with one it invented, and the person meets a system they never asked for. Pages in such
a project are drawn in Ultrapaint's default look, and the agent says so once. A new project, from
the start screen, still gets one: the agent or the person picks its look there.

**The skill now.** `SKILL.md`, "Making the design system": "A project with no design system yet (a
theme that declares nothing) gets one before the first node: the character settled, then
`references/design-system/foundations.md` in that character, a loaded face and real scales,
written down with it in DESIGN.md." The server's briefing now says the opposite for a project with
no system (`DEFAULT_LOOK_NOTE` in `apps/server/src/services/threads/briefing.ts`), so the two
disagree in an opened app.

**Proposed.** The rule keeps a new project's system and drops the opened app's: "A new project (a
theme that declares nothing, no screens in its code) gets a design system before the first node
… An opened app without one is drawn in the default look the editor gives, and the reply says so
once; its own system is made only when the person asks (from the code, a new look or Figma)."
Character is still settled before the first node in both.

**Test.** Two rounds on a host app with screens and a sparse theme, one asking for a screen and
one for a new project from a prompt: the first writes no `design-system.json` and says the
default look is used, the second writes one before its first node.

**Result.**
- Decision of 2026-11-06 (`decisions/skill-gaps-nov6`): accepted into the skill without a round, as the person chose: `SKILL.md` gives a new project a design system before its first node and draws an app with screens and none in its look, the system made when the user asks.
