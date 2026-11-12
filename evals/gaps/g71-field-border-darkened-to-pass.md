---
id: g71
title: A field's border darkened to pass 3:1
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/system/foundations.md, references/accessibility.md]
sections: []
---

**What happened.** On `alignui-waitlist` both runs set the fields' resting border to a mid grey to reach `3:1` (`--color-input: #8f8f8f`, 3.2:1; `--color-border-field: #868c98`, 3.4:1 and blue-grey), and the per-run judge found the outlines the heaviest strokes after the headline. The person: "that border seems a bit dark, but you should check based on how we handle the semantic tokens and color palettes". Ultrapaint's own editor sets `--input` to `oklch(0.66 0.005 70)` in light and `oklch(0.54 0.005 70)` in dark (`apps/web/src/styles.css`): a warm step of its neutral scale; shadcn's default `input` equals its `border`. Pictures: `gaps/g71/`.

**The skill now.** `SKILL.md`, Accessibility: "large text…, icons, field borders and focus rings `3:1`". `references/system/foundations.md`: colour tokens by role, `border`, `input`, `ring`. Nothing says which step of the palette `input` is, so each page picks a grey that passes.

**Proposed.** `foundations.md`: "`input` is a step of the system's own neutral scale, the lightest that reaches `3:1` on the ground fields sit on, computed in each theme; a screen never picks a darker grey for one field." The Accessibility line keeps `3:1` for the token, not for each field.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. The person looks at the fields of the in-sample AlignUI runs.

**Result.**

- `pp-in`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). alignui-waitlist: shipped 3/3 ("3:1 field-border rule darkens resting outlines"), candidate 1/3. No held-out page has a resting field. The person's look at these fields is still to do: on 11 November they asked that it be checked against how semantic tokens and palettes are handled (`decisions/skill-plan-nov11`, field-border).
- The person, 11 November (`public-pages-ship`): the resting border must not be `3:1`; the candidate's border is too dark. Rework toward a lighter step of the system's neutrals.
