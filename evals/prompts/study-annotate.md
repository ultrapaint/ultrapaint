You are cataloguing how well-made websites are designed, so their patterns can be counted across
thousands of pages and taught to design agents. Every site here was chosen by people (a curated
gallery or an award). For each site you see two slices of its desktop page at 1440 px wide (its
first screen, `slice-1.jpg`, and one from further down, `slice-2.jpg`). Look at every picture
named below.

{{sites}}

For each site, by its `key`, answer what the pictures show, as exactly as they allow. Sizes are
in pixels at 1440 wide, estimated.

- `capture`: `broken` when the pictures show a bot check, an error, a maintenance or parked page,
  or a page that has not drawn, instead of the site; `ok` otherwise.
- `character`: `technical` (a tool for operators, data, developers), `humanistic` (for people's
  own lives: consumer, learning, health, games, food, travel), or `expressive` (a brand, a
  portfolio, an editorial or creative site). `genre`: two or three words ("portfolio", "game",
  "fintech app", "restaurant").
- `layout`: `structure` (`single-column`, `split`, `asymmetric`, `grid`, `bento`, `full-bleed-bands`,
  `editorial-columns`, `freeform`), `hero` (`text-only`, `text-and-visual`, `full-bleed-image`,
  `full-bleed-video-or-3d`, `illustration`, `product-screenshot`, `none`), `contentWidth` (the main
  column's width in px), `alignment` (`left`, `centred`, `mixed`).
- `typography`: `headingFace` and `bodyFace` (`neo-grotesque`, `geometric`, `humanist`,
  `grotesque-display`, `serif-display`, `serif-text`, `slab`, `mono`, `script`, `condensed`,
  `other`), `faces` (the names when recognisable), `headingSize` (px), `headingWeight` (`light`,
  `regular`, `medium`, `bold`, `black`), `tracking` (`tight`, `normal`, `wide`), `headingCase`
  (`sentence`, `title`, `upper`), `accent` (how a word is set apart in a headline, or `none`),
  `sizes` (distinct text sizes seen).
- `color`: `background` (`white`, `light-tint`, `dark`, `black`, `colorful`, `image`), `palette`
  (number of distinct hues beyond neutrals), `accentUse` (what the accent marks, in a few words),
  `gradients` (true or false), `textContrast` (`high`, `medium`, `low`).
- `spacing`: `density` (`airy`, `balanced`, `dense`), `sectionGap` (px between sections),
  `padding` (px inside cards or panels, 0 when none).
- `imagery`: `kinds` (any of `photo`, `illustration-flat`, `illustration-3d`, `illustration-hand`,
  `product-ui`, `abstract-shapes`, `pattern`, `video-still`, `none`), `role` (`hero-only`,
  `throughout`, `decorative`, `none`), `style` (one line: how it is drawn and coloured).
- `icons`: `style` (`none`, `outline`, `filled`, `duotone`, `illustrated`), `use` (where icons go,
  in a few words).
- `components`: `buttons` (`pill`, `rounded`, `square`, `text-link`), `buttonStyle` (`filled`,
  `outline`, `ghost`, `mixed`), `cards` (`border`, `shadow`, `fill`, `none`), `nav` (`top-bar`,
  `minimal`, `hamburger`, `sidebar`, `none`), `radius` (px of the main components).
- `content`: `headlineWords`, `subheadWords` (0 when none), `eyebrow` (true or false), `ctas`
  (calls to action on the first screen).
- `observations`: three to five patterns worth teaching that the fields above miss, each one line,
  concrete ("the headline's second line is a serif italic in the accent colour").
