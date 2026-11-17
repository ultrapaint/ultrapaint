# Shop and hospitality

A shop, a food or beauty brand, a restaurant, a bar, a hotel: a humanistic page of photographs
and bands. What every public page shares (sections, imagery, the photo hero, motion) is in
`references/pages/landing.md`.

Open with it, before the first element: `references/layout.md`, `references/typography.md`,
`references/color.md`.

## The page

- Full-bleed bands under a photograph; the hero centred, the sections left-aligned.
- **Between sections:** **Humanistic** `64–100px`; **expressive** `100–160px`.
- **Hero:** the photo hero, or 50/50: a flat brand-colour text panel beside a full-height warm
  photo bleeding to the right edge. Below it, 50/50 bands of a photo and a flat colour panel
  alternate sides.
- **Header:** a centred wordmark with the links split either side, or at left, in tiny widely
  tracked capitals (`11–13px`); icon-only outline search, account and bag at right, the bag's count
  a small circle or "[0]". An expressive shop keeps search and the bag.
- **Header icons:** search, account and bag in outline, the same stroke as the wordmark's weight.
  **Humanistic** `20px`; **expressive** `16px`.
- **Trust** ("Free shipping · Easy returns") runs as one line or a slow marquee, never a row of
  icons. Social proof is optional. If present, it is one line under the call to action (stars
  with a count, or one press quote), never a logo wall or a testimonial band.
- No email modal over the hero on load. An offer, if any, states one offer and holds one field.

## Type

- **Headline:** often just the product, range or brand name; a claim only if it says something
  specific. **Humanistic** `3–5` words; **expressive** `2–4`, most often the name.
- **Display:** a serif, regular or light, tight; the second line or one word in the same serif's
  italic. **Humanistic** `48–80px`; **expressive** `64–120px`.
- **Body** and everything a shopper reads to act: a neo-grotesque or geometric sans.
- **Body size:** `15–17px`, line-height `1.4–1.5`, in a narrow measure of `40–60` characters.
- **Small text:** buttons and product meta at `11–12px` uppercase, tracked `0.1em`.

## Colour

- A warm ground (cream, sand, blush, sage); the ink often a deep brand hue (navy, forest,
  olive-brown, aubergine) that computes to `15:1`.
- **One-ink page:** one deep hue carries every heading, line, rule and outline button, with at
  most one filled button in it; the photographs bring every other colour. Single-ink pages slide to
  medium contrast: darken the ink until it computes rather than adding black.
- **Categories:** each flavour, range or collection keeps its own hue, the same on every tile.
- The accent may be lifted from the photographs (an orange from the sofa in the hero).
- **Flood:** a band or a whole page in the product's own colour, type black or white by computed
  contrast.

## Products

- **Tile:** no border, no shadow; the product cut out on the page's tint or a pale grey fill, so
  the grid reads as one surface; the name and price under it on one row. Gutters `16–24px`.
- **Grid and fill:** **Humanistic** `4` columns, the product `12–16px` inside its fill;
  **expressive** `3` columns, the product edge to edge, `0` in.
- **Badge:** one, only when it says something ("Bestseller", "Limited"), in the same corner of
  every image; an outline heart at the top right; filled stars with a count under the name.
- **Sale:** the struck-through original beside the price.
- **Buttons** often run square, `0px`, with tiny uppercase tracked labels: one filled (dark on
  cream, white on a photo), every other action an underlined text link, or a hairline outline where
  it must look like a button.
- **Carousels:** circular outline arrows; the next tile peeking.
- **Frames:** square. **Humanistic** radius `0–4px`; **expressive** `0`. A shaped frame (an arch,
  a pill, a matted print) is optional; if you use one, use only that one and repeat it down the
  page.

## Imagery

Warm natural light: people, hands, rooms, food, grain allowed; cool stock photography reads wrong.
Hand-drawn marks (an underline, an arrow, a mascot) go beside photographs, never instead. A row of
values or steps may be one illustrated set in one hand; it replaces the line icons for that row,
while search, bag and close stay in the line set.

## Restaurant, bar, hotel

Set like a printed menu, on one ink and one ground (olive on cream, cream on ochre, deep teal,
gold on near-black).

- **Headline:** usually the name; uppercase, a condensed sans at `56–110px` or a high-contrast
  serif at `40–60px`. One action: "Reserve" or "Book a table".
- **Practical details:** hours, address and phone in `12–13px` letterspaced small capitals,
  centred; dot leaders on the hours table.
- **Menu:** type, never a picture: the dish left, the price right-aligned on its row, hairlines
  between groups.
- **Photos:** dark, warm, low-key, one per band at near-full width, in rounded or inset frames
  with an even gutter (about `16px` gutter, `18px` radius) or a `14–20px` mat.
- **Rhythm:** airy; photo bands `110–160px` apart, unpadded; text in a narrow centred column
  between them. Corner labels on a single screen sit `14–30px` in.
- **Icons:** none or one (a pin before the address, a download arrow beside the menu PDF, the
  close of the booking dialog). Navigation is words.

## Motion

Entrances are a plain fade or a `16–40px` fade-rise, `600–1000ms`. The chrome carries the rest:
the header recipe and carousels sliding in `300ms`. Life comes from
slow loops in an illustration, never from entrances:
`Always · illustration layers · translateX drift · 20000–90000ms each · linear · negative delays, paused under reduced motion`.
Celebration plays where something happens (an order placed), never on arrival.

## Examples by character

- **Humanistic:** a 50/50 hero, a flat sage panel at left holding a four-word serif headline at
  `72px`, the last word italic, a warm full-height photograph bleeding right; corners `0`; one
  square filled button `44px` tall in the deep ink; trust as one line under it; header icons `20px`
  outline.
- **Humanistic:** a full-bleed warm photograph with a three-word claim centred at `56px` in white
  serif; one pill button white on the photo, a second action an underlined text link; below, a cream
  band of four tiles on a pale fill, `4px` corners, the product `14px` in, set apart by fills.
- **Expressive:** a two-word name at `120px` in a tight serif across a full-bleed photograph,
  white on it; corners `0`; no filled button, one underlined text link; a minimal header with
  `16px` outline icons; nothing set apart but the photograph's edge.
- **Expressive:** type only on a white ground: a two-word name at `96px` in a grotesque display,
  left-aligned, no image on the first screen; one ghost text link; below it a three-column grid of
  cut-out products edge to edge, `20px` gutters, corners `0`, set apart by space alone.

## Check

| You see | Fix |
| --- | --- |
| Product tiles in bordered or shadowed cards | The product on the page's tint, name and price under it |
| Two badges on a tile, or badges in different corners | One, in the same corner on every tile |
| A menu or price list as an image | Hairline rows, the price right-aligned |
| A shop with no photographs of its products, places or people | Real photographs, through the page |
| Trust claims as a row of icons | One line or a slow marquee |
| An accent fighting colourful photographs | Neutral or one-ink chrome |
