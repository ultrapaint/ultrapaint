---
id: g86
title: A stock photo standing in for the brand's own
kind: missing
status: done
found: 2026-11-21
source: the person, on fx-opus-new20 (decisions/new20)
skill: [SKILL.md]
sections: []
---

**What happened.** The charity brief lists the trust's own photos (volunteers in waders, before
and after at four sites, the salmon at the fish pass) and the app has none. Run 1 fetched stock
photos: its hero is a beach clean-up in another organisation's T-shirts, the brewery a pint of
beer, the school a stock classroom. Run 2 drew twelve labelled placeholders, each captioned with the
photo it stands for. The person: "Labelled placeholders but depends on what the user asks, if they
explicitly request stock photos then we should use those".

**The skill now.** Nothing on what stands in for pictures the brief names and doesn't give.
`references/picture.md` ("never a grey box") is for rebuilding a picture, not for a new design.

**Proposed.** Where the brand's own pictures are named and not given, each is a labelled
placeholder: one flat tone of the palette, captioned with the picture it stands for and its crop.
A stock photo only when the person asks for one, and then one that shows what the brief says.
(Run 2's twelve copies of one gradient and wave read as decoration: the tone stays flat.)

**Test.** The briefs with named photos and none given (`fresh-river-charity`, `fresh-hotel`,
`fresh-bakery`, `fresh-coffee-roaster`, `fresh-cabin-search`), and for the clause one brief whose
named picture is a chart the page can draw (`fresh-changelog`), 2 runs each, Opus designing with
the candidate, against the skill on main: the pictures that are stock photos or that show
something the brief contradicts, counted per page. It passes at none, with every named photo drawn as
a captioned placeholder or, where its section was left out, not counted against it; a page that
drops the named photos outright fails. A chart, a diagram or a product screen the page can draw
(`fresh-changelog`'s timing chart) is the clause's: it passes drawn in code, and a placeholder for
one fails.

**Result.**
- `fx-opus-c20`: 2026-11-21, `candidates/new20` (the skill on main with the placeholder rule in
  `SKILL.md`), `fresh-river-charity` and `fresh-hotel`, 2 runs each, Opus in Claude Code designing:
  stock photos 0 in 4 runs (against `fx-opus-new20`'s charity run 1, a beach clean-up in another
  organisation's shirts); every named picture a flat captioned placeholder. It went one step too
  far: the changelog's timing chart, which the brief lists as a picture, was a grey placeholder in
  both runs, where `fx-opus-new20` drew it in code.
- `fresh-changelog`, the clause's brief: in `fx-opus-c20`, without the clause, its timing chart
  was a placeholder in 2 of 2 runs; in `fx-opus-new20` (the skill before g86) drawn in code in 2 of
  2. With the clause, in `fx-opus-main23` (2026-11-23, the skill as merged in PR #92, 2 runs, Opus
  in Claude Code designing): the timing chart and the insights page drawn in code in 2 of 2 runs,
  no placeholder.
- Decision of 2026-11-22 (`decisions/new20-ship`): shipped, with the clause "A chart, a diagram or
  a screen of the product the page can draw is drawn, not left as a placeholder".
