# The design skill

`ultrapaint/` is the design skill (GLOSSARY, "Design skill"), in the Agent Skills layout (ADR
0069). It ships as the folder is, through the server and through `npx skills add`, so this file
sits outside it and everything inside it is for the agent that uses the skill.

## How it is written

- `SKILL.md`, the core, is the one file always read. It holds the steps of the four jobs, every
  rule that bears on most screens as one line with its value, and the table of kinds. Its front
  matter's `description` stays under 220 characters.
- A reference holds what a line cannot (anatomy, values, recipes, reasons), sits one level below
  `references/`, is named by the core, and never repeats a core line. It ends on a check table of
  what it adds. A kind's file names under its title the topic files it is opened with.
- A value that differs by character (technical, humanistic, expressive) is stated once for each,
  never as options to pick from. A public page's file ends with two short worked examples per
  character, values only.
- The skill speaks the web's terms, with none of the editor's words, and names nothing of the
  editor but its own name, `ultrapaint`. What an agent may have beyond files and a reply (a
  question tool, a reviewer that sends findings, a view at a width…) is a capability its "Where
  you work" names once and each step uses in those words; the briefing's `skillTerms` says what
  the editor gives for each, and its terms for the rest. A test holds both.
- A rule holds for any product and describes the device, never where it was seen: no company,
  product, site, library or person from the lab's references or corpus (ADR 0068). Faces, icon
  packages and tools the agent is told to use (Inter, Lucide, Figma) are instructions, and named.
- A review category names a concern; `CATEGORY_FILES` in `packages/contracts/src/review.ts` says
  which file holds each.

## Changing it

A change starts from a gap in `evals/gaps/` and is measured against the shipped skill before it
lands (`evals/README.md`); it names the gaps it closes. After an edit, run `pnpm -F
@ultrapaint/server skills`: it writes the skill into `apps/server/src/skills/design.generated.ts`,
and a test fails while the two differ.
