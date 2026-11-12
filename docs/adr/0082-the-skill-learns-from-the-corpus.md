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
- The October notes are not reused for counting: they saw two screens of each page and asked a
  landing page's questions only. Every page is read again (below).
- Sources join as they come; nothing waits for all of them. A new set of screens (real app
  screens the person gathers, say) goes through the same steps: noted with the same questions,
  its moves found and checked on its own pictures, then merged into the catalogue, repeats
  folded and their examples joined. A candidate with what changed is measured on fresh briefs
  before it ships, as any other. The lab does not capture open-source products for app screens
  (the person, 12 November).
- A screenshot reader can't measure what the DOM knows (exact sizes, tokens); it is checked by
  the rebuild test before the study trusts its numbers.

## Since 12 November (decks `moves-strong` and `study-questions`)

- **The questions are asked once.** Tried in five versions on 59 pages and screens, every
  version's answers checked against the pictures and, for app screens, against Screenrove's
  measured tokens. The fifth (`evals/prompts/study-read.md`, `pnpm evals study read`) asks what a
  page is for (the brief, kind, domain and expression apart, mood, the skill's own seven dials),
  how it is seen (its sections in order, each boxed on its picture), its system as values, its
  words, mobile and motion, an app screen's shell and staging, its moves and weak points placed by
  section, the tells g53–g60, and its craft. Capture faults are kept apart from the design. A note
  records the questions' version, so a later source is read the same way. Trusted from the check:
  ground and text colours, type sizes to ±2px, the boxes, the answers that repeat when a page is
  read twice (domain 23 of 24, expression 24 of 24); not muted greys.
- **Moves:** a move is taught when it is seen on the pictures, distinctive, reusable on another
  product and costs no usability. Left out: repeats, devices so common they read as a template
  (one serif-italic word in a sans headline, a display serif on a tech product, a giant type
  marquee, text lit by scrolling, an eyebrow over every section), devices that cost reading or
  finding, and those that need what an agent rarely has. 74 of the 105 strongest were accepted
  (`candidates/moves`); the rest of the catalogue is rebuilt from the re-read's notes.
- **App screens:** Screenrove's packs and a sample of Untitled UI's shots, studied together;
  public pages from the four captured corpora. Each pack's measured tokens are also the ground
  truth for the extraction track (§5).
- **Fresh briefs:** 20 invented products' facts (`references/fresh-*`), public pages and app
  screens across the characters; judged pairwise against each other and the brief
  (`prompts/pairwise-fresh.md`), the tells counted, and `pnpm evals variety` for how alike a
  version's runs of one brief are. A skill gap is tested on fresh briefs it did not come from
  (`evals/gaps/README.md`).
