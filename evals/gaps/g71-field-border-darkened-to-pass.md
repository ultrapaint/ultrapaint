---
id: g71
title: A field's border darkened to pass 3:1
kind: missing
status: open
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
