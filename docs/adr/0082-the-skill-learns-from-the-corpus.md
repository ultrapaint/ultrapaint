# ADR 0082: The design skill learns from the corpus and is measured on fresh briefs

Status: accepted, 2026-11-12 (`decisions/lab-direction-nov12` in the lab's data directory).
Changes how the lab works, not the editor.

## Context

From 28 October to 11 November the lab improved the design skill by remaking a few reference
pages (Untitled UI's screens, a waitlist, a hospital landing page, a pricing page), judging each
page against its reference and writing the differences into rules. On 11 November a candidate
built that way beat the shipped skill 5–1 on the three pages its lines came from, and lost 4–6 on
six pages it had not seen (`reports/skill-plan-2026-11-11.md` §7). The rules were one page's
choices: a recommended column running from its card to the table's last row, a recipe for one
waitlist. The person: landing pages are the most creative pages, and a skill that fixes on one
reference's details can't serve the range of projects it is for.

The lab holds about 6,900 captured sites (`corpus/`), 3,349 of them annotated by Opus in October
with fixed questions and free observations, and 1,735 shots of one app design system. The
annotations count what is common; what makes a page stand out sits unused in the observations.

## Decision

1. **The skill learns from the whole corpus, by kind of page and by character.** What well-made
   pages share becomes principles and ranges, never one page's layout. Public pages and app
   screens are studied together; app screens need sources beyond one design system.
2. **A catalogue of moves:** the distinctive devices that catch attention or carry emotion, each
   with what it is, the kind of page and character it suits, what it needs and examples. The full
   catalogue lives in the lab's data with its pictures. The skill gets every move that is good and
   not a repeat of another, in a reference file, with no fixed count, and teaches choosing one
   or two that fit the brief.
3. **The skill never names a company, product, site, library or person from the references or the
   corpus.** It describes the device. Faces, icon packages and tools it tells the agent to use
   are instructions, not sources (`skills/ultrapaint/README.md`).
4. **The skill is measured on fresh briefs**, facts only, across kinds and characters: no skill,
   shipped and candidate, pairwise both ways, the person's look at a sample, the tells counted,
   and a variety measure (the same brief run several times, judged for how alike the runs are).
   Resemblance to a reference is never scored.
5. **Replication is its own track.** Rebuilding a page from a picture tests extraction: read the
   page's system, rebuild from what was read, compare, and what the rebuild loses the extraction
   missed. It also counts execution faults per element, a craft check. One reader of pages, from
   screenshots (PNG or SVG), serves extraction in the product and the corpus study in the lab.
   Reading the live page (as `designlang` does) waits.

## Consequences

- The reference rounds (`round`, `out-land`-style pairwise against a reference) stop being the
  design skill's measure; the gaps they produced that are single-page recipes are set aside
  (g62, g63, g64, g69), and those that hold for any page went into the skill (g65, g68, g73).
- The October notes are reused; what they lack (the moves, measured numbers) is read again from
  the pictures.
- Sources join as they come; nothing waits for all of them. A new set of screens (real app
  screens the person gathers, say) goes through the same steps: noted with the same questions,
  its moves found and checked on its own pictures, then merged into the catalogue, repeats
  folded and their examples joined. A candidate with what changed is measured on fresh briefs
  before it ships, as any other. The lab does not capture open-source products for app screens
  (the person, 12 November).
- A screenshot reader can't measure what the DOM knows (exact sizes, tokens); it is checked by
  the rebuild test before the study trusts its numbers.
