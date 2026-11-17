---
id: g79
title: Actions placed by count, not by use
kind: missing
status: testing
found: 2026-11-17
source: the person, after the Code section in the Design tab (g77); its actions as shipped
skill: [SKILL.md, references/review.md, references/usability.md, references/components.md]
sections: [design-tab-code]
---

**What happened.** The Code section showed four actions at rest: Export, Implement, Mark ready and
Mark implemented…. Mark implemented is for a page built before the editor knew it, once per page
at most, yet it sat in view as a button beside Implement. The person, on designs made with the
skill: models put every action on screen and cannot tell which one the user came for; which
action is primary depends on the domain.

**The skill now.** It caps by count: "One primary action per screen …; past three secondary
actions, the rest in a 'More' menu"; and per row: "A row's main action is in view at rest; the
rest in its menu". It never says how to choose which actions are the three, what never goes in a
menu, how small a menu may be, or that the primary changes with the object's state.

**Sources** (research of 2026-11-17):

- One primary per page. Carbon: "Each page should have only one primary button"
  (carbondesignsystem.com/components/button/usage/); SAP Fiori: "Show only one primary action for
  the entire page (across both header and footer toolbars)"; Atlassian, Primer, Fluent 2 and
  Material 3 agree. Apple alone allows "one or two" prominent buttons per view.
- Page header: Polaris, "no more than one primary action and 3 secondary actions per page".
  Groups: Carbon, "Any more than three actions should be grouped meaningfully using menu buttons".
  Rows: SAP, "Offer only one action per row (the most important)". Table toolbars: Carbon, "up to
  five actions".
- Which actions are in view, Android's FIT test: Frequent, "at least 7 out of 10 times they visit
  the screen"; Important, "Do you want everyone to discover this action"; Typical, "a first-class
  action in similar apps"; "If either F, I, or T apply, then it's appropriate for the action bar.
  Otherwise, it belongs in the action overflow" (developer.android.com, actionbar pattern, 2016,
  archived). Win32: "the most frequently used commands are directly accessible"; overflow "only
  if there isn't sufficient room" (learn.microsoft.com/en-us/windows/win32/uxguide/cmd-toolbars).
- Menus. NN/g: "Don't: Hide essential, high-frequency actions behind an extra tap or click"; don't
  hide "one or two items that could easily be accommodated"
  (nngroup.com/articles/contextual-menus-guidelines/). Carbon: under three options, keep them
  inline. Apple: "A view's primary actions need to be easily discoverable" (pull-down buttons);
  "Always make context menu items available in the main interface, too" (context menus).
  Most-used first, destructive last (Fluent, Apple).
- The primary follows the object's state. SAP Fiori: in display mode "Edit or Delete"; in edit mode
  "Save"; "When the user changes to edit mode, the main page no longer shows the Edit button"
  (object page, draft handling). OOUX (Prater): an action's display "might be conditional on
  permissions, user types, or states of your object"
  (alistapart.com/article/ooux-a-foundation-for-interaction-design/).
- Split button for variants of one command "when one of the commands is used most of the time"
  (Win32; NN/g split buttons); a select chooses a value, a menu runs commands (Fluent, Carbon).

**Proposed.**

- An action is in view when it is frequent (most visits), the screen's job, or one everyone must
  find; the rest go in the surface's "More" menu, most used first, destructive last. Then the
  count limits: one primary per page (header and footer together); a header up to three secondary;
  a row one action and its menu; a toolbar group two or three. Frequency comes before the counts:
  a row whose two actions are both taken on most visits shows both.
- A menu holds three items or more. One or two rare actions join the object's own menu where it
  has one; with none, they stay inline, quiet, after the frequent ones. The primary, and a
  frequent action, are never only in a menu.
- The primary follows the object's state and the domain's verb: a draft's next step (Mark ready),
  a ready page's (Implement), a changed one's (Implement what changed); an action the state makes
  pointless is not shown, and a state with no next step has no primary.
- Review row: "An action used once in an object's life shown at rest beside its frequent ones |
  The object's More menu; with no menu and one or two such actions, inline and quiet after the
  frequent ones".

**Test.** Fresh briefs of objects with a lifecycle (an invoice: draft, sent, paid; a pull request;
an order): the primary named per state where the state has a next step, none where it has none (a paid invoice read), rare actions in a menu (one or two with no menu: inline and quiet after the frequent ones), nothing frequent hidden. Recall on
the g77 section for Mark implemented….

**Result.**

- `placement-1`: 2026-11-17, caught: shipped 2/2, placement 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-1/report.md)
- `placement-1`, read: the shipped skill already catches g77 and g79 on `design-tab-code` in both runs ("Code status sits in the Design tab", moved to the top of the Code tab; Mark ready and Mark implemented… into a ⋯ menu), so the section can't show the candidate's lines adding to that. On this section the candidate's reviews are shorter, 8 and 4 findings against 16 and 14: they drop findings the shipped reviews made (the route's focus ring at 25%, the status value muted like its label, the route drawn as a bespoke field). On the held-out sections the new rows move what is edited in place: on `element-toolbar` both candidate reviews take the value controls off the selection's toolbar while the inspector is open, put radius and shadow and the Link action behind More, and hide unset values; on `layers` both drop the route from page rows, and one keeps the selected row's eye, lock and More in view at rest. No shipped review proposed any of these. Rename in place is kept by both (g42 2/2 with the candidate). Across all the gaps 15 of 24 against 14, the difference's interval holding 0; unmatched findings a review 10.2 against 12.8.
- `placement-nov17`, decided (the person, 2026-11-17): revise, then measure on fresh briefs, Opus designing after the current round; row-lines and placement land each on its own once adopted. The toolbar cards fell away: the selection has had no element toolbar since 12 November, so `element-toolbar` stays only as a held-out picture of a surface edited in place. The revision is `candidates/placement-2`, built on the skill as shipped since #31: a surface that edits an object where it is (a bar on the selection, a row's own toggles, an inline field) keeps the controls it edits it with, and a row keeps what names it (placement.md, "Where an object is edited"; review row U14); the review says placement (U10–U14) is one part of the pass and every other row is still gone through. Its recall on the same three sections and four fresh briefs (`fresh-place-invoice`, `-deploy`, `-order`, `-job`: one object in two states each, 2 runs per skill, Opus designing) are queued for the weekly reset of 23 November; each brief has a key scored both ways: what is needed but not in view, and what is rare or pointless yet shown (a screen whose object has no menu may keep one or two rare actions inline and quiet, as placement.md allows; only those past two count), with the primary for the state.
- `placement-2`: 2026-11-17, caught: shipped 2/2, placement-2 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-2/report.md)
- `placement-2`, read: the revision keeps what is edited in place. On `element-toolbar` neither candidate review takes a value control off the bar or puts one behind More; they ask for the link's destination on the bar and a glyph on every value select, while one shipped review folds the values past three into an overflow. On `layers` both candidate reviews keep the route on the page row ("the row keeps its name and its route") and one keeps More in view on the selected row, as one shipped review does. On `design-tab-code` both still move the Code section to the Code tab and Mark ready and Mark implemented… into the page's ⋯ menu or one quiet link; the reviews are no longer short, 15 and 9 findings against 14 and 19. Across all the gaps 12 of 24 against 15, the difference's interval holding 0 (−25 to 0), the losses on g29, g42 and g09 one run each; unmatched findings a review 11.7 against 13.2. Cost $18.76. The fresh briefs stopped at Claude's weekly limit with 3 of 8 runs a version; they resume after the banked reset.
- `pf-opus`, `pf-opus-p2`: 2026-11-17, the four `fresh-place-*` briefs (one object in two states each), 2 runs a version, Opus in Claude Code designing with the shipped skill and with `candidates/placement-2`, 32 screens scored from each brief's key by Opus reading the pictures and the source (one shipped answer failed to parse and was scored again). Needed but not in view: 0 of 72 for each. Rare actions in view at rest: 43 of 132 shipped, 39 of 132 candidate. Actions the state makes pointless, shown: 7 of 74, 3 of 74. A primary that fits the state: 12 of 16, 16 of 16; three of shipped's four misses are a primary on a finished state (Send receipt on a paid invoice, Send tracking on a delivered order) where the candidate draws none. Blind pairwise, both orders, Opus judging: shipped 4, candidate 2, 2 ties (clear both orders 1 to 0); shipped took hierarchy 6–2, craft 5–1 and use 3–1, the judge reading the candidate's three equal buttons on a paid invoice as no main action and its draft's five buttons in a row as Send lost among them; the candidate's clear win, a rollback set beside the live errors it answers. Tells: none on either but one eyebrow. Cost of the scoring $11.83. Read: the candidate places the primary by the state, as written, and the review keeps what is edited in place, but the designs show nearly as many rare actions at rest as without it, so g78 is not moved; the decision is the person's, in `decisions/placement2-nov17`.
