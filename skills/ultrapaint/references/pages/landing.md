# Landing page

A product's public page, section by section. Its first two parts hold on every public page.

## Every public page

- **Sections** change by a band of a new surface or a gap; a hairline between them keeps
  `32–80px` clear each side. Or they are inset sheets: rounded panels (`20–40px`) inset one value,
  `8–24px`, from the viewport, padded `40–60px`, touching or `16–24px` apart.
- **Type:** section headings `36–56px`, card titles `17–28px`, feature body `16–20px`. Headlines
  in sentence case; uppercase display is a brand's choice. Uppercase mono carries eyebrows,
  indices, stat captions and legal lines.
- **A headline sets apart one thing or nothing:** a muted second line at the same size and weight
  (it replaces the subhead), one word in the accent or a serif italic, or a highlighter bar.
- **Imagery** runs through the page, or one strong hero picture and type after it: a real photo
  of the product, place, people or work; illustration only where nothing can be photographed or
  the brand draws. One set, one ratio, corner and treatment; toned to the page (a duotone in the
  ink, greyscale logos), or the page taking its colour from it. One image per section may cross an
  edge. A caption adds a place, date, credit, client or price, or is absent.
- **Photo hero:** a full-bleed photo or video under a bottom gradient scrim, white or cream type
  low-left where it is darkest, one small white or outline pill.
- **Header:** a top bar of text links, no icons, the main action repeated small at its right; no
  hamburger on a wide screen.

## Motion

Name the one thing that moves; by default nothing. Content shows at once, never behind an intro.
Smooth or scroll-linked scrolling only when the brief asks. Hover moves `transform` only on a card
or a pressed button. What moves on its own has a pause control.

- `Scroll into view · section blocks · opacity 0→1, translateY(20px)→0 · 700ms · cubic-bezier(0.23, 1, 0.32, 1) · 80ms apart, ≤6 steps, done in 500ms · once`. Size scales the move: an item `16px`/`400ms`, a block `24px`/`500ms`, a hero line `40px`/`800ms`.
- `Image loaded · image · opacity 0→1 · 400ms · cubic-bezier(0.4, 0, 0.2, 1)`, its space held.
- `Scroll down/up · header · translateY(-100%)↔0 · 300ms · cubic-bezier(0.23, 1, 0.32, 1)`; `past the hero · its background · opacity 0→1 · 200ms · ease`; it compacts by scaling the logo, never its height.
- `Always · logo row · translateX 0→-50% · 30000–90000ms · linear · paused off screen and under reduced motion`; one per screen, rows a few seconds apart, negative delays so it starts mid-cycle.
- `Tab active · progress bar · scaleX(0)→1 · the slide's time, 5000–8000ms · linear`, where tabs advance on their own.
- A technical page's one moving thing is often a scripted demo acting out the product: a press in
  `150ms`, a label rising `4px` in `300ms`, a cursor flying in over `700ms`.

## Hero

An announcement pill only with news; the headline, 2–4 lines; a muted `18–20px` subhead `16–24px`
below; the actions `24–40px` lower; at most one muted reassurance line; the visual or the logos.

- A filled primary beside a secondary of its height and shape (outline, grey or translucent fill,
  or a text link with an arrow); white on a dark ground; stacked full width on a phone, primary
  first. The header and the close repeat it: one action shown three times.
- An email capture fuses field and button in one row of one height, its label visible.
- Proof once, under the actions: stars and a count, an avatar stack and a number, or the logos.
- `Load · headline, subhead, actions · opacity 0→1, translateY(24px)→0, each later one shorter by 100ms and travelling less · 800ms · cubic-bezier(0.23, 1, 0.32, 1) · 150–200ms apart`; the header last or still; the action visible within `1s`.

## By character

- **Technical:** one centred column `1040–1300px`, sections `120–160px` apart, guides may frame
  it. The hero is a real screenshot wider than the text, on a soft gradient, an offset tinted slab
  or a glow at its top, fading at its foot or overhanging the band below; no bezel, no caption.
  On near-black, the accent is only light behind the screenshot, and cards sit a step lighter.
- **A serif on a product:** a free serif display (Instrument Serif, Newsreader, Source Serif 4,
  Fraunces) at `56–88px`, regular, over a small muted sans; the screenshots keep their sans.
- **Humanistic:** bands under the photo hero, a warm ground, panels inset `8–16px`.
- **Expressive:** composed (freeform, editorial columns, asymmetric bands), never a bento; the
  product may take the first screen; actions may be text links; no icons.

## Proof and features

- **Logos:** one row in one grey under the hero, no caption, or equal cells sharing `1px` rules.
  A customer story leads with its logo and a result ("+140%"); its sentence is the link.
- **Section header:** a `36–56px` headline over a 1–2-line muted lede, or headline left, lede
  right. A bold lead-in running into muted body can replace a card's title.
- **Split rows:** text `40–50%` wide, a real UI crop on a tinted slab beside it; sides alternate;
  a section step apart, no rules.
- **Bento:** tiles one tone off the page, no border, one near-black for rhythm; gutters `16px`,
  the large radius (about `24px`), padding `32px`; a title and one muted line top-left, a UI crop
  pinned to the foot bleeding off it, cropped to the moment (a status pill, a cursor on a
  button), the rest greyed to skeleton bars.
- **Without cards:** one `1px`-bordered box split by shared hairlines into 2–3 cells, a semibold
  title and two muted lines each; or 3–4 bare columns. No icon per cell.
- **Figures:** `40–64px`, regular or light, over a 2–3-line muted caption, no label or icon.

## Pricing

- 3–4 plans in one row, one height, buttons aligned. Each: name, one line, a large regular price
  with a small muted unit on its baseline, a billing note, a full-width button, "Everything in
  Pro, plus:", outline checks, quantities bold.
- The recommended plan is marked once: a tab on its top edge, the only dark card or the only
  filled button.
- Monthly / Annual as a segmented control, the saving inside or beside it; usage as a slider with
  labelled ticks; a discount strikes the old price above the new; "Current plan" is muted. A term
  with a tooltip takes a dotted underline.
- **Comparison:** hairline rows of one height that grow to wrap, no cell borders or stripes;
  labels left, plan columns equal and centred, names in a sticky header. Included a check; absent
  empty or a faint dash, a cross only against competitors. The recommended column is one band
  through every group, its checks inverted; category rows a filled band or a muted caption.

## FAQ, quotes, close, footer

- **FAQ:** a centred column about `720px`, or the title left and questions right. Questions
  `16–20px` medium, a plus or chevron far right; hairline rows, space alone, or
  filled cards `12–16px` apart; the open answer muted; a long list ends in "Show more".
- **Testimonials:** the quote is the headline, `20–48px`, display or serif; the name over the role
  at `13–16px`, muted.
- **Closing call:** a `44–72px` headline, an optional muted line, one button or the hero's pair,
  centred or with the button at the row's right; or the statement alone.
- **Footer,** padded `48px`: the logo alone at left; 3–6 even link columns; heads `11–13px` muted
  uppercase or mono; links `13–15px`, one style, no icons, about `32px` apart, wrapping; a legal
  row (copyright, policy links split by dots, social marks, a text language select) under a
  hairline or space. A dark band, an inset panel or the page's ground; a giant wordmark may close.

## Posts and help

- **Post grid:** no card: a rounded image of one ratio; "Category · Date" muted; a `17–24px`
  medium title of 2–3 lines; an optional 2-line muted excerpt; avatar, name, date. A wide split
  featured card above three columns. As a list: thumbnail left, hairlines `32px` clear, the row the
  link.
- **Help centre:** search is the hero, a pill about `640×64px`; articles as hairline rows with a
  chevron. Pricing, help and contact pages carry little imagery.

## Check

| You see | Fix |
| --- | --- |
| A technical hero without the product, or in a bezel on white | The real UI, staged, cropped or faded |
| A plan marked by a tab, a border and a colour | One mark |
| Images of one set in mixed crops or treatments | One ratio, corner and treatment |
| A glow or pattern behind several sections | One, behind the hero, or none |
| An "i" on every comparison row, an icon per feature cell | Remove them |
