---
id: p12
title: Elements drawn before they are ranked
kind: process
status: open
found: 2026-11-17
source: the Code section in the Design tab (g77), redrawn in place by the 3 Nov redesign
skill: [SKILL.md]
sections: []
---

**Setup.** The 3 Nov redesign redrew every panel of the editor in its design system. It took each
panel's sections as they were and restyled them; the right panel's Design tab kept its Code
section, although a Code tab sat beside it.

**What happened.** The design job names "the screen's job, its primary action and its kind" in one
sentence (step 2), then builds. No step lists what the screen could show and decides, element by
element, whether it serves that job, where it belongs and how often it is needed. So whatever is
there, or whatever the agent can think of, is drawn, at one level. p06 (copy kept because it was
there) is the same failure for words; a check for it in step 6 did not help, which points to a
step before drawing rather than another check after.

**Sources** (research of 2026-11-17): a priority guide lists the screen's content "sorted by
hierarchy … based on relevance to users", "without layout specifications", asking of each item
"whether [it] should really be on the page at all" (van Nues & Overkamp, A List Apart 2018); top
tasks are "usually less than 10, often less than five" (McGovern, A List Apart); task analysis
sorts tasks by "order, hierarchy, frequency" (nngroup.com/articles/task-analysis/); OOUX puts each
action on its object, conditional on its state; NN/g on generated UI: "must show, should show,
never show". Mobile First (Wroblewski, ch. 2): "Adding things … is relatively easy so lots of
things get added"; "You need to know what matters most."

**Proposed.** Step 2 becomes a short written ranking, before the first element:

1. The surface's job and the screen's: "Design tab: change how the selection looks."
2. The object it is about, its state and the user's role.
3. The user's tasks on it, most frequent first, at most five.
4. The one primary action, in the domain's verb, for that state.
5. Every element the screen could hold, inherited or new, each placed: in view, one step away,
   elsewhere (which surface), or nowhere (g78, g79). Elsewhere and nowhere are not drawn.

It is the design's counterpart of the review's inventory (PR #21): written, kept out of the
report, and read again at step 5.

**Test.** Restyle tasks on legacy screens that carry a misplaced or rare element (the g77 section
at 7b86c9bd), and fresh briefs with a rich domain (g78, g79): share of misplaced and rare elements
moved, against the built-in skill; and whether must-show elements stay in view.

**Result.**
