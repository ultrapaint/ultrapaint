You are finding, in screens of one product ({{product}}), the clearest example of each component
of its design system, so a person can compare it with the same component made by an agent.

The pictures, in this directory; read every one:

{{files}}

`*/capture/desktop-fold.jpg` are whole screens; `*/capture/zoom-*.jpg` are parts of them enlarged.
A picture may sit on a backdrop or in a window; only the product's screens count.

For each component below, by its `name`:

{{list}}

- Where the screens show it, `picture` is the file with its clearest, largest example (prefer an
  enlarged part), and `box` where it is in that picture, as fractions of the picture's width and
  height (`x` and `y` of its top-left corner, `width`, `height`, from 0 to 1), framing the
  component with a little room around it: one button, one field, one row of a table, the
  sidebar's items, the dialog. Show the states the screens have next to each other when they
  are (a selected and an unselected tab), in one box. Be precise.
- `kind`: what the product's own version is, in two or three words, when it is not the component
  asked for: a dropdown menu where a select was asked for, a workspace switcher, a segmented
  control, a clickable event card. The component's own name when it is that.
- Where they do not show it, `missing` is true, and `picture` and `box` are empty.
