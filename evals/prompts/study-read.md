You are reading how a well-made {{kind}} is designed, so what such pages share, and what makes
some stand out, can be counted across thousands of them and taught to design agents. It was chosen
by people (a curated gallery, an award, a product's own screens, or a design system's example).
Look at every picture:

{{pictures}}

Motion the capture recorded on the live page: {{motion}}

{{pictureNote}} Colours are hex as they look in the picture. When something can't be seen, say
so (`"unseen"`, 0 or an empty list) rather than guess.

Never name the product, company or people in any field except `faceNames`; describe them by what
they are ("a payroll tool for small shops"). Never quote more than four words of the page's copy.

**What it is for**
- `capture`: `broken` when the pictures show a bot check, an error, a parked page or a page not
  drawn instead of the site; `obstructed` when the site shows but a dialog, banner or veil covers
  much of it; `ok` otherwise. `captureFaults`: what the capture did to the page, not the
  designer: a dialog or veil over it, content that appears only on scroll and shows as empty
  space, images not loaded, an animation caught midway, a page that lives in motion and that
  stills can't show. Never read a capture fault as the design: not as a colour, not as space,
  not as a weak point.
- `brief`: what the product is, who it is for, what this page must do for them (make them sign
  up, buy, trust, browse the work, find a setting), and what it has to show (product screens, the
  work, food, people, data, nothing but words). One short phrase each. This is what a designer
  would be told before designing it.
- `pageKind`: for a public page `landing`, `home`, `portfolio`, `editorial`, `shop`, `pricing`,
  `docs`, `event`, `about`, `other`; for an app screen `dashboard`, `table`, `list-detail`,
  `form`, `settings`, `editor`, `calendar`, `auth`, `onboarding`, `modal`, `empty-state`, `other`.
- `domain`: what the product is, whatever the page looks like: `technical` (a tool for
  operators, data, developers, designers at work), `humanistic` (for people's own lives:
  consumer, learning, health, food, travel, money), `culture` (a brand, a studio or portfolio,
  editorial, an event, a type foundry). `expression`: how the page looks, whatever the product:
  `restrained`, `balanced` or `expressive`. A design tool's showy launch page is `technical` and
  `expressive`. `genre`: two or three words.
- `mood`: two or three words for what the page makes you feel, and `moodHow`: the two or three
  choices that carry that feeling most (one line).
- `dials`: the page on the design skill's own dials, one choice each: `temperature` (`warm`,
  `neutral`, `cool`), `density` (`compact`, `regular`, `open`), `shape` (`sharp`, `soft`, `round`),
  `accent` (`restrained`, `lively`, `brand`), `typeVoice` (`neo-grotesque`, `geometric`,
  `humanist`, `display`, `serif`, `mono`), `imagery` (`none`, `icons`, `illustration`,
  `photography`, `product`, `type`), `tone` (`terse`, `warm`, `brand`).

**How it is seen**
- `hierarchy`: `first` (what the eye lands on first), `second`, `third`; `focalDevice` (what
  makes the first thing win: size, colour, isolation, an image, motion).
- `sections`: the sections from top to bottom as far as the pictures show, one entry each:
  `kind` from the lists below (or `other: <one word>`); `picture` (the file it shows best in) and
  `box` (x, y, width, height in fractions of that picture, the section's full extent there);
  `form`, how its content is laid out (`split`, `centred-stack`, `cards`, `bento`, `list`, `table`,
  `media-grid`, `carousel`, `full-bleed-media`, `text-only`, `logo-row`, `stats-row`, `form`,
  `accordion`, `tabs`, `timeline`, `columns`, `freeform`, `chrome`); `ground` (`page`,
  `surface`, `accent`, `dark`, `image`); `alignment` (`left`, `centred`, `mixed`); `note` (what
  sets it apart, or empty). Public pages: `nav`, `banner`, `hero`, `video`, `logos`, `features`, `product-shot`, `demo`,
  `testimonial`, `stats`, `pricing`, `comparison`, `faq`, `work-grid`, `work-list`, `story`,
  `statement`, `team`, `process`, `news`, `gallery`, `contact`, `newsletter`, `cta`, `footer`.
  App screens, their regions: `sidebar`, `top-bar`, `page-header`, `tabs`, `filters`, `toolbar`,
  `subnav`, `stat-tiles`, `chart`, `table`, `list`, `detail-panel`, `form`, `cards`, `calendar`,
  `canvas`, `empty-state`, `dialog`, `pagination`.
- `layout`: `structure` (`single-column`, `split`, `asymmetric`, `grid`, `bento`,
  `full-bleed-bands`, `editorial-columns`, `freeform`, `app-shell`), `columns` (of the main grid),
  `gutter` (px), `contentWidth` (px), `alignment` (`left`, `centred`, `mixed`), `hero` (public
  pages: `text-only`, `text-and-visual`, `full-bleed-image`, `full-bleed-video-or-3d`,
  `illustration`, `product-screenshot`, `none`).

**The system**
- `type`: `headingFace`, `bodyFace` (`neo-grotesque`, `geometric`, `humanist`,
  `grotesque-display`, `serif-display`, `serif-text`, `slab`, `mono`, `script`, `condensed`,
  `other`), `faceNames` (when recognisable), `sizes` in px (`display`, `heading`, `body`, `small`),
  `bodyLineHeight` (a ratio), `measure` (characters in a line of body text), `weights` (those
  seen), `tracking` (`tight`, `normal`, `wide`, of the largest text), `headingCase`, `accent`
  (how a word is set apart in a headline, or `none`).
- `color`: `theme` (`light`, `dark`, `mixed`), `background`, `surface` (a second ground: cards,
  bands, panels), `text` (running text), `mutedText` (the grey of descriptions, captions and
  timestamps), `border` (hex, or `none`), `accents` (each hex with what it
  marks); `neutrals` (`warm`, `neutral`, `cool`) and `neutralsToAccent` (how the greys relate to
  the accent: tinted toward it, toward its opposite, untinted); `borderStrength` (`none`,
  `faint`, `visible`, `strong`); `gradients`; `colorsFromImagery` (true when the photos or work
  carry most of the colour).
- `surfaces`: how areas are set apart (any of `space`, `rules`, `borders`, `fills`, `shadows`,
  `images`), `elevation` (distinct levels of lift seen), `radius` (`small` and `large`, px).
- `spacing`: `density` (`airy`, `balanced`, `dense`), `sectionGap`, `cardPadding`, `gap` (between
  items in a group), in px.
- `imagery`: `kinds` (any of `photo`, `illustration-flat`, `illustration-3d`,
  `illustration-hand`, `product-ui`, `abstract-shapes`, `pattern`, `video-still`, `type-only`),
  `subjects` (any of `people`, `product`, `place`, `food`, `objects`, `work`, `data`, `abstract`,
  `none`), `role` (`hero-only`, `throughout`, `decorative`, `none`), `treatment` (how pictures are
  cropped, framed, masked or coloured, one line).
- `icons`: `style` (`none`, `outline`, `filled`, `duotone`, `illustrated`), `size` (px),
  `use` (a few words).
- `components`: `buttons` (`pill`, `rounded`, `square`, `text-link`), `buttonStyle` (`filled`,
  `outline`, `ghost`, `mixed`), `buttonHeight` (px), `nav` (`top-bar`, `minimal`, `hamburger`,
  `sidebar`, `none`), `cards` (`border`, `shadow`, `fill`, `none`), `inputs` (how a field is
  drawn, or `unseen`), `brandMark` (`wordmark`, `symbol-and-wordmark`, `symbol`, `boxed`,
  `unseen`: `boxed` when the mark sits in a filled tile).

**The words**
- `words`: `headlineWords`, `headlineForm` (`claim`, `question`, `imperative`, `name`,
  `manifesto`, `none`), `voice` (two or three words: plain, deadpan, warm, technical, lyrical…),
  `ctaVerbs` (the kind of verbs on the calls to action: "start, try", "book", "see the work"),
  `ctas` (calls to action on the first screen), `eyebrow` (true when a small label sits over a
  heading).

- `tells`: true for each mark the page has anywhere: `eyebrow` (a small label over a heading that
  says nothing the heading doesn't), `numberedSections` ("01", "02" over sections that are not
  a sequence), `gradientText`, `iconTiles` (an icon in a tinted tile over each card's heading),
  `sideStripe` (a coloured border on one side of a card), `glow` (a coloured glow as a shadow),
  `borderAndShadow` (a hairline border with a wide soft shadow), `stockPhrases` (stock marketing
  phrases or "Not X. Y." cadence). These are counted, never judged here.

**Beyond the first screen**
- `mobile` (public pages): `changes`, how the first screen changes at 390px (what stacks, hides,
  shrinks or moves); `mobileHeadline` (px); `mobileNav` (`hamburger`, `visible-links`,
  `bottom-bar`, `none`, `unseen`).
- `motion`: `level` (`none`, `subtle`, `rich`), `kinds` (any of `scroll-reveal`, `smooth-scroll`,
  `marquee`, `parallax`, `3d`, `video`, `hover`, `page-transition`, `cursor`), from the recorded
  motion and what the stills show.

**App screens only** (`app`, null for a public page)
- `staging`: how the shot is presented around the app (`none`, `backdrop`, `device-frame`,
  `cropped-window`, `collage`). The staging is the shot's, not the app's: it is never a move.
- `shell`: where navigation sits and its width (px); `primaryAction`: where the main action is
  and how it looks; `rowHeight` (px of a table or list row, 0 when none); `rowsVisible`;
  `tableStyle` (dividers, zebra, header style, or `none`); `formLayout` (labels above, beside,
  inside, or `none`); `dataDisplay` (stat tiles, charts and their kind, or `none`); `states`
  (selected, hover, empty, loading, error states that show).

**What stands out, and what is weak**
- `moves`: the devices that would make this page stand out among hundreds of well-made pages,
  that catch attention or carry its mood. Most pages have one or none; three is rare. What most
  pages of its kind do is not a move (a top bar, a centred hero, three feature cards, status
  pills in a table, a now-line on a calendar), and neither is how a shot is staged. Each: a
  generic `name`; `dimension` (`layout`, `type`, `colour`, `imagery`, `words`, `navigation`,
  `components`, `interaction`, `texture`); `section` (its number in `sections`, from 1); `what`
  (one or two concrete sentences with sizes and placement); `why` (what it does for this brief and
  mood); `picture` (its file name); `box` (x, y, width, height in fractions of that picture). Zero
  is a fine answer.
- `weaknesses`: what the designer did less well than the rest (a contrast, an alignment, a
  crowded spot, an inconsistency), zero to three, each with `what` (one concrete line), `section`
  (its number, 0 for the whole page) and `dimension` (as for moves). Never a capture fault. Many
  pages have none.
- `craft`: how well made the page is, `1` (visible faults), `2` (sound), `3` (finished: every
  alignment, size and state holds), and `craftWhy` in one line.
- `observations`: up to three patterns worth teaching that no answer above holds, one line each.
  None is a fine answer.
