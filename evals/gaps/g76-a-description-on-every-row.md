---
id: g76
title: A description on every row
kind: missed
status: open
found: 2026-11-17
source: the Settings dialog as redesigned on 13 Nov (ADR 0090–0094), corrected by the person
skill: [SKILL.md, references/review.md, references/kinds/settings.md, references/words/interface.md]
sections: []
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

The outside sources agree with the person (research of 2026-11-17, in the thread that found this;
GitHub Discussions are off, so it has no note yet):

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
→ Lines only on the rows that need them; sections bare."

**Test.** Recall on the Settings dialog as redesigned, its Appearance and Agents pages captured
before any fix as a new section (none is captured yet; the `settings` section is the dialog at
f608871): the shipped skill, with PR #21's two-pass review, against the candidate, 2 runs; the
lines flagged that the table above marks as restating or obvious, and no fewer of the section's
other findings. Then a fresh-brief round on settings briefs, counted in code from the page file:
the share of rows with a line and the notes opening a section, shipped against the candidate.

**Result.**
