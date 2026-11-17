---
id: g79
title: Actions placed by count, not by use
kind: missing
status: open
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
