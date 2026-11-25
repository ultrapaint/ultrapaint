# ADR 0149: A fill layers images

Status: accepted, 2026-11-25. Amends 0134 (a fill holding an image was one layer kept as
written) and 0016 (the Figma import dropped an image fill on a frame with children, with a
warning). Follows 0015, 0024, 0036, 0061, 0102 and 0114. Story: UP-148.

## Context

A designer could not put a picture behind a box's content: the only picture the inspector made
was an image node, which holds no children. The document already allowed it, since `fill` is any
CSS background, but the Fill section's layers (0134) read a fill with an image in it as one row
kept as written, the canvas found an `assets/…` file only for an image node's `src`, the
off-system check flagged a picture as a raw colour, and the Figma import dropped the picture.

## Decision

- **The document keeps the string** (0015). An image is one more kind of layer of design-document's
  `fill` codec: its **file** (`src`, a path in the canvas such as `assets/hero.png`, or a URL, as
  its `url()` holds it) and its **fit**, cover, contain or fill, as an image node's `fit` says. It
  is written centred and drawn once, `url(assets/hero.png) center / cover no-repeat`, fill's
  size `100% 100%`, the file quoted only where it must be, with CSS's escapes. It is read in any
  order of those words, the centre as `center` or `50% 50%`, and `no-repeat` may be left out at
  cover and fill, where a picture is drawn once anyway; a `url()` with nothing after it is an image
  with no fit,
  CSS's default (its own size, tiled), written back as it was. Any other place, size or repeat
  keeps the whole fill one layer kept as written: a tiled or placed picture is no fit the editor
  offers.
- **The canvas** draws a fill's every `url()` from where the frame finds an image node's `src`
  (`resolveFillUrls` with the frame's `assetUrl`, preview-core's `assetUrlOf`): the canvas's own
  assets, else the shared ones. The inspector's swatches draw it from the same address.
- **On the system** (0061): an image is no colour, so it is never flagged; a fill's colour layers
  and stops are each checked as before. A file's path is never read as a token (0134).
- **The code** (0024): a fill whose one image is alone or over a colour is Tailwind's own
  utilities: `bg-[url(…)]`, then at a fit `bg-center`, `bg-cover`, `bg-contain` or
  `bg-size-[100%_100%]`, and `bg-no-repeat`, the colour under it its `bg-` utility; each sets a
  part of the background of its own, so a breakpoint's fill bounds the base's. A space in the path
  is `%20`, as Tailwind keeps an underscore inside a `url()`. An image among other images is the
  `background` shorthand, `[background:…]`, which alone says each layer's size, place and repeat.
  The code rules tell an agent to copy a fill's `assets/…` file as it copies an image node's.
- **The inspector** (0102): the layer popover's Kind is Colour, Gradient or Image. An image's
  popover holds its File (the path typed, or a file uploaded into the canvas's assets through
  `assets.upload`, as the Image section does) and its Fit. Kind → Image makes a layer of the grey
  picture a new image node starts with, at Cover, for the file to be chosen; an image turned into
  a colour is `transparent`, into a gradient a gradient of `transparent`. Its row's swatch covers
  it with the picture whatever its fit; it shows no off-system dot. Every change is one edit
  through the fill's field, at the view's breakpoint (0036) and on an instance's layer as its
  override (0114).
- **The Figma import** (0016): a frame with children whose paints hold an image, the frame
  imported as the page and an expanded instance's included, brings every visible paint as a layer
  of its fill, the top one first, so a wash laid over a photo stays over
  it: the image at its fit (Figma's Fill is cover, Fit contain, Stretch fill, Tile no fit, any
  other cover), its file saved as an image node's is, a colour and a gradient as 0134 reads them.
  No warning, but for an image paint Figma draws see-through, which a fill cannot say: it is drawn
  opaque, with a warning. A free-layout frame, whose one child the page holds, draws its picture
  once, on that child, the page taking only the colour under it. A frame without children with an
  image paint is still an image node, and one whose
  children are all shapes, drawn as one picture, still drops its image paint with a warning.
- **The document format's** description of `fill` says it may layer images, by their
  `assets/…` path.

## Consequences

- No page changes: a fill the editor showed as one row because it held an image now opens as
  layers, and nothing is written until a layer is edited.
- Only an image's file, centred and once at a fit, is offered. Tiling, a place off the centre and
  blend modes stay CSS an agent can write, read as one layer kept as written.
- A system component's look and the canvas's page defaults keep colour fields (0134).
- Contrast is not checked over a picture: the contrast check already stops at a background image.
