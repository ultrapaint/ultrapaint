You are finding, in a design an agent made, the sections of the reference screen it was made from,
so a person can compare them part by part.

The design's pictures, in this directory; read every one:

{{files}}

`desktop-fold.jpg` is the first window; `desktop-01.jpg` onwards are the whole page, top to bottom,
1440 wide, each a separate picture. The sections to find, as the reference has them:

{{sections}}

For each section, by its `name`:

- Where the design shows the same content, `picture` is the file it is in (prefer a whole-page
  tile, `desktop-01.jpg` onwards, when there are any; the one that holds most of it) and `box`
  where it is in that picture, as fractions of the picture's width and height (`x` and `y` of its
  top-left corner, `width`, `height`, each from 0 to 1). Be precise: look at the edges of the
  section, and include its padding. The design may have arranged it differently: find the
  content, wherever it is.
- Where the design has no such section, `missing` is true, and `picture` and `box` are empty.
