---
id: g78
title: Everything in view, nothing ranked by use
kind: missing
status: open
found: 2026-11-17
source: the person, after the Code section in the Design tab (g77); the editor's right panel
skill: [SKILL.md, references/usability.md, references/kinds/settings.md, references/kinds/navigation.md]
sections: []
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
