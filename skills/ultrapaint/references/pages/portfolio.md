# Portfolio, studio, agency

A person's or a studio's work shown as the page: expressive, composed, mostly type and images.
What every public page shares (sections, imagery, motion) is in `references/pages/landing.md`.

## Two poles

A portfolio picks one and keeps to it; the middle reads as a template.

- **A giant name:** the name or wordmark set edge to edge, `150–400px`, tight, regular or bold,
  uppercase or title case; a render or photo may overlap the letters. Everything else is
  `11–14px` labels pinned to the corners (role, city, a live local time, contact) at one even
  inset of `14–30px`. Two to four sizes, nothing between giant and tiny.
- **One small size:** everything at `13–15px`; rank by position and space alone.

## The first screen

- **The work is the hero:** no headline, or a one-sentence bio in its place.
- **Or a statement:** one paragraph of `17–35` words at `36–58px`, regular, tight leading; one
  phrase may switch to a serif italic. No subhead, no eyebrow, at most one quiet action (a text
  link, or an underlined email field).
- **Or one fixed scene:** a 3D render or a product in front of edge-to-edge type, image and
  headline composed as one; or a full-bleed reel behind a small headline set low.
- A page of type alone is complete as it is; a stock picture added to fill it is noise.

## The work

- **Grid:** tiles edge to edge with `2–8px` gutters, in a masonry, a contact sheet or a sideways
  strip, mixed sizes; a tiny mono caption (client, year) or none.
- **Index:** a hairline table, one row per project: the year muted, the title in the foreground,
  the client muted, an arrow at the right; the whole row is the link.

## Navigation and actions

- Three or four words at the corners or spread across the top, or one comma-separated line, or a
  "Menu" word. The current page: full ink against muted, an underline or an outline pill.
- No buttons. Actions are words: an underlined link with a typographic arrow ("↳ All work",
  "Project ↗"), a bracketed label ("[ See all ]"), a word for a control ("Menu", "Sound off").
- Icons: none, apart from a close on a dialog, a two-line hamburger, a social mark.

## Colour

- **Monochrome gallery:** white, warm off-white or pure black; near-black or off-white ink, muted
  for captions, client names and inactive links; no interface hue at all.
- **Flood:** the whole page in one saturated hue, type black or white by computed contrast;
  buttons an outline pill or one inverted fill; no second accent, no gradient; a section changes
  to the next flat band.
- Pure black is a stage here, not a dark theme.

## Space

Airy. One screen with no section gap, or work bands `140–300px` apart. A manifesto puts
`300–700px` between its statements; a full-screen band holding one short paragraph is a pause.

## Motion

Many expressive pages move nothing; type can carry the page.

- `Scroll into view · display headline words · translateY(105%)→0 inside overflow: hidden · 1000ms · cubic-bezier(0.23, 1, 0.32, 1) · 20ms apart (lines 30–150ms)`; one display headline per screen, never body text.
- `Scroll into view · image · clip-path inset(0 100% 0 0)→inset(0) · 900–1200ms · cubic-bezier(0.76, 0, 0.24, 1)`; or `inset(40% 0 0)` to open from below.
- `Section enters · page background and text colour · cross-fade · 300–600ms · ease`; the section rethemes as it passes.
- Images fade as they load (the image recipe), no movement.

## Check

| You see | Fix |
| --- | --- |
| A "Get started" button or a filled call to action | Words: an underlined link with an arrow |
| Captions naming what each piece shows | The client and year, or nothing |
| Sizes between the giant name and the small labels | Giant and small only |
| A bento of cards, or every section boxed | Compose: freeform, columns, asymmetric bands |
| An accent in the chrome beside colourful work | Monochrome chrome |
| Body text split into words that fade in | Still body; only the display headline moves |
