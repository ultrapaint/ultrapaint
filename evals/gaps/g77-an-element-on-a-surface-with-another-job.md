---
id: g77
title: An element on a surface whose job is another
kind: missing
status: open
found: 2026-11-17
source: the editor's right panel, Design tab with a page selected (redesign of 3 Nov, b8e96677), corrected by the person
skill: [SKILL.md, references/review.md, references/kinds/navigation.md]
sections: []
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

**Test.** Recall on a section captured at 7b86c9bd: the right panel's Design tab with a page
selected, dark and light, the Code tab named in `where` (that a Code tab exists must be visible,
or the reviewer cannot know). Caught: the Code section is flagged as belonging to the Code tab.
A held-out check that the row does not move things that change the element (an override, a
prototype link on its own surface) away from where they are edited.

**Result.**
