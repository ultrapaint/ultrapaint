You are dividing a screen into the sections a designer would critique one at a time, so a person
can compare each of them with other designs of the same screen, part by part.

The screen: {{name}}, a {{kind}}. Its pictures, in this directory; read every one:

{{files}}

`*-fold.jpg` is the screen; `zoom-*.jpg` are parts of it enlarged, only to read it. A shot from a
gallery may sit on a backdrop, in a window or on a device: the sections are the screen's, never
the backdrop.

Name 3 to 8 sections: the navigation (a sidebar, a top bar), the page's header (its title and
controls), and each block of content (a group of key figures, a chart, a table, a form, a grid of
cards, a hero, a quote, a footer). Each is one rectangle, they barely overlap, and together they
cover the screen's content. A block too small to judge on its own (one button, one label) belongs
to the section around it.

For each section:

- `name`: two or three generic words a designer would use, the same in any product: "Sidebar",
  "Page header", "Key figures", "Revenue chart", "Customers table", "Plan cards", "Footer".
- `what`: what it holds, in one line, so it can be found in another design of the same content.
- `picture`: the file it is in (`desktop-fold.jpg`).
- `box`: where it is in that picture, as fractions of the picture's width and height (`x` and `y`
  of its top-left corner, `width`, `height`, each from 0 to 1). Be precise: look at the edges of
  the section, and include its padding.
