# ADR 0086: The selection is drawn as Figma draws it, and the inspector is the one place to edit it

Status: accepted, 2026-11-12. Amends 0058 (the bar over the tools, the selection's tag) and 0085
(a page's notes in its toolbar).

## Context

The element toolbar was Vibe's (0018): with no inspector, it was the only way to change what was
selected. Once Vibe and Design were one workspace (0032) the bar stayed over every selection,
so with the right panel open each value (fill, radius, padding, gap, shadow, viewport, views) was
said and edited twice. On the canvas the selection carried a tag, its name and the agent's ✦ tab,
over the design.

The person asked for the bar to go, and for the selection to look and behave as Figma's does: its
handles, its size under it, no name but a page's, and the agent's button only while the pointer is
over what is selected, opening a place to ask; on the left edge, in Ultrapaint's own look.

## Decision

- **No element toolbar.** The inspector is the one place a selection's fields are edited. What
  only the bar had moves there: a page's views (Page, Views) and its behaviour notes. The
  menu is the right-click's; a parent is reached by Layers or its shortcut.
- **The selection's chrome** (`selection-chrome`), drawn outside the page's clip at its size on
  screen whatever the zoom:
  - its outline, and a handle on each corner of an element inside a page. Dragging one gives the
    element a fixed width and height at the view's breakpoint, drawn live (the element's **held
    size**, `node-sizing`) and saved in one "Resize" edit when let go. A page's frame and a node
    on the canvas keep their own handles.
  - its size, centred under it: an axis that fills or hugs named so, as the inspector names it
    ("52 Hug × 15 Hug"); a page's frame its width and height. Several selected: the box around
    them.
  - the agent's ✦ against its left edge at its top, shown only while the pointer is over what is
    selected (and a moment after it leaves, so it can be reached), an icon in the agents' colour
    that fills only under the pointer.
- **Nothing names an element on the canvas.** A page is named by its frame's header (0085); an
  element by Layers and the inspector.
- **Ask an agent.** The ✦ opens a popover to the left of the selection: the composer's field,
  "Ask for a change to Hero", sent with Enter in a new chat with the selection attached (the
  person typed and sent it, ADR 0074), the chat opened in the left panel. Under it, when a chat is
  open, the selection added to it or taken back out; and the chat it was started in.
- **Behaviour notes are the inspector's.** A Behaviour section lists the open behaviour notes on
  what is selected: on the page as a whole for a page, on the element for an element; pressing one
  opens its card on the canvas, at its element when it has no spot of its own. A note without a
  spot is still not pinned on the canvas (0085).

## Consequences

- With the right panel away nothing edits a selection's values; the panel comes back with the
  selection, or by its toggle.
- A component's variants are set in the inspector's component section, without the bar's
  pictures of each value.
- Sizing an element inside a page by its corner makes it fixed in both axes; Fill and Hug are
  set back in the inspector. Its edges do not resize it.
