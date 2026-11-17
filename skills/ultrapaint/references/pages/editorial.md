# Editorial page

A magazine, a news front, a blog, a long article: pages to read, built from rules and type rather
than boxes. What every public page shares (sections, imagery, the header) is in
`references/pages/landing.md`.

Open with it, before the first element: `references/layout.md`, `references/typography.md`.

## The front page

- A masthead, then three columns of unequal width: the lead story about two-thirds wide (or
  centred) with a large image; a narrow rail of headlines split by hairlines; a column led by
  thumbnails.
- Columns are divided by vertical hairlines, stories by horizontal rules: no cards, no padding.
- A full-width light-grey band separates one section from the next; section titles are small,
  set between rules.
- Open: sections `64–160px` apart, about `120px`; only a news front with many stories closes the
  step.
- A magazine's or a blog's opening headline (its title, or one feature alone on the first screen):
  **Technical** `76px`, about `4` words; **expressive** `120px`, about `3` words. A news front
  opens on its lead story instead, at the story stack's sizes.
- No buttons on the stories: their headlines are the links.
- Controls and the page's one action: **Technical** a filled pill or rounded button `34px` high,
  corners `5px`; **expressive** a text link, every corner square.

## The story stack

Every story takes the same stack, at every size:

- **Kicker:** `11px` uppercase sans or mono, often in the one accent: the category, sometimes a
  format glyph before it.
- **Headline:** the display face, a serif or a tight grotesque or condensed sans; the lead at
  `40–50px`, secondary stories `24–34px`, rail items at body size. About `8–12` words.
- **Dek:** one muted line, serif or sans.
- **Byline:** `11px` tracked uppercase, muted, after an italic "By".
- Headlines and display type tracked tight (`-0.01em` to `-0.03em`), tighter as they grow; only
  the small uppercase kicker and byline are tracked out.

## Images

- Uniform crops (`3:2` or square) with square corners, one ratio per row.
- A format badge (a filled play or headphones mark on the thumbnail, or a tiny outline glyph
  before the kicker) only on stories whose format differs from a plain article.
- Photographs bring the colour; the interface keeps one ink accent.

## Colour

A white or cream ground; one ink accent reserved for one job (the masthead, the kickers or the
bylines): coral, yellow, purple, crimson, orange. A blog may run a single ink on cream.

## The article

- One column; the headline in the display serif.
- Reading text in the product's sans, or in a text serif where the publication's system has one
  or the user asks.
- Reading text `17–20px`, line height `1.4–1.5`, `50–70` characters a line.
- A drop cap may open it. Links are underlined in the text's own ink.
- Search and account sit in the masthead; a share rail beside the article is the one other place
  icons go.

## Motion

What people read stays still: the front and the article move only their chrome (the header
recipe) and their images as they load. Text is never split into fading words.

## Examples by character

**Technical**
- A `76px` neo-grotesque headline of four words, left, on white; `5px` corners on controls; a
  filled pill `34px` high; an abstract illustration to its right; the stories below set apart by
  hairline rules.
- A `60px` serif headline of six words on a dark ground; `10px` corners on one bordered panel; a
  filled rounded button beside a text link; a product screen in that panel; the lead set apart by
  space alone.

**Humanistic**
- A `46px` serif headline of seven words, left, on warm white; `8px` corners; a filled pill `44px`
  high; a photograph beside it; the stories below set apart by light fills.
- A `40px` neo-grotesque headline of five words on white; square corners; a filled square button
  `44px` high and a text link; no image; the latest stories set apart by hairline rules.

**Expressive**
- A `120px` serif headline of three words, centred, on cream; square corners; one text link as the
  action; a full-bleed photograph below; the next section set apart by a light-grey band.
- A `140px` condensed sans headline of two words on a dark ground; square corners; no action; no
  image, the type alone; the rail of headlines beneath set apart by vertical hairlines.

## Check

| You see | Fix |
| --- | --- |
| Stories in cards or boxes | Hairline rules between stories, vertical rules between columns |
| Kickers, headlines or bylines differing from story to story | One stack for every story |
| Crops and corners mixed in a row | One ratio, square corners |
| A format badge on every card | Only where the format differs |
| A "Read more" button under a headline | The headline is the link |
| The accent on kickers, bylines and the masthead at once | One job for the accent |
