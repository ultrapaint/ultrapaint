# Brand

- `mark.svg`, `mark-white.svg`: the mark, a paintbrush with a bolt for a handle, in black and in
  white. The editor draws it in the text's colour (`apps/web/src/components/logo.tsx`).
- `lockup.svg`, `lockup-white.svg`: the mark beside the name.
- The app icon is the white mark on a black tile, 62% of the tile's width as macOS's
  (`apps/desktop/resources/icon.icon`) draws it, the tile 824 of 1024 on Apple's grid:
  `apps/desktop/resources/icon.svg`, and the `icon.png` the installers are made from, rendered
  from it at 1024 by headless Chrome. The tile is Apple's shape, not a rounded rectangle: each corner
  two curves fitted to Icon Composer's macOS export (within a third of a pixel), its curve running
  310 of 1024 along each edge. macOS 26 shrinks an icon whose tile leaves that shape onto a grey
  plate; a plain `rx` corner leaves it.
- Ultrapaint Dev's icon, `apps/desktop/resources/icon-dev.svg` and its `icon-dev.png`, is the
  same mark at the same size on a blueprint tile: a white grid, a border inside the tile's edge,
  the mark's width and height dimensioned and a registration mark, the grid's major lines and the
  marks 6 to 7 of 1024 thick so they read at Dock size (ADR 0113).
- The favicon, `apps/web/public/favicon.svg`, has the mark at 62.5% of its tile, to read at 16px.
