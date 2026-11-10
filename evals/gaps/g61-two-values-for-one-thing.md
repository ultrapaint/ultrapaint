---
id: g61
title: Two values for one thing in the skill
kind: missing
status: open
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
