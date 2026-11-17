# ADR 0098: Anything on the canvas has variations, and page variants are folded into them

Status: accepted, 2026-11-16. Amends 0086 (the selection, its Ask an agent popover), 0063 (a turn the review
skips) and 0018 (links). Replaces 0019's page variants. Built by UP-9.

## Context

The person asked for variations of what they select: a few takes on it, an optional prompt
saying what should vary, choosing one in place, choosing again later, and seeing them side by
side.

The first designs (7–10 Nov) started from the element toolbar. ADR 0086 removed it: the inspector
is the one place a selection is edited, and the agent's ✦ on the selection's edge opens Ask an
agent. The person chose to start variations there. After trying a chooser bar over the tools,
they chose to choose among the variations laid out beside the page, with the preview's own
controls under it.

The person then asked for **one concept, as few features as possible**:
- variations of anything, whether a page, a container, a component, a text or an image;
- **page variants** (`pricing@bold.page.json`, ADR 0019) folded into it, being the same idea for
  a whole page;
- a component's **variants** (its members, `kind=outline`) kept as they are.

The name was chosen from ten on 16 Nov. "Variations" is the clearest. Its near-twin, a component's
Variants section, is accepted.

## Decision

**A variation** is another way to draw something, kept with it. Anything on the canvas can have
variations: a page, a container, a component's main tree, a text, an image. Of a thing's
variations, **one is in use**: the one its page, the prototype, the agents and the code see. The
thing as it was before any variation is its first variation, **Original**, in use until another is
used. Once the one in use is deleted none is, the thing staying as it is drawn (below).

**Variations are made in two ways, from places that exist.**

- **Ask an agent:** under the ✦ popover's field, a quiet tray control (as the composer's,
  `trayTrigger`) reads "Variations" and its value: **One change** (the popover as it is), or 2, 3
  or 4.
  - Enter makes that many in a new chat in front (ADR 0074). The field's text says what should
    vary, and empty lets the agent pick.
  - The count is remembered in the browser.
  - The right-click menu's **Make variations…** opens the same popover, set to the count chosen
    last (3 the first time).
- **By hand:** the **+** of the inspector's Variations section copies the variation in use as a
  new one ("Variation 2"), and puts it in use to be edited. This replaces "Draw a variant".

**One agent makes them**, on a `Variations` task: the thing, the count and what should vary.

- Its prompt site is listed in the editor's prompt test. No MCP tool is added.
- The agent makes clearly different takes within the design system. Each has a name and what it
  varied ("Editorial · Tone of the copy").
  - A text's take is its words.
  - An image's take is another picture, from the project's assets or the agent's own means.
  - Anything else is its subtree, keeping its node ids.
- The agent works in copies whose files `familyOf` and the canvas layout never read. Each take is
  written into the thing's set before its copy is removed, so the turn's point holds only what was
  used.
- While the agent works, the thing is outlined in the agent's colour (`agent-work`). The first
  variation can be chosen before the others are done.
- The review loop never runs on a Variations turn.

**One way to choose, for every kind of thing: the variations laid out beside the page.**

- When an agent's first variation is ready, or when the person opens a thing's variations, the
  canvas lays them out beside the thing's page, in Canvas mode. A node on the canvas beside the
  pages, which has no page, has its variations laid out beside it, and it is its own preview. There is no other view and no
  stepping mode.
  - Each variation is drawn straight on the canvas background, with no card or container around
    it, with its name and what it varied above it. Original comes first, marked In use.
  - The camera fits the page and its variations.
  - Two rows are an eighth of the thing's larger side apart, and at least `80px`, so the names
    over a row hold at the zoom that fits them.
  - **The rest of the canvas fades back** under a scrim in the canvas's own colour (the board's
    on a board), with the thing's page and its variations over it. The variations may then lie
    over a neighbouring page, which is out of the choice: nothing on the canvas moves for them.
    A press on the faded canvas closes them, keeping the one in use, as Escape does, and selects
    nothing under it. The canvas still pans and zooms.
  - The right panel stays closed until something is selected.
- The thing in its page is the **preview** (the variation preview; the editor's Preview, which
  draws frames, is another thing).
  - A click on a variation shows it there, outlined **dashed** while it is not in use. Nothing is
    written.
  - ← and → move the preview through the variations.
- **The preview's controls hang under it**, attached to its bottom-left edge as the ✦ is to a
  selection's top-left.
  - While the preview is the variation in use, they are **Done** alone.
  - Once it differs, they say what it is ("Editorial", or "Original with Editorial's title"),
    followed by **Reset** (back to the one in use) and **Use this**.
  - Enter uses it, and Escape closes the variations, keeping the one in use.
  - Selecting something on the canvas closes them too, keeping the one in use, so ← and → walk the
    selection again (the person's answer of 16 Nov).
- **Use this** puts the preview in use as one undo step, closes the variations, and leaves the thing
  selected. The history keeps what was in use before. A preview made of several variations joins
  the set as a variation of its own.
- **One part of a variation:**
  - A double-click inside a variation selects one of its parts, as on the canvas. Its fields show
    in the right panel, read-only.
  - An arrow button on the part's edge, pointing at the page, puts it in the preview. **Use in
    preview** replaces the preview's part with that id. **Add to preview** puts a part the preview
    lacks in the same place in its parent. Either way, a node of the preview whose id the added
    part also holds moves into the part, where the variation has it, so each id stays in one
    place.
  - Where the preview lacks the parent too, the button is disabled and says why.
- While the agent works, the variations still to come are placeholders, and the preview's
  controls say how many are coming ("2 more coming"). One that failed is a red
  box with **Try again**, and the chat has its line.

**Each variation keeps its own edits** (the person's answer of 16 Nov). An edit lands on the
variation in use. Switching to another and back finds it as it was left, as a page variant was.
What the thing draws while none is in use is kept by no variation: using one puts it in, and
the history keeps every step as well.

**One list:** the inspector's **Variations** section, for every selection. With only its
original, it is the section's header and its +, so the first variation can be made by hand.
- A row per variation, with In use beside the one in use. A text's rows are its words, an image's
  its picture, anything else's its name and what it varied.
- A click on a row lays the variations out with that one in the preview.
- The section's header has + (New variation) and ⋯ (Make more…, Clear variations). A row's own
  menu (right-click) has Rename and Delete; Original can be renamed but not deleted while others
  remain.
- **Deleting a variation never changes the thing** (the person's answer of 16 Nov): using one
  copies it over the thing, and deleting one, even the one in use, leaves the thing as it is
  drawn. With the one in use deleted, none is in use until another is used, so three takes made,
  one chosen and all deleted leave the thing as the chosen one drew it.
- **Make more…** asks the agent for another round in a new turn, telling it which variation is in
  use and which were made before, so it makes takes unlike those.
- On a component's main tree it sits under the component's own Variants section. The two are
  told apart by their rows: members on one side, takes on the other.

**Where they are kept.** A page's variations, of its root and of anything in it, are one designs
file beside it (`notes.variations.json` for `notes.page.json`), shared through git. A component's
are beside its file. A node on the canvas beside the pages keeps its variations in its canvas's
file (`canvas.variations.json` beside `canvas.json`), which goes with the node.
- The file is written through the designs' one write path: its changes are undo steps and history
  points.
- It is renamed, moved and deleted with its page.
- Deleting a thing removes its variations in the same undo step.

**Page variants are folded in.**
- `pricing@bold.page.json` becomes the variation **Bold** of the page `pricing`'s root. The
  conversion runs once, when the server first reads a canvas that still has variant files: each
  is written into its page's `.variations.json`, then the variant file and `canvas.json`'s
  `variants` are removed, as one history point. In a folder whose settings are not saved yet
  (ADR 0092's first-change save), nothing is written on reading: the variant files are read as
  variations, and the conversion runs with the first change.
- **The prototype's variant switch goes.** The prototype shows each page's variation in use, as
  its page does. To present Bold, the person puts Bold in use. The editor's URL loses `&variant=`,
  and the router serves one page per route.
- A link's `variant=bold` opens its page with its variations laid out and **Bold** in the preview.
  A node reference to a variant's file (`orders@bold.page.json#c_8x2k1q`) is read the same way,
  on that node of the variation Bold.
  - Built (stage D): an agent's tool given either is told that it names Bold, a variation of its
    page now, and to name the page itself. The tools work on a page as its variation in use
    draws it, so taking the reference as the page would change another variation than the one
    it names.
- The Routes panel lists no variants under a route.
- The chat starter "Make three variants of it" goes: Ask an agent's Variations does it.
- A page's **states** (ADR 0044) are not variations and stay as they are.

## Consequences

- One word for "another way to draw this", and "variant" means only a component's member.
- Ask an agent's popover gains its first control. The ✦ stays where it is.
- `Variations` is a new task and a new prompt site.
- A page has at most one `.variations.json` beside it. A page's family is its base page and its
  states.
- The router no longer serves a variant's pages (`pagesInVariant` goes). Links, `get_context`
  and `list_pages` speak of variations where they spoke of variants. The tool texts are
  rewritten within the MCP budget.
- A canvas can no longer be clicked through as a whole other version. Its pages' variations in
  use are what the prototype shows.
- Choosing adds no view and no bar: the canvas draws the variations beside their page, fades
  the rest back while they are open, and the preview carries its own controls.
- Laid out beside the page, the variations covered the page right of it on a crowded canvas
  (the Redesign canvas), and a press between them selected that page (found proving stage B).
  Three ways were weighed on 17 Nov: moving the neighbours aside while they are open, which moves
  pages the person placed; the first free room past the neighbours or under the page, which can
  put them far from their thing; and a layer over the canvas. The layer was chosen and kept on
  the canvas, beside the page: choosing is already a mode that selecting closes, a mode's way out
  is a press outside it, and it holds on any canvas. The scrim takes the canvas's colour rather
  than a dialog's dark one, so the variations are still drawn on its ground.
- A variation drawn out of its page needs what its look depends on (its parent's layout, its
  theme). Building it measures this first.
  - Measured on 17 Nov, on the Redesign canvas's 148 parts two to four levels down:
    - Drawn at the thing's width, at its page's breakpoint and in its theme, 133 had the height
      they have in their page.
    - The 15 others all filled their parent's height, and drew shorter alone, some at nothing.
    - A part whose height fills its parent is now drawn at its height in its page, and all 148
      match.
