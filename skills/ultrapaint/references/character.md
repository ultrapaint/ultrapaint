# Character

Every product has a character: how it should feel, to whom. It sets the dials the other
references leave open: how warm, how dense, how round and how coloured the screens are, which
faces they use, whether they carry illustrations, how they speak. It is the user's to say and
yours to complete, and it is settled once, written down, and read by every screen after. Restraint
does not change with it: noise is noise in every character.

## Read it first

DESIGN.md says it: its Overview (who the product is for, how it should feel, a named reference)
and its tokens [with the editor's tools: (`read_design_system` returns it) | without: (at the root of the repository)]. A design
system without a DESIGN.md says it through its faces, radius and colours. Either way it is
settled: take it, and ask nothing.

When there is none yet, the product may still say it:

- **A product to read** (its code, its pages, pictures of it, a Figma file): its look is the
  character. Read it off (`references/design-system/extract.md`, `references/design-system/figma.md`),
  and write it down with its dials: the look sets every one.
- **A picture to remake**: the picture is the brief. Its warmth, radius, density and face are
  the character, over any default here.
- **A request that already says it**: who it is for and how it should feel ("a calm journaling
  app for teenagers, like a paper notebook"). Complete the rest, and write it down.

## When nothing says it, ask once

Before the first node, ask the user one question [with the editor's tools: with `ask_user` | without: in your reply, ending your turn], with two options, in this order:

1. **Decide from my request**: you choose from what they asked for.
2. **I'll describe it**: who it is for, how it should feel, a product or an object it should feel
   like, a brand colour or a face they already have.

Nothing else is asked: every other decision is yours. When they describe it, take their words
over every default here. When they leave it to you, decide from the request and the job: a tool
for operators and data is technical, one for people's own lives is humanistic, a page that sells
or tells a story is expressive.

## Complete it on the dials

The user's words set some dials; a preset below sets the others. Every dial ends on one choice:

| Dial | Choices | Words that set it |
| --- | --- | --- |
| Temperature | warm, neutral, cool | paper, cosy, friendly: warm; clinical, technical, icy: cool |
| Density | compact, regular, open | data, power users: compact; calm, beginners: open |
| Shape | sharp, soft, round | precise, serious: sharp; friendly, playful: round |
| Accent | restrained, lively, the brand's | quiet, focused: restrained; fun, energetic: lively |
| Type voice | neo-grotesque, geometric, humanist; a display face or a serif for headlines | editorial, literary: a serif for headlines |
| Imagery | none, icons, illustration, photography | |
| Tone | terse, warm, the brand's | |

A dial the user set wins over a default of the references, the taste rules among them: a cool,
clinical product gets blue-grey neutrals, a literary one a serif. Rules of quality do not bend:
contrast, the type floors, targets, restraint.

## Write it down before the first node

The character goes in DESIGN.md, the open format every agent reads, while you work, not after:
its Overview holds who the product is for, the feel in the user's words, a named reference ("a
printed lecture handout", not "clean and modern") and the dials in one line; its tokens hold the
values the dials chose (`references/design-system/foundations.md`). [with the editor's tools: Save it with `write_design_system`, the design system and DESIGN.md together. | without: Write DESIGN.md at the root of the repository, its tokens in its front matter.] Then tell the user
in three lines what you chose, the face, the colours and the shape, so they can correct it before
much is drawn. A later decision (a new colour, a component's shape) is added to DESIGN.md with the
reason it was made.

## Technical: admin, data, developer tools

- Dials: neutral, compact, sharp, restrained, neo-grotesque, no imagery, terse.
- Density: rows `32–40px`, navigation items `32–36px`, tables first.
- Type: a neo-grotesque sans, a mono for code, ids and figures that line up. Four sizes at most.
- Shape: small radius, `4–8px`; hairline borders; no shadows beyond menus and dialogs.
- Colour: neutral surfaces, one accent, status colours only for status.
- Imagery: none. Icons small, outline, only where they speed recognition. Charts plain.
- Tone: terse, exact; the noun and the number.

## Humanistic: consumer, learning, health, games

- Dials: warm, open, round, lively, geometric or humanist, illustration, warm.
- Density: navigation items `40–48px` with larger icons; generous padding; one task per screen
  where it can be.
- Type: a friendly geometric or humanist sans, a step larger at every level.
- Shape: larger radius, `12–20px`; soft fills rather than borders.
- Colour: warm neutrals, a livelier accent, a second hue for categories or progress.
- Imagery: illustrations and photographs welcome where they carry meaning: an empty state, a
  welcome, a reward. In games, celebration in motion and colour where something is won.
- Tone: warm, second person, encouraging; never cute where something can go wrong.

## Expressive: brand sites, landing pages, portfolios

- Dials: the brand's temperature and accent, regular, any shape, a display face, photography or
  illustration, the brand's tone.
- Layout: free. Full-bleed bands, asymmetric splits, a bento grid, a product visual that bleeds
  off the edge; each section a new composition on one rhythm.
- Type: a display face may carry the headlines, a serif among them when the brand asks for one;
  interface text stays sans. A headline at `48–80px`, one word set apart in a second weight,
  colour or face.
- Colour and imagery: the brand's, boldly: colour bands between sections, a hero visual,
  illustrations, motion on arrival.
- Tone: the brand's voice, one clear promise per section.
- Still: one primary action, repeated where the page ends; the noise restraint lists is cut here
  too.

## Before you finish

| You see | Fix |
| --- | --- |
| The first node placed with no character settled | Read DESIGN.md; else the product, the picture or the request; else ask once |
| A questionnaire put to the user | One question: decide from the request, or describe it |
| A character chosen and not written in DESIGN.md | Its Overview and its tokens, before the next screen |
| DESIGN.md's Overview without the dials in one line | One choice on each of the seven, read off the product or completed |
| A character chosen and the user not told | Three lines: the face, the colours, the shape |
| A default of the references kept over what the user said | The user's word |
| An admin table with roomy `56px` rows and illustrations | Technical: compact, no imagery |
| A learning app as dense and grey as an admin tool | Humanistic: open, warm, larger targets |
| A landing page built like a settings screen, one column of cards | Expressive: compose each section |
| A serif in interface text the user did not ask for | A sans; a serif for display headlines |
| Decoration added in the name of character: captions, badges, icons on every row | Remove it; character is not noise |
