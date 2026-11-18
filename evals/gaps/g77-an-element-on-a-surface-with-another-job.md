---
id: g77
title: An element on a surface whose job is another
kind: missing
status: testing
found: 2026-11-17
source: the editor's right panel, Design tab with a page selected (redesign of 3 Nov, b8e96677), corrected by the person
skill: [SKILL.md, references/review.md, references/kinds/navigation.md]
sections: [design-tab-code]
---

**What happened.** The editor's right panel has two tabs: Design (how the selection looks) and
Code (the selection as code). With a page selected, the Design tab held a "Code" section between
the page's fields and its layout: the implementation status, the tokens waiting for the code with
Export, Implement, Mark ready and Mark implemented…. The Code tab beside it had existed since
25 Sep; the 3 Nov redesign redrew the section in place and kept it there. The person: "That's the
Design tab, so it should not contain any code-related stuff. There is a tab for that." It was moved
to the Code tab (PR #23, ADR 0102). The person's point is that an agent should have seen it unasked:
a tab named Code exists, so code belongs there.

**The skill now.** It has the rule for lists only:

- `SKILL.md`, Restraint: "A list holds one kind of item doing one kind of thing; an item that does
  something else goes where that kind of thing lives."
- `references/review.md`: "W3 An item doing another kind of thing in a list, or in a group of one |
  Move it where that kind of thing lives".

Nothing names the job of a tab, a panel, a page or a mode, so nothing asks whether a section
serves it. A section that is useful on its own passes every row.

**Sources** (research of 2026-11-17, in the thread that found this):

- Apple HIG, panels: an inspector "displays the details of the currently selected item"; a panel
  holds "controls or settings that affect the selected item"
  (developer.apple.com/design/human-interface-guidelines/panels). Tab bars: a tab's label
  describes "the type of content or functionality the tab contains"
  (…/tab-bars).
- Figma: the Design panel is to "view, add, remove or change the properties of objects"; code is
  in Dev Mode, "a developer-focused workspace for inspecting designs, viewing properties and
  generated code", where "statuses and notifications … help to manage developer handoff"
  (help.figma.com/hc/en-us/articles/15023124644247). Penpot: Design properties "view and edit the
  attributes of a selected layer"; Inspect gives "production-ready code"
  (help.penpot.app/user-guide/the-interface/). Sketch: the Inspector holds layer settings, with no
  code; inspection is a separate view (sketch.com/docs/developer-handoff/inspect/).
- The counter-case: Framer puts Code Overrides in the properties panel, because an override
  changes how the element behaves; Figma's "Mark as ready for dev" sits on the object on the
  canvas. The line is the job, not the word "code": changing the element is the design surface's;
  reading, exporting or handing it off as code is the code surface's.
- No source states "one surface, one job" in those words; it is the synthesis of the above.

**Proposed.** Generalise W3 from lists to surfaces:

- Core (Restraint): "Every surface (a tab, a panel, a page, a mode, a menu) has one job, named in
  a sentence. An element serves one job and sits on the surface that has it; where that surface
  exists, never a section or a copy of it on another. A surface may link to it."
- Review row: "A section serving another surface's job (code status in a Design tab, a billing
  figure on a profile page) | Move it to the surface that has that job, or link to it".
- Step 2 names the surface's job with the screen's (see p12).

**Test.** Recall on a section captured at 7b86c9bd, `design-tab-code`: the right panel's Design tab with a page
selected, and its Code tab for the same page, dark and light, whole window and @2x crops of the
panel, the Code tab named in `where` (that a Code tab exists must be visible, or the reviewer
cannot know); `element-toolbar` and `layers` are the held-out sections. Caught: the Code section is flagged as belonging to the Code tab.
A held-out check that the row does not move things that change the element (an override, a
prototype link on its own surface) away from where they are edited.

**Result.**

- `placement-1`: 2026-11-17, caught: shipped 2/2, placement 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-1/report.md)
- `placement-1`, read: the shipped skill already catches g77 and g79 on `design-tab-code` in both runs ("Code status sits in the Design tab", moved to the top of the Code tab; Mark ready and Mark implemented… into a ⋯ menu), so the section can't show the candidate's lines adding to that. On this section the candidate's reviews are shorter, 8 and 4 findings against 16 and 14: they drop findings the shipped reviews made (the route's focus ring at 25%, the status value muted like its label, the route drawn as a bespoke field). On the held-out sections the new rows move what is edited in place: on `element-toolbar` both candidate reviews take the value controls off the selection's toolbar while the inspector is open, put radius and shadow and the Link action behind More, and hide unset values; on `layers` both drop the route from page rows, and one keeps the selected row's eye, lock and More in view at rest. No shipped review proposed any of these. Rename in place is kept by both (g42 2/2 with the candidate). Across all the gaps 15 of 24 against 14, the difference's interval holding 0; unmatched findings a review 10.2 against 12.8.
- `placement-nov17`, decided (the person, 2026-11-17): revise, then measure on fresh briefs, Opus designing after the current round; row-lines and placement land each on its own once adopted. The toolbar cards fell away: the selection has had no element toolbar since 12 November, so `element-toolbar` stays only as a held-out picture of a surface edited in place. The revision is `candidates/placement-2`, built on the skill as shipped since #31: a surface that edits an object where it is (a bar on the selection, a row's own toggles, an inline field) keeps the controls it edits it with, and a row keeps what names it (placement.md, "Where an object is edited"; review row U14); the review says placement (U10–U14) is one part of the pass and every other row is still gone through. Its recall on the same three sections and four fresh briefs (`fresh-place-invoice`, `-deploy`, `-order`, `-job`: one object in two states each, 2 runs per skill, Opus designing) are queued for the weekly reset of 23 November; each brief has a key scored both ways: what is needed but not in view, and what is rare or pointless yet shown (a screen whose object has no menu may keep one or two rare actions inline and quiet, as placement.md allows; only those past two count), with the primary for the state.
- `placement-2`: 2026-11-17, caught: shipped 2/2, placement-2 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-2/report.md)
- `placement-2`, read: the revision keeps what is edited in place. On `element-toolbar` neither candidate review takes a value control off the bar or puts one behind More; they ask for the link's destination on the bar and a glyph on every value select, while one shipped review folds the values past three into an overflow. On `layers` both candidate reviews keep the route on the page row ("the row keeps its name and its route") and one keeps More in view on the selected row, as one shipped review does. On `design-tab-code` both still move the Code section to the Code tab and Mark ready and Mark implemented… into the page's ⋯ menu or one quiet link; the reviews are no longer short, 15 and 9 findings against 14 and 19. Across all the gaps 12 of 24 against 15, the difference's interval holding 0 (−25 to 0), the losses on g29, g42 and g09 one run each; unmatched findings a review 11.7 against 13.2. Cost $18.76. The fresh briefs stopped at Claude's weekly limit with 3 of 8 runs a version; they resume after the banked reset.
- `pf-opus`, `pf-opus-p2`: 2026-11-17, the four `fresh-place-*` briefs (one object in two states each), 2 runs a version, Opus in Claude Code designing with the shipped skill and with `candidates/placement-2`, 32 screens scored from each brief's key by Opus reading the pictures and the source (one shipped answer failed to parse and was scored again). Needed but not in view: 0 of 72 for each. Rare actions in view at rest: 43 of 132 shipped, 39 of 132 candidate. Actions the state makes pointless, shown: 7 of 74, 3 of 74. A primary that fits the state: 12 of 16, 16 of 16; three of shipped's four misses are a primary on a finished state (Send receipt on a paid invoice, Send tracking on a delivered order) where the candidate draws none. Blind pairwise, both orders, Opus judging: shipped 4, candidate 2, 2 ties (clear both orders 1 to 0); shipped took hierarchy 6–2, craft 5–1 and use 3–1, the judge reading the candidate's three equal buttons on a paid invoice as no main action and its draft's five buttons in a row as Send lost among them; the candidate's clear win, a rollback set beside the live errors it answers. Tells: none on either but one eyebrow. Cost of the scoring $11.83. Read: the candidate places the primary by the state, as written, and the review keeps what is edited in place, but the designs show nearly as many rare actions at rest as without it, so g78 is not moved; the decision is the person's, in `decisions/placement2-nov17`.
- `placement2-nov17`, decided (the person, 2026-11-18): the person reads the candidate's screens as better than the shipped ones, against the blind judge (shipped 4, candidate 2), but with too many buttons in the header; a finished state's primary is the action taken there most (Send receipt on a paid invoice), not none; and a cap at rest is tried next. placement-2 is not shipped as it is. The next attempt is `candidates/placement-3`: placement-2 with an object's header at rest showing at most the primary and the two actions its state makes most frequent, every other action in its ⋯ menu (no inline allowance for rare ones), and a finished state's primary its most common action. It is measured on the four `fresh-place-*` briefs, 2 runs, Opus designing, against `pf-opus` and `pf-opus-p2` (the shipped skill is unchanged on main since), with the header's actions at rest counted on each screen. Lab rounds run on Opus only from now on (the person, 2026-11-18): the GPT runs that waited for the Codex reset are dropped.
