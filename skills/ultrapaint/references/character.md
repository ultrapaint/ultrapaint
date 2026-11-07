# Character

How a product should feel, to whom, settled once when nothing says it yet: read off what exists,
or asked, then completed on seven dials and written down before the first screen.

## Read it off what exists

- **A product to read** (its code, its pages, pictures of it, a Figma file): its look is the
  character. Read it off as `references/system/extract.md` says, and write it down with its
  dials: the look sets every one.
- **A picture to remake**: the picture is the brief. Its warmth, radius, density and face are the
  character, over any default of this skill.
- **A request that already says it**: who it is for and how it should feel ("a calm journaling app
  for teenagers, like a paper notebook"). Complete the rest on the dials.

## When nothing says it, ask once

Ask the user one question, with a question tool if you have one, else in your reply, ending your
turn. Two options, in this order:

1. **Decide from my request**: you choose from what they asked for.
2. **I'll describe it**: who it is for, how it should feel, a product or an object it should feel
   like, a brand colour or a face they already have.

Every other decision is yours. When they describe it, their words beat every default here. When
they leave it to you, the job decides: a tool for operators and data is technical, one for
people's own lives is humanistic, a page that sells or tells a story is expressive.

## The dials

The user's words set some dials; a preset below sets the rest. Each dial ends on one choice.

| Dial | Choices | Words that set it |
| --- | --- | --- |
| Temperature | warm, neutral, cool | paper, cosy, friendly: warm; clinical, technical, icy: cool |
| Density | compact, regular, open | data, power users: compact; calm, beginners: open |
| Shape | sharp, soft, round | precise, serious: sharp; friendly, playful: round |
| Accent | restrained, lively, the brand's | quiet, focused: restrained; fun, energetic: lively |
| Type voice | neo-grotesque, geometric, humanist; a display face or a serif for headlines | editorial, literary: a serif for headlines |
| Imagery | none, icons, illustration, photography | |
| Tone | terse, warm, the brand's | |

A dial the user set beats this skill's taste defaults: a cool, clinical product gets blue-grey
neutrals, a literary one a serif. Contrast, the type floors, target sizes and restraint hold in
every character.

## Technical: admin, data, developer tools

- Dials: neutral, compact, sharp, restrained, neo-grotesque, no imagery, terse.
- Density: rows `32–40px`, navigation items `32–36px`, tables first.
- Type: a neo-grotesque sans; a mono for code, ids and figures that line up.
- Shape: radius `4–8px`; hairline borders; shadows only on menus and dialogs.
- Imagery: none. Icons small. Charts plain.
- Tone: terse, exact; the noun and the number.

## Humanistic: consumer, learning, health, games

- Dials: warm, open, round, lively, geometric or humanist, illustration, warm.
- Density: navigation items `40–48px` with larger icons; generous padding; one task per screen
  where it can be.
- Type: a friendly geometric or humanist sans, a step larger at every level.
- Shape: radius `12–20px`; soft fills rather than borders.
- Colour: warm neutrals, a livelier accent; categories in their own hues.
- Imagery: illustrations and photographs where they carry meaning: an empty state, a welcome, a
  reward. In games, celebration in motion and colour where something is won.
- Tone: warm, second person, encouraging; plain where something can go wrong.

## Expressive: brand sites, landing pages, portfolios

- Dials: the brand's temperature and accent, regular density, any shape, a display face,
  photography or illustration, the brand's tone.
- Layout: each section a new composition on one rhythm: full-bleed bands, asymmetric splits, a
  product visual that bleeds off the edge.
- Type: a display face may carry the headlines, a serif among them when the brand asks; interface
  text stays sans. One word of a headline may be set apart in a second weight, colour or face.
- Colour and imagery: the brand's, boldly: colour bands between sections, a hero visual,
  illustration, motion on arrival.
- Tone: the brand's voice, one clear promise per section.
- The primary action repeats where the page ends.

## Write it down before the first screen

Write DESIGN.md at the root of the repository while you work, its tokens in its front matter:

- **Overview**: who the product is for, the feel in the user's words, a named reference ("a
  printed lecture handout", not "clean and modern"), and the dials in one line ("warm · open ·
  round · lively · geometric · illustration · warm").
- **Tokens**: the values the dials chose, as `references/system/foundations.md` sets them.

Then tell the user in three lines what you chose (the face, the colours, the shape) so they can
correct it before much is drawn. A later decision (a new colour, a component's shape) goes into
DESIGN.md with the reason it was made.

## Check

| You see | Fix |
| --- | --- |
| A questionnaire put to the user | One question: decide from the request, or describe it |
| A character chosen and not in DESIGN.md | Its Overview and its tokens, before the next screen |
| An Overview without the dials in one line | One choice on each of the seven |
| A character chosen and the user not told | Three lines: the face, the colours, the shape |
| A default of this skill kept over what the user said | The user's word |
| An admin table with roomy `56px` rows and illustrations | Technical: compact, no imagery |
| A learning app as dense and grey as an admin tool | Humanistic: open, warm, larger targets |
| A landing page built like a settings screen, one column of cards | Expressive: compose each section |
