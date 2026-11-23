# Typography

Choosing a face and loading it, the type of a public page, and the few text details a screen's
text styles leave open.

## Choosing a face

The type voice of the character picks it when the product has none:

- **Technical**: a neo-grotesque, Inter or a face like it (Inter Display for display sizes), or
  Geist. A mono only for code: a code block, a command, a key or a token the reader copies. Ids,
  times, figures, labels, tabs, buttons, captions and table cells stay in the sans, its tabular
  figures where numbers line up in a column. A public page whose chosen move sets mono labels or
  captions keeps them (`references/moves.md`).
- **Humanistic**: a friendly geometric or humanist sans for the interface (DM Sans, Figtree,
  Inter); headlines may take a serif display or a friendly display face over that plain sans body.
- **Expressive**: the brand's face. Headings range from a neo-grotesque to a serif display, a
  grotesque display or a condensed face; the body stays a sans unless the page is for long
  reading.

One family, two at most. A text serif is for long-form editorial reading only. Under a serif
display headline the product's own screenshots keep their sans.

A face is free (SIL Open Font License, as on Google Fonts and Fontsource) or paid. A paid face is
used only where the product already loads it or the user holds its licence; otherwise take the
nearest free face of the same geometry, x-height and width and tell the user which. Free serifs
for display: Instrument Serif, Newsreader, Source Serif 4, Fraunces.

## Loading it

Name the face in the tokens and load it in the stylesheet (Google Fonts, Fontsource, the foundry's
CSS, or the framework's font loader), every weight the text styles use, with
`font-display: swap` and a fallback stack of the same kind after it (`ui-sans-serif,
system-ui, sans-serif`). Check that the face renders, not only that it is named. Fields stay `16px` on phones, or iOS zooms
the page. Weights under `300` are for display sizes, `28px` and up.

## A public page's type

- **The hero**: one size, by character: **technical** about `64px`, **humanistic** about `76px`,
  **expressive** `90–140px`; on a phone about half, `36–44px`. Weight by character: **technical** `600`, **humanistic** `500`, **expressive** `800`; a brand set light and friendly keeps `400–500`; heavier where the brand's own wordmark is; tracked `-0.02em` to `-0.03em`; sentence case. Uppercase headlines are a character's
  choice (a restaurant, a brand page), not a default.
- **Sizes**: about five across the page; everything but the hero is plainly smaller, so the
  headline carries the rank alone.
- **The subhead**: one line in muted, `18–20px` under the hero's headline, `16–18px` under a
  section's heading.
- **Small labels**: `11–12px` uppercase, tracked `0.05em` in a technical sans, `0.1em` and up
  for a humanistic or brand page. Wide tracking belongs to small capitals and spaced wordmarks,
  never to a running headline.
- **One device in a headline, or none**: the second sentence in muted at the same size and
  weight; one word in the italic of the same serif; one word in the accent; a highlighter bar.
- **No eyebrow** by default: no small uppercase label above a heading. One stays only when it
  states a fact the heading cannot: a step in a sequence, a date, a story's category, a release.

## Details in running text

- A link inside a sentence stays in it, at its weight, underlined, in the foreground or muted;
  the accent in bold reads as a button.
- A placeholder is muted and shows an example, never a real value (a default, a fallback): one set
  in the foreground or holding a value makes the field look filled.
- An inline edit takes the text's own style and place, so nothing moves when it opens.
- A price is a large figure at regular weight beside a small muted unit; an old price sits above
  it, struck through, muted, at about half its size.

## Check

| You see | Fix |
| --- | --- |
| A face named in the tokens and not loaded, or rendered in the fallback | Load it, or the nearest free face, and say which |
| A paid face the product does not load and the user holds no licence for | The nearest free face of its kind |
| Three or more families | One, two at most |
| The mono on anything but code: a heading, body, an id, a time, a figure, a label, a tab, a button, a cell | The sans, tabular figures in a column; the mono for code and what is copied as code, or where a public page chose a move that sets it (`references/moves.md`) |
| A public page with two hero sizes | One hero size; the rest plainly smaller |
| A headline with two or more accents | One, or none |
| A small uppercase label above a heading | Remove it, unless it states a fact the heading cannot |
| A running headline tracked wide | Tight; wide tracking only for small capitals |
| A headline tracked tighter than `-0.03em`, its word spaces closing | `-0.02em` to `-0.03em` |
| A link bold, in the accent, or on its own line after its sentence | In the sentence, at its weight, underlined |
| A placeholder in the foreground, or showing a real value | Muted, an example |
| An inline edit that moves the text or changes its weight | The field takes the text's style and place |
