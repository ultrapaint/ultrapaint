---
id: g61
title: Two values for one thing in the skill
kind: missing
status: done
found: 2026-11-10
source: the skill's files read against each other in an audit of this repository, kept by the person as one gap on 2026-11-10; not a person's correction
skill: [SKILL.md, references/system/foundations.md, references/motion.md, references/typography.md, references/accessibility.md, references/pages/landing.md, references/pages/portfolio.md, references/pages/shop.md]
sections: []
---

**What happened.** In seven places the skill gives two values for the same thing, so a designer
who follows one line breaks another, and a reviewer can report either as a failure with a rule to
cite. No design was corrected for this: the files were read against each other.

**The skill now.** Each pair as the files have it on 2026-11-10:

1. A caption's size.
   - `SKILL.md`, Type: "Floors: body `16px`, interface text `14px`, captions `13px`".
   - `references/system/foundations.md`, The text styles: "Small (metadata, captions) |
     `12–13px`".
2. A hover's duration in a product.
   - `SKILL.md`, Motion: "hover and tabs at most a `150ms` fade".
   - `references/motion.md`, Durations: "Press, hover, toggle in a product | `100–160ms`".
3. A public page's subhead.
   - `references/typography.md`, A public page's type: "**The subhead**: one `16–18px` line in
     muted."
   - `references/pages/landing.md`, Hero: "a muted `18–20px` subhead". The landing file is opened
     with `typography.md`, so a designer has both open.
4. A public page's container.
   - `SKILL.md`, Layout: "a public page's container is about `1200–1300px`".
   - `references/pages/landing.md`, By character: "**Technical:** one centred column
     `1040–1300px`".
5. Whether a page's recipe may leave the motion values.
   - `references/motion.md`, its first lines: "Curves and durations are the design system's
     motion tokens, or the values below, used exactly as written." Its tables give content
     entering a public page on scroll `500–800ms`, and three `cubic-bezier` curves beside `ease`
     and `linear`.
   - `references/pages/landing.md`, Motion: "`Image loaded · image · opacity 0→1 · 400ms ·
     cubic-bezier(0.4, 0, 0.2, 1)`", a curve the tables do not have.
     `references/pages/portfolio.md`, Motion: a headline entering in `1000ms`, and an image in
     "`900–1200ms · cubic-bezier(0.76, 0, 0.24, 1)`", a duration and a curve they do not have.
     `references/pages/shop.md`, Motion: "a `16–40px` fade-rise, `600–1000ms`".
6. How far and how long a section block moves as it scrolls into view, in one recipe.
   - `references/pages/landing.md`, Motion: "`Scroll into view · section blocks · opacity 0→1,
     translateY(20px)→0 · 700ms · …`".
   - The same line, next sentence: "Size scales the move: an item `16px`/`400ms`, a block
     `24px`/`500ms`, a hero line `40px`/`800ms`", which `references/motion.md` says too.
7. What a field's placeholder holds.
   - `SKILL.md`, Components: "a field's hint is its placeholder".
   - `references/accessibility.md`, Labels: "A placeholder is only an example."
     `references/typography.md` and `references/kinds/form.md` say an example as well.

The core opens on "Every rule below holds on every screen it names, whatever else you read."
Read as an order of precedence, that settles 1, 2, 4 and 7 for the core and leaves the other
file's value as text nobody may follow; nothing settles 3, 5 and 6, which are between two
references or inside one.

So a designer following the skill cannot know:

- whether a caption may be `12px`, when the system's Small style is;
- whether a `160ms` hover is too long;
- which size a landing page's subhead takes: `16`, `18` or `20px`;
- whether a technical landing page's column may be `1040px` wide;
- whether a page's motion recipe is written as its file gives it or brought inside
  `motion.md`'s tables;
- whether a section block rises `20px` in `700ms` or `24px` in `500ms`;
- whether a hint goes in the placeholder, and whether the placeholder holds a hint or an example.

**Proposed.** One value for each of the seven, chosen by the person as the eight disagreements of
ADR 0069 were, written in the file that owns it; the other file drops its value. For 5, either
the pages' recipes come inside `motion.md`'s tables, or `motion.md` says a page's file may give
its own durations and curves.

**Test.** Recall cannot measure it: no section shows it. By reading: each of the seven has one
value across the skill's files, searched for by the values quoted here. In a design round on
landing references, the subhead's size, the container's width and the scroll entrance's distance
and duration counted across runs, before and after: fewer different values for one character.

**Result.**

- `flow-*`: 2026-11-17, the four flow briefs of ADR 0101 (a checkout, inviting people to a workspace, booking on a phone, cancelling a subscription), every screen photographed, 2 runs each; Opus in Claude Code designing all three versions (no skill, the skill as merged in PR #21, `candidates/one-value`: g61's seven values made one, g72's greys by the primary's temperature, g75's quiet field border), GPT-6.1-Sol no skill whole and the other two on the checkout and invite only (Codex's week ran out); Opus judging both orders, use (ADR 0101) a level of its own. Shipped against no skill: Opus 8 of 8 (5 clear both orders), GPT 4 of 4 (3 clear); use Opus 3 to 2, 3 ties (no skill won both invite runs' use: a persistent sent banner, the domain rule stated twice), GPT 3 to 0. Shipped against the candidate: Opus 3, candidate 1, 4 ties; GPT candidate 2, shipped 1, 1 tie; no margin clear both orders; use shipped 5 to 2. The judges' reasons are each run's own: photos left out for initials, a date-of-birth placeholder read as a value, an arrival date in a sentence. Eyebrows per page Opus 1.4 / 0.3 / 0, GPT 5.4 / 0.5 / 0.3; GPT fragments 0.3 · 1/4 shipped against 1.5 · 2/4 candidate, one page (`runs/flow-*`, `.work/flows-greys.md`). Nothing in the round is g61's to win or lose: its test is by reading, and each of the seven now has one value across the skill's files.
- Decision of 2026-11-17 (made by the agent, as the person asked): g61's part of `one-value` ships: a caption `13px`; a product's hover `100–150ms`; a subhead `18–20px` under a hero's headline and `16–18px` under a section's heading; a public page's container `1200–1300px`, a technical one's from `1040px`; a page's file gives its own motion recipes, `motion.md`'s values holding elsewhere; a section block rising `24px` in `500ms`; a placeholder an example of the format, a rule the field must meet a line under it. The candidate tied shipped with no tell rising beyond a page.
