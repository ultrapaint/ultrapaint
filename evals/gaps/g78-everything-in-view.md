---
id: g78
title: Everything in view, nothing ranked by use
kind: missing
status: done
found: 2026-11-17
source: the person, after the Code section in the Design tab (g77); the editor's right panel
skill: [SKILL.md, references/usability.md, references/kinds/settings.md, references/kinds/navigation.md]
sections: [design-tab-code]
---

**What happened.** The person, on designs made with the skill: models "splash out everything on
the screen: text, actions, labels, whatever. A clean UI shows only what the user needs to see and
is important enough for them to see." Nothing in a design decides what is in view, what is one
step away (a menu, a disclosure, "Show more", Advanced), what lives elsewhere (Settings, another
surface) and what is not shown at all. Every field, option and figure the agent can think of is
drawn at the same level. g76 is the case of descriptions; this is the case of content, options and
data.

**The skill now.** The restraint rules remove what repeats ("A label … that says what the content
already shows is noise"); the usability file says "Options in view … Every action has a visible
control". Nothing says what to hide, behind what, or what to leave out because no task needs it.
`motion.md` mentions an accordion only for its animation.

**Sources** (research of 2026-11-17):

- NN/g, progressive disclosure: "You have to disclose everything that users frequently need up
  front"; it "defers advanced or rarely used features to a secondary screen"; it works only if
  "you … get the right split" and "it [is] obvious how users progress"; "designs that go beyond 2
  disclosure levels typically have low usability"
  (nngroup.com/articles/progressive-disclosure/).
- NN/g, heuristic 8: "Every extra unit of information in an interface competes with the relevant
  units"; but "a minimalist design contains all necessary elements to support user tasks"
  (nngroup.com/articles/aesthetic-minimalist-design/).
- Microsoft Win32: hide only what "users need to see … in some but not all scenarios"; declutter
  first by "showing contextual detail only in context", "reducing the weight of affordances for
  secondary UI", "showing follow-up steps only after prerequisites are done"; "Don't hide commonly
  used options … because users might not find them"
  (learn.microsoft.com/en-us/windows/win32/uxguide/ctrl-progressive-disclosure-controls).
- GOV.UK accordion: "Test your content without an accordion first"; "Do not use an accordion for
  content that all users need to see" (design-system.service.gov.uk/components/accordion/).
  Details: "Do not use [it] to hide information that the majority of your users will need". Tabs:
  not when users need to "compare information in different tabs" (…/components/tabs/). NN/g:
  "Keep crucial information outside accordions" (nngroup.com/articles/accordions-on-desktop/);
  "Users shouldn't need to find a tooltip in order to complete their task"
  (nngroup.com/articles/tooltip-guidelines/).
- Settings or the surface. Apple: options like "showing or hiding parts of the current view,
  reordering … or filtering a list" belong "in the screens they affect"; Settings takes "general,
  infrequently changed settings"; "Minimize the number of settings"
  (developer.apple.com/design/human-interface-guidelines/settings). Microsoft: "Commands that are
  part of the typical app workflow … shouldn't be in a settings page"
  (learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings).
- Defaults. NN/g: "Assume that users will not change defaults"; "It's too easy to resolve a design
  debate by simply offering all the possible options as preference settings"
  (nngroup.com/articles/customization-of-uis-and-products/).
- The cost of hiding. NN/g: hiding main navigation cut its use "almost in half", users "at least
  39% slower" (nngroup.com/articles/hamburger-menus/). Findlater & McGrenere 2007: a reduced
  interface is faster for the common features, but users of the full one "were more aware of
  advanced features". Baymard: content in horizontal tabs on product pages is "repeatedly …
  overlook[ed]" (baymard.com/blog/avoid-horizontal-tabs).
- NN/g on generated UI suggests sorting information into "must show, should show, never show"
  (nngroup.com/articles/generative-ui/).

**Proposed.** Four places, decided per element before drawing (the ranking is p12's step):

| Where | What goes there |
| --- | --- |
| In view | What most users need on most visits: the screen's job, the facts its decision needs, what everyone must discover |
| One step away | What some users need some of the time: a menu, a "Show more", a disclosure named for what it holds ("Advanced options"), a drawer for context on the current view; always a visible, labelled trigger |
| Elsewhere | General, rarely changed preferences: Settings. Another surface's job: that surface (g77) |
| Nowhere | What serves no task; a choice a default settles; a question the product can answer itself (what it detects stays in view where the user must check or change it: a detected address on an invoice) |

With: declutter by context before hiding (an object's controls when it is selected, follow-up
fields after their prerequisite); at most two levels (no accordion in an accordion, no popover
from a popover); never an accordion or a tooltip for what all users need, never tabs for what is
compared; options that change the current view stay on it; one default for the many rather than a
setting.

**Test.** Fresh briefs whose domain gives far more data and options than one screen needs (an
order's page, an invoice editor, a project's settings): count the elements in view against an
expert's must-show list, and the must-show items lost behind a step (hiding has a cost, so both
directions are scored). Recall on the g77 section for the rare actions it shows at rest.

**Result.**

- `placement-1`: 2026-11-17, caught: shipped 0/2, placement 0/2 (+1 partly) (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-1/report.md)
- `placement-1`, read: the shipped skill already catches g77 and g79 on `design-tab-code` in both runs ("Code status sits in the Design tab", moved to the top of the Code tab; Mark ready and Mark implemented… into a ⋯ menu), so the section can't show the candidate's lines adding to that. On this section the candidate's reviews are shorter, 8 and 4 findings against 16 and 14: they drop findings the shipped reviews made (the route's focus ring at 25%, the status value muted like its label, the route drawn as a bespoke field). On the held-out sections the new rows move what is edited in place: on `element-toolbar` both candidate reviews take the value controls off the selection's toolbar while the inspector is open, put radius and shadow and the Link action behind More, and hide unset values; on `layers` both drop the route from page rows, and one keeps the selected row's eye, lock and More in view at rest. No shipped review proposed any of these. Rename in place is kept by both (g42 2/2 with the candidate). Across all the gaps 15 of 24 against 14, the difference's interval holding 0; unmatched findings a review 10.2 against 12.8. g78 itself: caught by neither, one candidate review partly ("Five equal controls, no ranking" on the toolbar, which is the held-out section, not this one). Its fresh-brief test waits for quota.
- `placement-nov17`, decided (the person, 2026-11-17): revise, then measure on fresh briefs, Opus designing after the current round; row-lines and placement land each on its own once adopted. The toolbar cards fell away: the selection has had no element toolbar since 12 November, so `element-toolbar` stays only as a held-out picture of a surface edited in place. The revision is `candidates/placement-2`, built on the skill as shipped since #31: a surface that edits an object where it is (a bar on the selection, a row's own toggles, an inline field) keeps the controls it edits it with, and a row keeps what names it (placement.md, "Where an object is edited"; review row U14); the review says placement (U10–U14) is one part of the pass and every other row is still gone through. Its recall on the same three sections and four fresh briefs (`fresh-place-invoice`, `-deploy`, `-order`, `-job`: one object in two states each, 2 runs per skill, Opus designing) are queued for the weekly reset of 23 November; each brief has a key scored both ways: what is needed but not in view, and what is rare or pointless yet shown (a screen whose object has no menu may keep one or two rare actions inline and quiet, as placement.md allows; only those past two count), with the primary for the state.
- `placement-2`: 2026-11-17, caught: shipped 0/2, placement-2 0/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/placement-2/report.md)
- `placement-2`, read: the revision keeps what is edited in place. On `element-toolbar` neither candidate review takes a value control off the bar or puts one behind More; they ask for the link's destination on the bar and a glyph on every value select, while one shipped review folds the values past three into an overflow. On `layers` both candidate reviews keep the route on the page row ("the row keeps its name and its route") and one keeps More in view on the selected row, as one shipped review does. On `design-tab-code` both still move the Code section to the Code tab and Mark ready and Mark implemented… into the page's ⋯ menu or one quiet link; the reviews are no longer short, 15 and 9 findings against 14 and 19. Across all the gaps 12 of 24 against 15, the difference's interval holding 0 (−25 to 0), the losses on g29, g42 and g09 one run each; unmatched findings a review 11.7 against 13.2. Cost $18.76. The fresh briefs stopped at Claude's weekly limit with 3 of 8 runs a version; they resume after the banked reset.
- `pf-opus`, `pf-opus-p2`: 2026-11-17, the four `fresh-place-*` briefs (one object in two states each), 2 runs a version, Opus in Claude Code designing with the shipped skill and with `candidates/placement-2`, 32 screens scored from each brief's key by Opus reading the pictures and the source (one shipped answer failed to parse and was scored again). Needed but not in view: 0 of 72 for each. Rare actions in view at rest: 43 of 132 shipped, 39 of 132 candidate. Actions the state makes pointless, shown: 7 of 74, 3 of 74. A primary that fits the state: 12 of 16, 16 of 16; three of shipped's four misses are a primary on a finished state (Send receipt on a paid invoice, Send tracking on a delivered order) where the candidate draws none. Blind pairwise, both orders, Opus judging: shipped 4, candidate 2, 2 ties (clear both orders 1 to 0); shipped took hierarchy 6–2, craft 5–1 and use 3–1, the judge reading the candidate's three equal buttons on a paid invoice as no main action and its draft's five buttons in a row as Send lost among them; the candidate's clear win, a rollback set beside the live errors it answers. Tells: none on either but one eyebrow. Cost of the scoring $11.83. Read: the candidate places the primary by the state, as written, and the review keeps what is edited in place, but the designs show nearly as many rare actions at rest as without it, so g78 is not moved; the decision is the person's, in `decisions/placement2-nov17`.
- `placement2-nov17`, decided (the person, 2026-11-18): the person reads the candidate's screens as better than the shipped ones, against the blind judge (shipped 4, candidate 2), but with too many buttons in the header; a finished state's primary is the action taken there most (Send receipt on a paid invoice), not none; and a cap at rest is tried next. placement-2 is not shipped as it is. The next attempt is `candidates/placement-3`: placement-2 with an object's header at rest showing at most the primary and the two actions its state makes most frequent, every other action in its ⋯ menu (no inline allowance for rare ones), and a finished state's primary its most common action. It is measured on the four `fresh-place-*` briefs, 2 runs, Opus designing, against `pf-opus` and `pf-opus-p2` (the shipped skill is unchanged on main since), with the header's actions at rest counted on each screen. Lab rounds run on Opus only from now on (the person, 2026-11-18): the GPT runs that waited for the Codex reset are dropped.
- `pf-opus-p3`: 2026-11-18, `candidates/placement-3` on the four `fresh-place-*` briefs, 2 runs, Opus in Claude Code designing; all three rounds (`pf-opus` shipped, `pf-opus-p2`, `pf-opus-p3`) scored again by Opus under the keys of 18 Nov, with the actions in the object's header at rest counted (48 screens, $17.32). Header over three actions: shipped 0 of 16, placement-2 4 of 16, placement-3 2 of 16 (mean 1.9, 2.3, 2.5). Rare actions in view at rest: 23 of 110, 20, 16. Rare facts in view (build machine, size of functions, previous jobs at the address, the approval limit, job code, marketing consent, risk check): 19 of 22, 18, 21. Needed but not in view: 0, 0, 2 of 72 (Contact the customer on a delivered order, Tell the tenant they are on the way). Pointless shown: 3, 7, 8 of 74. A primary that fits the state: 15, 16, 16 of 16. Scored twice, the same shipped and placement-2 screens moved on pointless from 7 and 3 to 3 and 7: the per-item judgement varies by about four either way, so differences of that size are noise. Blind pairwise, both orders, Opus judging, each run alone: shipped against placement-3 4–0 in run 1 and 4–0 in run 2 (every brief leaning shipped in both runs; clear both orders 2–0; hierarchy 8–0, use 6–0, craft 5–1), placement-2 against placement-3 3–1 and 3–1 (pooled 6–2; placement-3 took the invoice in run 1 and the order in run 2). The judge's reasons are mostly not placement: a failed deploy drawn with build steps passing, the ship button in the header away from the address it uses, the resend of the tracking lifted into the header away from the tracking. Tells: none on placement-3. Read: the cap mostly holds (two deploy screens, one live and one failed, still show four header actions besides the ⋯ menu) and placement-3 shows the fewest rare actions, but the shipped skill already keeps headers to three, so the header was placement-2's problem, not the skill's; what every version still shows at rest is the rare facts, which no rule here touches. The person's eye on the invoice and order headers, and shipping, are asked in `decisions/placement3-nov18`.
- `placement3-nov18`, decided (the person, 2026-11-18): the person prefers placement-3's draft invoice header; on the delivered order, placement-2's, with Send tracking again as the primary where resending is common. On the paid invoice and the delivered order they object to placement-3's line of data under the title, which repeats what the page shows (now g80). On shipping, "the lab should decide", after a screen-by-screen comparison of shipped against placement-3 (`decisions/compare-p3-nov18`, all eight screens, both runs; my count: placement-3 better on 1, shipped on 3, even on 4). Next, by their choice, a rule for rare facts: `candidates/show-less-1`, the shipped skill with four lines (the header cap and finished-state primary of placement-3; the line under an object's title, g80; facts needed only sometimes under one Details disclosure at the end of the side column, or on another tab) and review rows W21–W23. It is built on the shipped skill, not on placement-3, because the judge preferred the shipped skill on every brief over placement-3, while the ranking step and the placement reference showed no gain in three rounds. Measured on the four fresh-place briefs, 2 runs, Opus designing, against `pf-opus` and `pf-opus-p3`, with the line under the title scored.
- `pf-opus-sl1`: 2026-11-18, `candidates/show-less-1` (the shipped skill with the header cap, the finished-state primary, the line under an object's title and rare facts under one Details disclosure; review rows W21–W23) on the four `fresh-place-*` briefs, 2 runs, Opus in Claude Code designing; `pf-opus`, `pf-opus-p3` and `pf-opus-sl1` scored again by Opus with the line under the title (48 screens, $19.67). Rare items in view at rest: shipped 43 of 132, placement-3 38, show-less-1 22; of them rare facts 19 of 22, 22, 7, and rare actions 24 of 110, 16, 15. Facts in the line under the title: 40, 50, 13; of those shown again on the page: 21, 38, 2 (show-less-1 drew no line on the invoice and order screens, one or two facts on the deploy and job ones). Needed but not in view: 0, 2, 0 of 72. Pointless shown: 6, 5, 11 of 74 (mostly actions in the ⋯ menu a state makes pointless, Void on a paid invoice; within the spread of about four the scorer showed on rescoring). Header over three actions: 0, 1, 1 of 16. Primary right: 15, 16, 16 of 16. Blind pairwise, both orders, Opus judging, each run alone: shipped against show-less-1 3–0–1 in run 1 and 3–1 in run 2 (pooled 6–1–1; the deploy, invoice and job briefs lean shipped in both runs, the order leans neither; hierarchy 6–0, use 5–1, restraint 1–4); placement-3 against show-less-1 0–3–1 and 0–4 (pooled 0–7–1). The judge's reasons count showing less against it: "hides the rest under a collapsed Details panel", "carries more of the brief". A failed deploy drawn with Build and Upload passing after the typecheck failed appears in all four deploy runs of the two versions made on 18 Nov (placement-3, show-less-1) and in none of the four made on 17 Nov (shipped, placement-2), whose source marks them "Not run"; the brief lists every step's time and the cause is not known. Tells: none. Read: show-less-1 halves what is shown at rest, nearly clears the line under the title of repeats, and hides nothing needed; the judge prefers the fuller shipped screens, so the person decides, in `decisions/compare-sl1-nov18` (all eight screens, both runs; my count: show-less-1 better on 4, shipped on 1, even on 3).
- `compare-sl1-nov18`, decided (the person, 2026-11-18): show-less-1 is better than the shipped skill on all eight screens (on the order and the failed deploy, one run of it "kinda weak ui-wise. but still better than the shipped"), against the blind judge's 6–1–1 for the shipped skill; ship it. Shipped as written in `candidates/show-less-1`: in `SKILL.md`, at most three actions in an object's header at rest, a finished state's primary its most used action, at most one quiet line of one or two unrepeated facts under an object's title, and facts needed only sometimes under one Details disclosure; review rows W21–W23. The failed deploy drawn with later steps passing is watched in the next rounds.
