# Plan: the Design system and the Library

Status: accepted, 2026-10-30; done (the merge of `feat/primitives`, the sketch, this plan and
[ADR 0045](adr/0045-design-system-and-library.md), the shell, Design system, the Library, the
agents told what is picked and what went); Phase 8 is what is left for later. Amends 0028, 0029,
0032, 0040, 0041 and 0044 as the ADR says.

## Why

The design system's values, the components built on them and what a page places share two
panels the width of the rail's column, each doing a little of all three: the Design system panel
(Tokens, Components, DESIGN.md) and Assets (the elements, then every component). A palette, a
component in every variant and state, an app component's variants side by side do not fit
there, and a look is edited in a draft saved with a button. The design system gets the
foundations and the guidelines, the Library gets the components, and both open the item picked
as boards on a canvas of their own, edited live from an inspector on the right.

The screens are on the Redesign canvas, at the foot of the others: `design-system-color`,
`library-insert`, `library-button`, `library-app-component` (`docs/designs/redesign/`).

## Decisions

| # | Decision | Choice |
|---|---|---|
| B1 | The rail | Agents · Layers · Design system · Library · Changes. Assets goes; Layers shows on a board view only where there is a tree |
| B2 | Elements | An Insert menu, the first of the tools (+): Row, Column, Text (a paragraph), Image. Group stays the group tool |
| B3 | Library on a page | The insert list: App components, then System components, tiles with thumbnails, ↗, + New, the line to Design system |
| B4 | Board view | Not a third workspace: a view of the canvas workspace, with a camera of its own, over generated boards of the item picked only, on a tinted dotted background, with no element toolbar |
| B5 | What draws a board | A generated document drawn as a frame by the page renderer (as `Matrix` is), its frame ids `board:<view>/<item>/<name>`, never in `useEditor.frames` |
| B6 | Picking on a board | A node's id says what it stands for (`token:color-primary-600`, `cell:outline:hover`); the pick is the board's own, not the page selection, except in an app component's tree edited in place |
| B7 | Right panel on a board | The item's inspector (token, group, text style, palette, cell, app component), not Design/Code/Comments |
| B8 | Design system edits | `designSystem.edit(ops, label)`: typed operations, pure `applyEdits` in `design-document`, one write in one undo step; `designSystem.setToken` goes, the service's `setToken` stays one operation |
| B9 | Look edits | Live: a field's value drawn as it is typed (a look draft every frame shares), committed as one component change (`setStyle`) on the file as it is |
| B10 | URL | `?view=system&item=color`, `?view=library&item=Button` beside `canvas` and `page`; Back is the page left |
| B11 | Agent context | A board's pick is an attachment of its own, told with its file; no MCP tool |
| B12 | Motion | Drawn as a generated document like the others, the easings' animation the one thing written in the board's stylesheet (`@keyframes` per easing), since a document cannot say it |
| B13 | Later | Renaming a token, gradient tokens, an Everything canvas, icons and images in the Library |

## What the code makes harder than it sounds

Found while mapping the code for this plan; each is answered in the phase that meets it.

- **Frame ids mean a page.** Any frame id that is not `node:` is taken for a page's
  (`pageOfFrame`, `drawnRootOf`, `docOfFrame` in `state/documents.ts`; `showsIn` in
  `state/selection.ts`; `fileOfFrame` in `state/attachments.ts`; `followFrame` in
  `state/location.ts`). A board frame needs its own prefix, told apart there (`isBoardFrame`).
- **`useEditor.frames` is the page canvas.** It is keyed by page, saved to `canvas.json`, and
  `pagesChanged` (`state/location.ts`) opens the canvas again when it holds an id that is not a
  page. `allFrames()` feeds the camera's fit, `useFramesInView`, the drag's `frameAt` and
  `zoomToSelection`. Boards keep their layouts elsewhere, and those readers ask a frame source
  that knows which view is on screen.
- **`Canvas` draws pages and loose nodes only** (`canvas/canvas.tsx`), and `Frame`
  (`canvas/frame.tsx`) draws a document's root (`kind: "page" | "node"`); its drop, paste,
  create tools, menu and empty state are a page canvas's.
- **Two specimens share fixed frame ids**: `Matrix` draws in `design-system:components`,
  `TypeSpecimen` in `design-system:typography`. A board draws several frames at once, within the
  pool's limits (`PARKED_MAX` 32, `LOADING_MAX` 3 in `canvas/editor-frame.ts`).
- **A look's draft is a panel's state**: `SystemDetail` (`panels/design-components.tsx`) holds
  `edits` and saves the whole look with `setLook`; its matrix draws the draft in a look of its
  own, which the canvas does not see. Live edits need the draft lifted into the look's store.
- **An app component is edited in place through an instance in a frame** (`isolate` in
  `state/isolation.ts`, `editFrameAs`), and its matrix today is one instance (`cell-app`).
- **The token write follows the code outside the undo step** (`code.follow` after `save` in
  `services/design-system.ts`), and the web's undo toast relies on `setToken`'s `previous`.
  About six server test files call `setToken`.
- **The URL knows canvas, route, page, variant, mode, node and settings only** (`state/url.ts`);
  `writeUrl` rewrites four of them on every arrival and `linkToNode` builds a query of its own;
  `location.test.ts` asserts an exact search string.
- **"+ New" has no RPC**: `components.makeApp` needs a page and at least one node.
- **The thumbnails are Assets' own** (`useThumbnails`, not exported from `panels/assets.tsx`).
- **A prompt's selection is a page's node** (`PromptAttachment.selection` needs `file` and
  `nodeId`, told "on the design canvas" in `services/threads/turns.ts`).
- **The redesign canvas drew its chrome without half its tokens.** Since 0040 the canvas's tokens
  are the design system's or the neutral defaults (`look.ts`): `$color-sidebar`, `$color-brand`,
  `$color-rail` and `$shadow-*` resolve to nothing, so the older redesign pages lost their card
  fills (the new sketches use the neutral tokens and plain values). And every canvas image
  answered 404 until `dfaa3b3` (the asset route joined the root to an absolute path).

## Phases

Each phase is one commit at least, on `main`, after `pnpm typecheck`, the affected packages'
tests (`pnpm -r test` before a phase's last commit), `rtk proxy pnpm biome check .`, and for a
phase that touches the canvas `pnpm bench:canvas` on the Redesign canvas against the numbers
before it (no page-canvas regression). A phase ends with the editor run on this repository and
its screens compared with the sketch.

### Phase 4: the shell

The rail, the Insert menu, the board view and its URL, and the inspector's slot, with boards
that are placeholders until Phases 5 and 6.

- [x] 4.1 Rail: `LeftTab` becomes `"chat" | "layers" | "designSystem" | "library" | "changes"`
      and `railTabs` that order (`state/editor.ts`); `railItems` gains Library (`LibraryBig`)
      and loses Assets, the sync dot staying on Design system (`components/rail.tsx`); the
      `leftPanels` map (`app.tsx`) gets `library`, for now the Assets panel without its
      elements (`panels/library.tsx`, from `panels/assets.tsx`, which goes in 7.3); every
      `showLeftPanel("assets")` names `library` (`canvas/empty-state.tsx`), the palette's panel
      entries follow (`lib/commands.ts`), the context menu's "The Assets panel" entries are the
      Library's (`lib/menu-model.ts`), and the list/grid choice keeps its stored value under
      `ultrapaint:library-view`.
- [x] 4.2 Insert: a + at the head of the tools (`canvas/toolbar.tsx`, a `DropdownMenu` as
      `ZoomControl`'s) listing Row, Column, Text and Image from `ELEMENTS`
      (`packages/design-document/src/factories.ts`), each `insertNode(newElement(…))`
      (`lib/node-actions.ts`), as a click on Assets' tile did; a command each in
      `lib/commands.ts` so the palette has them.
- [x] 4.3 The board view's state: `state/board.ts`, `useBoard` with `view` (`"system" |
      "library" | null`), `item`, the pick (B6) and the board camera's `View`; `openBoard`,
      `leaveBoard` (back to the page and its camera as they were), `pickOnBoard`. Not a
      `Workspace` (B4): `showLeftPanel` and `setWorkspace` leave a board view as they leave the
      prototype, isolation leaves with it (`state/isolation.ts`).
- [x] 4.4 Frames: `BOARD_FRAME_PREFIX = "board:"` and `isBoardFrame` beside `isNodeFrame`
      (`state/documents.ts`), refused or skipped by `pageOfFrame`'s callers listed above;
      `allFrames()` (`state/editor.ts`) gives the board's layouts while a board view is open, so
      `zoomToFit`, `useFramesInView` (`canvas/camera.ts`) and `frameAt` (`canvas/drag.ts`) work
      on it unchanged.
- [x] 4.5 The board canvas: `canvas/board-canvas.tsx`, mounted by `app.tsx` in `Canvas`'s
      place while a board view is open; the same camera (`useCamera`), wheel and pan, the tinted
      background with its dots (`--board`, `--board-grid` in `styles.css`), a `Frame` of kind
      `board` (`canvas/frame.tsx`) drawing a request's root as `Matrix` does, with the board's
      frame labels; tools: select, interact, pan, the theme switch (not on Color), undo, redo.
      Boards are laid out in a row or a column by a pure `boardLayout` (`lib/board-layout.ts`).
- [x] 4.6 The URL: `view` and `item` read and written by `state/url.ts` (`readUrl`,
      `writeUrl`, kept by `linkToNode`'s query when on a board), arrived at by
      `state/location.ts` (`arrive`, `wentTo`), so a reload, a link and Back land on the item.
- [x] 4.7 The right panel's slot: `RightPanel` (`app.tsx`) shows `BoardInspector`
      (`panels/board-inspector.tsx`, empty for now) on a board view, the tabs on the page
      canvas.
- [x] 4.8 The left panels on a board: Library's list as navigation with Back to the page left
      and Overview (`panels/library.tsx`); Design system's Foundations and Guidelines list with
      token search (`panels/design-system-list.tsx`), the Sync and `/init` buttons in its title,
      `SyncView` in its place while the set-up is shown, as today. Layers is on the rail on a
      board only with a tree (`railTabs` read through a `railTabsFor(view, item)`).

As built: a board is drawn by `BoardFrame` in `canvas/board-canvas.tsx` (a `PreviewSurface`
frame, not `Frame`, which stays the page's), every board of the item mounted at once; the
camera while a board view is open is `useEditor.view` (the page's waits in `useBoard.left`, each
item's in `useBoard.cameras`), and `allFrames` asks `board.ts` through `showBoardFramesWith`;
the prototype, `reveal`, `goToPage` and a canvas switch leave a board view. The boards are the
shell's: `boards/system-boards.ts` (a palette's swatches, a foundation's tokens as rows, the
text styles and scale, a guideline's paragraphs) and `boards/library-boards.ts` (the Overview,
`matrixOf` moved there with its cells `cell:<member>:<state>`); guidelines are
`guide-<heading as a slug>` in the URL.

Tests: `state/board.test.ts` (open, leave back to the page and its camera, isolation left, a
pick kept per item); `state/location.test.ts` and a `state/url.test.ts` (`?view=system&item=color`
read, written, kept by a node link, Back); `state/panels.test.ts` and `lib/commands.test.ts` for
the rail's places; `state/documents.test.ts` for `isBoardFrame` beside pages, views and nodes;
`canvas/mounting.test.ts` for board frames in view; `lib/board-layout.test.ts`.

Checks: the four above, `pnpm bench:canvas` (the page canvas as it was), the board view drawn
and its URL reloaded in the editor.

### Phase 5: Design system

- [x] 5.1 `designSystem.edit`: the operations as a contract (`DesignSystemEdit` in
      `packages/contracts/src/design-system-edit.ts`: `setValue {name, theme?, value}`,
      `setDescription`, `addToken {name, group?, value, values?}`, `removeToken`, `moveToken
      {name, group, index?}`, `addGroup`, `renameGroup`, `setTextStyle {style}`,
      `removeTextStyle`); `applyEdits(ds, ops)` in
      `packages/design-document/src/design-system-edits.ts`, on `withTokenChanges`
      (`contracts/src/token-table.ts`) for values, failing with a tagged error that names the
      operation; the RPC in `packages/contracts/src/rpc.ts`; `DesignSystemService.edit(ops,
      label)` (`apps/server/src/services/design-system.ts`) as one `save` and `code.follow`
      for the values it changed, `setToken`/`setTokens` written on it; the handler in
      `rpc-handlers.ts`. `designSystem.setToken` goes; `lib/token-edit.ts` sends one operation
      and the toast's undo is the journal's.
- [x] 5.2 Generate ramp from…: a pure `rampOf(base, theme)` (`design-document/src/ramp.ts`): 11
      shades over OKLCH lightness with the base at its nearest step, the dark theme's run the
      other way; the palette's inspector previews it and applies it as one `edit`.
- [x] 5.3 The boards, generated documents (`apps/web/src/boards/system-boards.ts`, pure):
      `colorBoards(ds)` (a frame per theme: each palette's ramp and gradient strip, the usual
      contrast pairs with their WCAG ratio and grade, by a `contrastRatio` added to
      `contracts/src/token-value.ts` over its colour reading),
      `typographyBoards` (from `typeSpecimen()` in `panels/design-system.tsx`), `spacingBoards`,
      `radiusBoards`, `elevationBoards`, `motionBoards` (B12), `breakpointBoards`, and
      `guidelineBoard(document, section)`; node ids per B6. A project without a design system
      draws the neutral one, with Set up.
- [x] 5.4 The inspectors (`panels/board-inspector.tsx` and `panels/token-inspector.tsx`): a
      token's values per theme (`ValueField` with a colour picker), description, group, where
      it is used (the documents' and component files' `tokensUsed`), delete; a group's name and
      add a token; a text style's fields as token pickers (`useTokenOptions`); each committed
      field one `edit`.
- [x] 5.5 Guidelines: the section drawn as a document board and edited in place, written with
      `designSystem.setSection` (`panels/design-md-view.tsx`'s editing moved to the board).

Tests: `design-system-edits.test.ts` (each operation, an unknown token, a duplicate, a group
renamed with its tokens, a theme's value, a text style), `ramp.test.ts` (11 shades, lightness
in order, the base kept); the server's `design-system.edit` in one undo step that undo puts
back, with the code following (`design-system-sync.test.ts`, `undo.test.ts`), the callers of
`setToken` unchanged; `rpc.test.ts`; `boards/system-boards.test.ts` (ids, ramps, pairs and
grades, an empty design system); the inspector's field to operation in a
new `lib/token-edit.test.ts` (built as `lib/token-ops.test.ts`).

Checks: as Phase 4, and `apps/server/src/mcp.test.ts`'s budget untouched (no tool).

As built: `applyEdits` answers a problem naming the operation (`removeToken color-x: …`) rather
than a tagged error, as `component-files.ts`'s changes do, and the server makes it a `BadRequest`;
`setValue` refuses a token the design system does not list (the token prompt adds one with
`addToken`), and `editLabel` names the step. The service's `setToken` and `setTokens` stay, on the
same write as `edit` (`commit`), for Sync and the tests; the RPC `designSystem.setToken` is gone,
and its tests send `designSystem.edit` (the one undo step and the code following are
`design-system-edit.test.ts`'s).
The boards are split by place: `boards/color-boards.ts` (Color, a board a theme, `theme` on
`Board`; palettes, groups whose tokens are all steps, first; `contrastPairs`, `gradeOf`;
`neutralDesignSystem` from `NEUTRAL_COLORS`, now exported by `system-components/look.ts`),
`boards/foundation-boards.ts` (the others; Motion's `css`, carried by a frame's request into a
stylesheet of its own, `RenderRequest.css` in `preview-core`), `boards/board-nodes.ts` (the
pieces, `valueIn` following `var(--…)`). A group's title is `group:<name>`, picked like a token.
The inspectors are `panels/token-inspector.tsx` (token, group, text style, what a foundation can
add) and `panels/guideline-editor.tsx` (a guideline's markdown beside its board, its board drawing
it as typed through `useBoard.guideDraft`, written on leaving the field); the fields' operations
are `lib/token-ops.ts` (`valueOp`, `rampEdits`, `textStyleOp`, `usesOf`), tested in
`lib/token-ops.test.ts`. Live edits are a draft in `state/design-system.ts` (`draftEdits`,
`commitEdits`, `saved` beside the drawn design system). "Used in" counts the pages of the canvas
open, the component files and the text styles, in the editor. Found on the way: the neutral
look's dark colours were declared on the theme's element and so won over a colour the design gives
in its default theme only; every colour is now declared again in each theme (`designTokenCss`).
The boards' first view starts 32px past the left panel and Color's two themes 24px apart
(`ROW_GAP`).

### Phase 6: Library

- [x] 6.1 Overview: `overviewBoard(catalogue)` (`apps/web/src/boards/library-boards.ts`): every
      component in its default look (the catalogue's example), named; a click opens its board.
- [x] 6.2 A system component's board: `matrixOf` (`panels/design-components.tsx`) moves to
      `library-boards.ts` at full size, a row per member, a column per state, ids
      `cell:<member>:<state>`, and a board of its sizes; a click on a cell picks it; the
      interact tool makes the board run (hover and press live).
- [x] 6.3 Its inspector: `SystemDetail`'s fields (`Field`, `SlotFields`, `LookExtras`, `Notes`,
      the inheritance from `lib/look-places.ts`) in `panels/look-inspector.tsx` for the cell
      picked, Variant and State as selects, Used in. Live (B9): a `lookDraft` in
      `state/look.ts` laid over the saved files by `followLook`, so every frame draws the value
      typed; committed as a new component change `setStyle {place, slot, style}`
      (`packages/contracts/src/components.ts`, `ComponentService.change` in
      `apps/server/src/services/components.ts`, the file as it is, one undo step).
- [x] 6.4 An app component's board: a frame per member of each choice
      (`<property>=<member>`), its root an instance with that member
      (`board:library/<Name>/<property>=<member>`); a double-click isolates it there
      (`isolate`, `editFrameAs`), its edits landing on that member (`editVariant`); Layers shows
      the tree (`panels/layers.tsx`'s isolated branch). Its inspector: `AppDetail` and
      `component-props.tsx`, editable (properties, variants, slots through the existing
      component changes).
- [x] 6.5 + New: `components.create {name}` (contract, `ComponentService`, handler), an app
      component with an empty column, its board opened; ↗ on a tile opens the board.
- [x] 6.6 The Components tab goes (`ComponentsView` and its list); `specimens-drawing.test.tsx`
      tests the boards instead of `Matrix` (done with Phase 7).

Tests: `boards/library-boards.test.ts` (the overview, the matrix's cells and states, an app
component's frames per member); `component-files.test.ts` and the server's components test for
`setStyle` (a place, a part, on the file as it is, one undo step) and `create`;
`state/isolation.test.ts` for an instance on a board frame; `lib/look-places.test.ts` unchanged;
a new `state/look.test.ts` for the draft laid over the saved files.

Checks: as Phase 4.

As built: a system component's board is `systemComponentBoards` (`matrixOf` stays for the old
tab until 7.2 takes it): the matrix's cells are the catalogue's example in each place,
`cell:variant=outline:hover` (`cellId`, `placeOfCell`; `cell:base:base` for the base), under the
states' names and beside the members', laid out as a grid by the board's own stylesheet (a
document has rows and columns only, as Motion's animation is B12's); a further axis (Button's size)
is a board of its own. The cell picked is the place edited: the inspector
(`panels/look-inspector.tsx`, where `Field`, `SlotFields`, `LookExtras` and `Notes` moved) reads
the place from the pick and its Variant and State selects move the pick; the fields read the saved
file, the draft being drawn only, so a value picked is always a change. The live draft is
`useLookDraft` in `state/look.ts` (`draftStyle`, `commitStyle`), fed by an `onPreview` on the
style combobox (the option an open list highlights, a value typed); the look's other parts
(optional parts, a slot's content, an item's template) still save with `setLook`, being a click
each. `look-places` moved to `design-document` for the server's `setStyle`. An app component's
boards are a board a member of each choice (`appComponentBoards`, `appInPlace`): the choice's
default member edits the component's own fields, the others their member; a double-click isolates
the board's instance (`isolate` takes `select` and `variant`), the board then taking the pointer
as a page's frame (`BoardTree` in `board-canvas.tsx`, `useFramePointer` of kind `board`, which
moves nothing about the canvas), without the element toolbar but with the page's inspector on the
right for the node selected. A selection is refused on a board view but on an app component's
own boards (`takeBoardSelectionWith`, so `editor.ts` still imports nothing of `board.ts`), and a
selection landing there (from Layers) isolates that board; `boardTree` gives Layers the tree.
Found on the way: a new app component is an empty column with nothing on a board to fill it, so
the tools' Insert menu shows on a board while a tree is edited in place, with a Component submenu
(the Library is the navigation there); and the Overview clips its tiles and scales an app
component wider than one to it, its width measured once drawn when its tree hugs
(`drawnWidths`). 6.6 waits for Phase 7, which deletes the Components tab with the old panel.

### Phase 7: agent context, and what goes

- [x] 7.1 A board's pick is an attachment: `PromptAttachment` gains `board {kind: "token" |
      "component" | "guideline", name, variant?, state?, file}`
      (`packages/contracts/src/threads.ts`); `chipOfSelection` and `attachmentsOf`
      (`state/attachments.ts`) make it on a board; `scopeOf` and `attachmentBlocks`
      (`apps/server/src/services/threads/turns.ts`) tell it ("The user has picked the token
      color-primary-600 of the design system: light #2563eb, dark #60a5fa") with its file
      (`design-system.json`, `components/<Name>.component.json`) as a resource link. The
      inspector's title has the chat button the element toolbar has on a page.
- [x] 7.2 The old Design system panel goes (`panels/design-system.tsx`'s Contents, `Swatches`,
      `TokenRows`, `ElevationRows`, the Tokens and DESIGN.md tabs) once the boards draw all of
      it; `panels/design-components.tsx` is gone by 6.6.
- [x] 7.3 The Assets panel goes (`panels/assets.tsx`); `useThumbnails` lives in
      `lib/thumbnails.ts` for the Library; dead code found by the typecheck and by a search for
      `assets` goes with it.
- [x] 7.4 Docs: `README.md` (the rail, the Design system and Library sections, the table of
      where things are), `GLOSSARY.md` (Element offered by the Insert menu, the Components tab's
      look gone from "The design's look"), the ADR index, this plan's status.

Tests: `state/attachments.test.ts` for a board's chip; `threads.test.ts` /
`thread-session.test.ts` for the text a board pick gives; `mcp.test.ts` unchanged.

Checks: `pnpm -r test`, the typecheck, biome, `pnpm bench:canvas`, and the four sketched screens
side by side with the editor's.

As built: the attachment is `{kind: "board", pick, name, variant?, state?, detail?, file}`
(`BoardAttachment`), `pick` one of `token`, `group`, `textStyle`, `foundation` (the item open with
nothing picked), `guideline`, `systemComponent`, `appComponent`; `detail` is what it is now (a
token's value in each theme, a group's tokens, a text style's fields, a component still in its
default look, a variant that is its choice's default member). The web makes it in
`lib/board-chip.ts` (`boardChipOf`, pure, tested in `lib/board-chip.test.ts`) and holds it as a
chip like a node's (`state/attachments.ts`, keyed by what it is and where); the server tells it with
`boardPickText` in `services/threads/turns.ts` (tested in `board-pick.test.ts`), saying where a
system component's file keeps the look at the place picked (`variantStates.variant.outline.hover`),
the file linked when it exists; it gives a thread no scope. The chat button is `BoardChatButton`
(`canvas/element-toolbar-chat.tsx`) in `BoardInspector`'s title, and the composer sends the pick
along, dashed, when nothing is attached. A click on an app component's board picks its variant
(its sheet is `variant:tone=featured`); the board its tree is edited in place on is the variant
told, and a node selected there is a node's chip with the component's file (`fileOfFrame` follows
`editFrameAs`), on a page as on a board. What went: `panels/design-system.tsx`,
`panels/design-components.tsx` (with `matrixOf`), `panels/design-md-view.tsx` (`placeDocument`
moved to `lib/place-document.ts`), the token and text style right-click menus that only the old
panel opened (with `lib/token-edit.ts`), the Library menu's element flag, `ELEMENTS` (now the type
`ElementId`) and a few exports nothing read; `panels/assets.tsx` had gone in 4.1. DESIGN.md's
linter findings, shown only by the old panel's DESIGN.md tab, are listed under the Guidelines.
`specimens-drawing.test.tsx` is `canvas/board-drawing.test.tsx`. Polish from the Phase 6
screenshots: an item first seen is fitted between the panels, never past 100% (`firstBoardView`
in `lib/board-layout.ts`, `fitFirstView` once every board is measured, unless the camera was
moved), and an app component's variants wrap when a row would not fit at 100%
(`wrappedBoards`), so a wide header's stack rather than shrink; Button's `icon` size draws a plus rather than its label; the inspectors' labels read
whole ("Default" for a property's value when not set, a padding's sides as Top, Right, Bottom,
Left under Padding, a note's part on a line of its own); and a frame's React root is unmounted
right after the editor's commit rather than in it (`renderToCanvas`'s `unmount`), which ends the
"synchronously unmount a root" warning on leaving or switching boards and the prototype. The
bench's "Layers, open" (486 ms after Phase 6, 346 after Phase 4) was measured again interleaved
against `b172574`, five runs each: 358 ms and 354 ms at the median, the first run of each server
near 500 on both (Layers' chunk compiled by Vite the first time it is opened), so no regression.

### Phase 8: later, not now

- Renaming a token (pages and code rewritten).
- Gradient tokens.
- An Everything canvas: every board of the design system and the Library on one canvas.
- Icons and images in the Library.
- Editing elevation levels and animations (easing, duration pairs) as tokens on their boards.
- "Used in" across every canvas, not only the pages of the one open.
- Layers showing the text a variant overrides, rather than the component's own.
