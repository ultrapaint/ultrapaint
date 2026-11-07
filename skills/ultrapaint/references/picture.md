# Remaking a picture

A screen made from a picture looks like the picture: every part of it there, nothing added, each
piece the same kind of component, in the same place, in the same style. The picture decides how it
looks and is its character (its warmth, radius, density and face win over this skill's
defaults); the words of the request decide what it says.

## Region by region

Before the first element, name the picture's regions (a sidebar, a header, the main column, a
footer) and what each holds, down to its edges: a sidebar's footer with its user row and its
"What's new" card, a banner, a search field. Build one region at a time and compare it with the
picture as it is done. Before finishing, check each region's last item is on screen: the user row
and the card at the foot of a sidebar are the ones most often dropped.

## Nothing missing, nothing added

Every block of the picture is there. Nothing is there that it does not show: no legend, caption,
count, section title, divider, card or icon of your own, and no image, glow or pattern. A page set
in type alone stays type alone. When something seems missing from the picture, it is missing on
purpose.

## The same kind of component

Name the component the picture uses and use that one, not its neighbour: a joined button group,
not separate buttons; a timeline, not a divided list; a vertical list of sections, not tabs; a
segmented control across the full width, not one that sizes to its content; a dropdown menu, not
a select; a badge that only shows a value, not a menu.

## The same place

Each control sits where the picture puts it, because its place says what it belongs to: a switch
in a card's footer beside the action it governs, an external-link icon alone in the corner, a
drag handle at the top right, filters below the title or on its line as the picture has them.

## The same style

- **Icons**: the same number, the same glyphs, the same style. Filled stays filled.
- **Fills**: every strong fill stays: a selected item in the brand colour, a dark featured card, a
  coloured button, a row or a cell tinted by its state. None becomes a white card with a hairline
  or a grey row with a coloured bar.
- **Badges**: the system's neutral Badge in the picture's case, radius and border; a coloured dot
  only where the picture marks a status; a bare number stays a bare number.
- **Colours that tell things apart**: each tag's hue, each step of a stepper, each category. None
  flattens to one grey.
- **Images**: each one there and loaded, of the same kind: a photo stays a photo, a screenshot
  stays the real interface, never a grey box. Each keeps its crop, corner and frame, and its
  treatment: a duotone, a greyscale logo strip, a scrim under text. An image that overhangs a band
  or bleeds off a tile still does, and none is boxed in a card of its own.
- **Text**: each role keeps its size, weight and colour; what is muted in the picture is muted.
- **The face**: the picture's, loaded; a fallback sans changes every line.

## Check

| You see | Fix |
| --- | --- |
| A block of the picture missing, often at an edge (a sidebar's footer, a search field) | Add it |
| A legend, caption, count, title, divider, card, icon, image or glow the picture does not have | Remove it |
| Separate buttons where the picture joins them, tabs where it lists | The picture's component |
| A control moved away from what it belongs to | Its place in the picture |
| Outline icons for filled ones, or more icons than the picture | Its icons and their style |
| A white card where the picture fills with a colour, a grey row where it tints the row | The fill, the tint |
| An image left as a placeholder, a broken box or a blank section | The picture's image, loaded |
| An image recoloured, recropped or boxed, where the picture tones it, bleeds it or lets it overhang | Its crop, frame, treatment and edge |
| Text darker, bolder or larger than the picture's | Its size, weight and colour |
