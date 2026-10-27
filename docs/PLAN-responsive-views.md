# Plan: responsive views

Status: implemented, 2026-10-26 (all phases). Through [ADR 0036](adr/0036-responsive-views.md):
amends 0015, 0020 and 0034. "As built" under each phase says where the work differs from the plan.

## Why

Projects design for the codebase, and the codebase is mobile-first: one element, `flex-col
md:flex-row`. A design today has one value per field, so a page answers to no width: the
prototype's Mobile, Tablet and Desktop resize the viewport around a page that stays the same, and
a phone layout is a second page that drifts from the first. The repository's components already
respond to a frame's width (0034's container queries); the design around them has to as well.

## Decisions taken with the user (2026-10-26)

| Question | Answer |
|---|---|
| Views | Any width, as many as wanted per page; Mobile, Tablet and Desktop are presets, not limits |
| Breakpoints | The design system's (`layout.breakpoints`), Tailwind's when it names none |
| Cascade | Mobile-first only, no setting; desktop-first is left for a project that asks for it |
| Primary view | The base breakpoint's: the smallest |
| Where an edit lands | The view's breakpoint and up: Tailwind's cascade |
| A node added in a larger view | Shown from that view's breakpoint up, hidden below it |
| What can differ | Visibility, text, an instance's props, order, and every style field |

## The model

**Overrides.** A node keeps its values and gains `at`, keyed by breakpoint name:

```json
{ "id": "n4", "type": "column", "gap": "$spacing-4",
  "at": { "md": { "type": "row", "gap": "$spacing-6" }, "lg": { "gap": "$spacing-8" } } }
```

The node's own values are the base breakpoint's. A breakpoint's values hold from it on until a
further one sets the field again. Resolving a node at a width is pure: the base, then every
breakpoint up to the width, laid over it field by field (`packages/design-document`, beside
`css.ts`). `order` is new: a child's place among its siblings from a breakpoint on.

**Views.** `FrameLayout` gains `views`: `{ id, width, height, x, y }[]`, drawn beside the page's
frame. The page's frame is a view itself, the one it has always been. A view's breakpoint is the
largest whose minimum its width reaches (mobile-first); below the first, the base.

**Edits.** The editor knows which view an edit is made in, so which breakpoint: the base writes
the node's own fields, any other writes `at.<breakpoint>`. Setting a field back to what it
inherits removes the override. Structural operations change the one tree; an insert from a view
above the base writes `hidden: true` and `at.<breakpoint>.hidden: false`.

## Phases

### Phase 0: a component's JavaScript sees its frame's width

0034 left `matchMedia` and `innerWidth` answering for the editor's window. A component that
switches layout in JavaScript (a `useMediaQuery` nav) is wrong on every frame and in the
prototype today, views or not.

- Find out how the components in use read the width: `matchMedia` listeners, `innerWidth`,
  `ResizeObserver` on `document.body`.
- Answer `matchMedia` for the frame being drawn or taking input, as popups are routed today (the
  stack, then the frame that last drew), and fire its listeners when that frame is resized.
- Done when a `useMediaQuery` component shows its phone layout in a 390-wide frame and in the
  prototype on Mobile.

As built: `preview-core/src/media.ts`. A query is evaluated by a probe element inside the frame
with a container query of its own, so the browser reads it as it reads the stylesheet's. The
renderer calls the setup's `drawing` as instances draw and as the render's first effects run.
Checked with shadcn's `useIsMobile` in a 390 and a 1440 frame, and in the prototype's three
devices. Left: a width read while a component draws again after its own state change, and window
`resize` events.

### Phase 1: the format, the renderer and the code

No interface yet; agents and tests drive it.

1. `contracts`: `at` on every node, `order` in the box fields, the stack's `type` allowed in an
   override. The schema refuses an `at` key that is not a
   breakpoint only when the design system is known (the server checks; the codec does not).
2. `design-document`: the breakpoints of a design system (its own, else Tailwind's 640, 768,
   1024, 1280, 1536), `resolveAt(node, width)`, and `css.ts` split in two: the inline style of
   the fields no breakpoint touches, and the rules of the ones that differ.
3. `renderer-react` and `preview-core`: a node with overrides is drawn with a data attribute and
   its rules go to the frame's stylesheet as `@container <frame> (min-width: …)` blocks; the rules are built once per document, not per frame.
4. `code.ts`: `md:` classes; `order-*`; a text or an instance whose props
   differ written once per breakpoint range with `hidden`/`block` classes, unless the component's
   catalogue entry says it takes a responsive prop.
5. Tests: resolution, the cascade, the rules, the code for each kind of difference.

Done when a page with `at` written by hand draws differently in a 390 and a 1440 frame and in the
prototype's devices, and its code has the prefixes.

As built: no `@container` rules. Every frame knows its width, so the editor resolves the tree
there (`design-document/src/breakpoints.ts`) before it is drawn: canvas frames, views, the
prototype and screenshots alike. `code.ts` writes a class per breakpoint (`responsiveClasses`),
taking over within a class group (the Tailwind writer's `group`) and bounding the rest with
`max-*:`. A text or props that differ become one element per run of widths.

### Phase 2: views on the canvas

1. `canvas.json`: `frames.<page>.views`; the server keeps them when a page is renamed, moved or
   duplicated, and drops them with the page.
2. The editor's frames are keyed by page today (`frames`, `rects`, `sizes`, `selection.frame`).
   A view is a frame of its own (`<page>#<view>`) whose document is the page's: hit tests,
   rectangles and hover are the view's, the node is the page's.
3. A selection made in a view shows in every view of the page; the inspector and the layers read
   the page.
4. The page toolbar's viewport menu gets "Add view" (the design system's breakpoints as presets,
   or a width typed in) and each view a header of its own: its width, its breakpoint, remove.
   Views sit to the right of the page's frame and move with it.

As built: views are kept relative to the page's frame and placed among the editor's frames as
boxes of their own. The toolbar's Views menu adds one at a device's width or where a breakpoint
starts (no typed width yet). It goes to the right, or below when another page is there. The
toolbar hangs only in the view the selection was made in; the other views outline it. A layers
row keeps the selection in the view it is in.

### Phase 3: editing in a view

1. The inspector heads its fields with the breakpoint the edits land in ("Editing md and up").
2. A field set at this breakpoint is marked; an inherited one says where from ("from Mobile") and
   a reset takes the override away.
3. The canvas's direct edits (drag to resize, the element toolbar, text typed in place) land at the
   view's breakpoint as the inspector's do.
4. Undo is per edit, as now; an override is a field change.

As built: per-field marks became a Breakpoints section at the top of the inspector, with each
breakpoint's fields and a reset per field. A page without views edits its base, unless the field
shown comes from a breakpoint (ADR 0036). Edits route through `lib/breakpoint-edits.ts`: the
inspector, the canvas toolbar, inline text and inserts.

### Phase 4: what differs per breakpoint, made visible

1. Visibility: "Hidden below md" / "Only on mobile" in the inspector; the layers mark a row hidden
   at the selected view's breakpoint.
2. Text: typed in a view above the base, it becomes that breakpoint's `text`; the inspector shows
   the text of each breakpoint that has one.
3. An instance's props: the props section edits the view's breakpoint like any field.
4. Order: moving a row in the layers moves it in the tree for every view; "Move here from md up"
   writes `order` instead, offered while a view above the base is the one edited.

As built (visibility):
- Visibility is the Breakpoints section's **Shown at** select, in every view and on a page
  without views. Its rules are every width, hidden everywhere, and from or below each breakpoint,
  each listed with the class it writes.
- A rule an agent wrote that the select cannot (a range) shows as Custom.
- The eye stays the toggle for the view's own breakpoint, and the layers' eye and dimming read the
  node at that breakpoint.

As built (order): **Order** (First, In place, Last) is offered while a view above the base is
edited.

### Phase 5: agents, MCP and the implementation

1. `update` takes `at` (a breakpoint name) and writes there; `set_frame` takes `views`. The MCP
   listing is a few characters under its budget (`mcp.test.ts`): what agents need beyond the two
   parameters goes in the layout skill and the task prompts, not the tool descriptions.
2. The layout skill (`apps/server/src/skills/layout.ts`) designs the base screen first, then the
   overrides at each breakpoint, and screenshots every view.
3. `/implement` and the implementation link (0030) send and compare `at` with the other fields.
4. `get_screenshot` takes a view.

As built:
- `set_frame`'s `views` takes widths.
- `get_screenshot`'s `width` already picks the breakpoint, so it needs no view parameter.
- `apply_operations` refuses a breakpoint the design system lacks.
- The diff names `at.md.gap` as a field of its own.
- The Tailwind code rules tell `/implement` how to write `at`.
- The tools stay under the 16,000-character budget, after shortening a few descriptions.

## Not in this plan

- Folding a second page drawn for a phone into views: an agent can do it with the tools above.
- Figma import of frames that are the same screen at several widths.
- A view's height following its content: a view has a height, as a frame has.
- Breakpoints of a view's own: a view shows the design system's breakpoint its width falls in.

## Open questions

None left: the cascade is mobile-first only (no setting, so nothing to keep in the design system
or the config), and desktop-first waits for a project that needs it.
