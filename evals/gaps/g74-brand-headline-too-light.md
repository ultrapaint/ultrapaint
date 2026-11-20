---
id: g74
title: A brand page's headline set lighter than the brand asks
kind: missing
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/typography.md]
sections: []
---

**What happened.** On `alignui-waitlist` run 2 the headline was `56px` medium, its first line muted. The person, judging it against the no-skill page: "The run with the skill is better. Still the gradients from the texts were not detected correctly. The top row of the text should have a top to bottom gradient where on top it's more grey and at the bottom is white. The bottom line is a left-to-right blue to purple color. Also the font should be slightly bolder." On `untitled-pricing` the per-run judge counted a semibold headline against the skill's rule, so the evidence points two ways. Pictures: `gaps/g74/`.

**The skill now.** `SKILL.md`, Type: "A display headline ranks by size: regular or medium, bold only when the brand calls for it." `references/picture.md` keeps a picture's colours and type, and says nothing of gradient-filled words.

**Proposed.** Not yet a rule: collect the person's reading of more brand headlines first. When a picture is given, `picture.md` keeps a headline's gradient and weight as the picture has them (see g54).

**Test.** The held-out pages' headlines, judged; the person's look at the in-sample AlignUI runs.

**Result.**

- `held-ship`, `held-pp`: 2026-11-11, six `held-*` pages from facts briefs, 2 runs each, Opus designs and judges. The per-run judge raised a display weight lighter than the brand: shipped 2 ("Thin literary serif where the brand asks for bold type", held-bloom), candidate 3 ("Display weight not read from the brand", held-videoask ×2, held-workos-atlas). Still no rule: the person's reading of the in-sample AlignUI headlines comes first.
- `lab-nov20`, answered (the person, 2026-11-20): of four held-out brand pages beside a shipped
  run, Bloom, AlignUI and Atlas set the headline lighter than the brand asks; VideoAsk does not.
- `fx-opus-dw`: 2026-11-20, `held-bloom`, `held-workos-atlas`, `alignui-waitlist` and `held-videoask`
  (the control, whose brand is regular), 2 runs each, Opus in Claude Code designing with
  `candidates/display-weight` (the display weight by character, technical `600`, humanistic `500`,
  expressive `800`, a thin face only for a literary or luxury brand; T7 turned to flag a headline
  lighter than its character), against `held-ship` and `out-land` (the same "regular or medium"
  rule). The hero's computed weight, read in Chrome at 1440px, shipped → candidate: Bloom `400`
  serif → `800`, `700`; Atlas `500`, `600` → `600`, `600`; AlignUI `500`, `500` → `600`, `600`;
  VideoAsk `500`, `500` → `700`, `600`, against a brand set at about `400`. The three brands the
  person flagged move toward their brand; the control moves away from it. The pairs are asked in
  `decisions/lab-nov20b`.

