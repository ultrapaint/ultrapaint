# Brand

- `mark.svg`, `mark-white.svg`: the mark, a paintbrush with a bolt for a handle, in black and in
  white. The editor draws it in the text's colour (`apps/web/src/components/logo.tsx`).
- `lockup.svg`, `lockup-white.svg`: the mark beside the name.
- The app icon is the white mark on a black tile, half the tile's width, the tile 824 of 1024 on
  Apple's grid: `apps/desktop/resources/icon.svg`, and the `icon.png` the installers are made
  from, rendered from it at 1024. The tile is Apple's shape, not a rounded rectangle: each corner
  two curves fitted to Icon Composer's macOS export (within a third of a pixel), its curve running
  310 of 1024 along each edge. macOS 26 shrinks an icon whose tile leaves that shape onto a grey
  plate; a plain `rx` corner leaves it.
- The favicon, `apps/web/public/favicon.svg`, has the mark at 62.5% of its tile, to read at 16px.
