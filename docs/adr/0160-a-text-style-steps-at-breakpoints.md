# ADR 0160: A text style steps its size and line height at the design system's breakpoints

Status: accepted, 2026-11-27. Amends 0036 (a node's fields per breakpoint: a text style's size
and line height follow the same rule) and 0027 (DESIGN.md's typography: the front matter keeps a
style's own settings, the prose its steps). Story: UP-225.

## Context

A product's headings often step down on a phone: a heading style is 28px wide and 24px below
640px. A text style held one size and one line height, so the step had nowhere to go but onto
each heading. In one client project agents set `size` and `at.sm.size` over `textStyle` on almost
every heading, `/init` could write the phone sizes only into the styles' descriptions, and one
turn removed 72 hand-set sizes and line heights, each on a text that already had a style. The
overrides fed the off-system check every round and were flagged by review models in 14 sessions.

## Decision

**A text style has steps.** `TextStyle.at` holds, per breakpoint name, a size and a line height
(contracts' `TextStyleStep`), mobile-first as a node's `at`: the style's own settings are the
smallest screen's and `at.sm` holds from `sm` up until a larger breakpoint says otherwise. Only
the size and the line height step (`TEXT_STYLE_STEP_SETTINGS`), the two the logs needed; the step
can widen later without changing shape. `at` is optional, so the design system stays version 1
and a file without it reads as before.

**A text's type settings resolve in one order** at the breakpoint it is drawn or written at: the
style's own, the style's steps up to that breakpoint (`textStyleAt`), the text's own fields, then
the text's `at` up to it. The style context carries the breakpoints that hold (`StyleContext`'s
`holding`): the renderer passes its frame's, code generation each level's, and a style that steps
at a breakpoint makes the code write that breakpoint (`breakpointsUsed` given the text styles), so
the style's classes come with their prefixes (`text-2xl sm:text-3xl`).

**Detaching copies the steps, attaching clears the text's own.** Taken off its style, a text gets
the style's settings where the edit lands, as the style is there, then each step's size and line
height in its `at` (`detachedSteps`), except where it sets that setting itself, as its own or at
that breakpoint or a smaller one, and except the setting being edited as it detaches
(`detachTextStyleOps`). Set in a style, a text loses its own size and line height at every
breakpoint (`attachedSteps`), as it already lost the base settings the style stands for
(`attachTextStyleOps`). The steps are explicit updates at each breakpoint, worked out from the
text as it is stored, beside the update the inspector makes as before, in one undo step
(`updateSelectionWithOps`). Paste style keeps its own rule: it writes what it copied where the
edit lands, and leaves the other breakpoints as they are, for a text style as for any field.

**The Typography board shows the steps, the text style's inspector changes them.** The board's
settings line gives the style's own size and line height, then each step's (`24 / 1.25, sm 28 /
1.2`); the inspector's Breakpoints section has a row per step, its size and line height pickers and
its removal, and adds one at a free breakpoint as the style draws there, each one edit of the
design system (ADR 0102: a board shows, an inspector changes). A text's inspector shows what its
style gives at the frame's breakpoint, and names a setting the text sets itself there as its own
over the style.

**Agents are told the steps, and warned when they write over them.** `/init` and Define ask for a
style's steps where the code steps it, in the same tokens as its own; the design briefing lists
each style with its steps (`Heading xl (sm: 28, lg: $text-4xl)`) and says a text in it needs no
size of its own; `read_design_system` gives `at` as the file has it. `apply_operations` warns of a
styled text the call's operations gave a size or a line height of its own, at its base or at a
breakpoint, naming the style and the two ways out (`styleOverrides`); an override already on the
page that the call did not set, an unstyled text, and one the call took off its style are not
named. The tool's description is unchanged.

**DESIGN.md keeps the open format.** The front matter's `typography.<style>` is the style's own
settings, and Sync compares those alone; the Typography section's prose states the steps, which
the DESIGN.md guide asks for.

**Pages are not migrated.** Hand-set sizes over a style already on a page stay; `read_page`'s
`match` finds them when the person asks an agent to clear them (ADR 0074).

## Consequences

- A heading in a style is drawn at the style's phone size in a 390px view and at its wide size in
  a 1440px frame with no size of its own, and its code keeps one style instead of a size per
  element.
- Attaching or detaching a style in the editor sends an update per breakpoint the text or the
  style sets, in the same undo step.
- Weight, family and tracking still have one value per style; a product that steps them is a
  later decision.
