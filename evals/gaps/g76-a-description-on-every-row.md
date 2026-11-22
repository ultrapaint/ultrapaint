---
id: g76
title: A description on every row
kind: missed
status: done
found: 2026-11-17
source: the Settings dialog as redesigned on 13 Nov (ADR 0090–0094), corrected by the person
skill: [SKILL.md, references/review.md, references/kinds/settings.md, references/words/interface.md]
sections: [settings-redesign]
---

**What happened.** The person asked Ultrapaint to redesign its own Settings dialog. Seen as a
whole, the dialog reads as mostly text: 26 of its 28 rows carry a muted line under the label, and
6 sections open with a note ("Run one of these once. An agent in a terminal or another app then
designs in the project of the folder it works in."). The person: a setting that is already
explicit needs no description; a user knows what a theme is. A complex setting (connecting a
provider) may need a line; a description on each section is useless.

Appearance, each line tested by covering its label (does it add a consequence, a scope, a
constraint or a reason?):

| Row | Its line | Test |
| --- | --- | --- |
| Accent | "What you act on: the main button, a switch on, the focus ring." | Explains the obvious |
| Comments | "Pins on the designs they're left on." | Restates |
| Increase contrast | "Darker muted text and firmer edges." | Restates |
| Motion | "System follows your computer's Reduce motion setting." | The options say it |
| Theme | "The editor's light and dark. Designs keep their own themes." | First half restates; second a scope |
| Text size | "The panels' text. The canvas keeps its own zoom." | Borderline: a scope |
| Grid | "Shows 8px cells; what you place snaps to them." | Borderline: a consequence |
| Scroll wheel | "Pinch and ⌘/Ctrl+wheel always zoom." | Keeps: a constraint |

**The skill now.** It has the rule, worded as repetition:

- `SKILL.md`, Restraint: "A label, description, caption, heading, tooltip, badge or icon that says
  what the content already shows is noise"; "No description that restates its heading".
- `references/review.md`: "W1 A heading, caption or description that repeats what is beside it";
  "W4 A sentence explaining how to use a control whose label already says it".
- `references/kinds/settings.md`: "A helper line carries a rule or live data … a row whose label
  says it all has none."

Each line above adds a small fact, so none repeats its label and each passes W1 on its own. The
review runs row by row against each element; nothing reads the screen whole for how much of it is
text, and nothing stops a line written because its neighbours have one. The lab's measure of
added text compares a design with its brief, so on a screen whose words are all the agent's it
cannot tell a needed line from noise.

The outside sources agree with the person (the note
`research/2026-11-17-settings-copy-density.md` in the data directory):

- Microsoft: "Adding a supplemental explanation to one control in a group doesn't mean that you
  have to provide explanations for all the other controls … Don't have supplemental explanations
  that merely restate the label for consistency"; text problems often reveal design problems
  (learn.microsoft.com/en-us/windows/win32/uxguide/text-ui).
- Android: "If the label is sufficient on its own, don't add secondary text … show the setting
  status instead of describing the setting"
  (developer.android.com/design/ui/mobile/guides/patterns/settings).
- Apple: "If the setting label isn't enough, add an explanation. Describe what it does when turned
  on" (developer.apple.com/design/human-interface-guidelines/writing).
- Visual Studio: "Don't explain the obvious"; supplemental text where the user may not "fully
  understand the ramifications of the choice".
- Shopify Polaris: a section's description only "if the explanation or purpose of the associated
  cards isn't clear", and never repeating its title.
- DWP: a hint only "after you have first tried improving the question".
- Against: web dashboards (Vercel, Notion, Linear) give most rows a sentence; Baymard found
  checkout fields without descriptions confused testers (ambiguous fields, not settings).

**Proposed.** The test is whether the user would miss the line, not whether it repeats:

- A row's line stays only when it says what the label can't: a consequence, a scope, a
  constraint, why the setting is unavailable, or the current value. Otherwise it goes, even when
  it is true.
- One row's line never obliges its neighbours to have one.
- A section's note only when its name and rows leave its purpose unclear.
- The label is rewritten before a line is added under it.

In `references/review.md`, a row: "A line under a label that a user who knows the label would
not miss, or one added because its neighbours have one → Remove it." In
`references/kinds/settings.md`'s Check: "Most rows with a line, or a section opening with a note
its name and rows already make plain → Lines only on the rows that need them; a note only where
the section's purpose is unclear."

**Test.** Recall on the Settings dialog as redesigned, its Appearance and Agents pages captured
before any fix as the section `settings-redesign` (at 8768df6, both themes, the Appearance page
scrolled to its end too; the `settings` section is the dialog at f608871), against
`candidates/row-lines`: the shipped skill, with PR #21's two-pass review, against the candidate, 2 runs; the
lines flagged that the table above marks as restating or obvious, and no fewer of the section's
other findings. Then a fresh-brief round on settings briefs, counted in code from the page file:
the share of rows with a line and the notes opening a section, shipped against the candidate.

**Result.**

- `g76-rl`: 2026-11-17, caught: shipped 1/2 (+1 partly), row-lines 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/g76-rl/report.md)
- `g76-rl`, by the table above: of the five lines it marks as restating or explaining the obvious (Accent, Comments, Increase contrast, Motion, Theme's first half), the shipped skill's reviews named 2 and 1, `row-lines`' 3 and 4 (Theme, Comments, Increase contrast, and Motion in one). No review of either named Accent; one `row-lines` review kept it as a scope. Every review kept Scroll wheel's constraint, and each trimmed Theme's and Text size's lines to their scope rather than dropping them, as the table's borderline rows have it. `row-lines`' reviews counted the rows ("all eight rows have a muted line") and cited W21 and `settings.md`. Both versions flagged the Agents page's note and the clause repeated on each agent row. The section's other findings: 17 a review for each version over the two runs on this section, and across both sections 11.0 unmatched a review against 12.3; the other gaps on `settings` 13 of 18 caught against 10 of 18, `row-lines` taking g26, g32 and g48 and losing one run of g31.
- Next: the fresh-brief count of **Test.** (the share of rows with a line and the notes opening a section, shipped against `row-lines`), with Opus designing settings screens, once the queued rounds leave Claude room.
- `gaps-nov18`, decided (the person, 2026-11-19): measure it next. `candidates/row-lines-2` is the skill on main (with #56) plus row-lines' rule, its settings lines and its review row, renumbered W24; Opus designs `fresh-workspace-settings` and two new fresh settings briefs, `fresh-notification-settings` and `fresh-personal-preferences`, 2 runs each, against the skill on main (`fx-opus-sl`).
- `fx-opus-rl2`, `fx-opus-sl`: 2026-11-19, three fresh settings briefs (`fresh-workspace-settings`, and the new `fresh-notification-settings` and `fresh-personal-preferences`), 2 runs each, Opus in Claude Code designing, `candidates/row-lines-2` against the skill on main; counted by eye on full-page renders (`gaps/g76/fresh/`), a row being a setting with its control. Rows with a line under or beside the label: shipped 56 of 101, row-lines-2 51 of 101 (workspace 21 and 24 of 34, notifications 15 and 12 of 35, preferences 20 and 15 of 32). Lines a user who knows the label would not miss (smart quotes or spell check explained, "The bell in the top bar", the weekend or a shortcut set's options restated, a date or time format's example): shipped 11, row-lines-2 9. Sections opening with a note: 3 (one not needed, a scope the name gives) and 2 (both needed: existing projects keep their settings). Needed lines lost: none of the brief's rules, consequences or values; row-lines-2 drew Theme's resolved value ("now light") in neither preference run, shipped in both, and one shipped run alone gave the waiting-hours range. Read: on fresh briefs the shipped skill no longer puts a line on every row, so designing is close to even; the candidate's gain is in review (the recall above, and g32, g26), measured with `row-lines` against the skill before #56, not yet with `row-lines-2` against the skill on main. Whether to ship is asked in `decisions/rows-nov19`, with the screens.
- `rows-nov19`, decided (the person, 2026-11-19): row-lines-2 is better on the preference and notification screens; ship it. Shipped as written in `candidates/row-lines-2`: in `SKILL.md`, Restraint, a line under a label only when the user would miss it, no line because the neighbours have one, a section's note only where its purpose is unclear, the label rewritten first; the same in `references/kinds/settings.md` with a Check row; review row W24. On the screens the person also corrected the width of the settings column (g82) and a row's text held to a narrow column beside its action (g83).
- `up88-told`: 2026-11-22, caught: main+told 3/3, up88-2+told 1/3 (+2 partly) (opus, effort high; runs/up88-told/report.md)
- `up88-names`: 2026-11-22, caught: main 3/3, up88-1 3/3, up88-2 3/3 (opus, effort high; runs/up88-names/report.md)
