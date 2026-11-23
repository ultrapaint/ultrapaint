# ADR 0120: The main component edited in place is said in the inspector, and its nodes are outlined in the component colour

Status: accepted, 2026-11-23. Amends 0114 (the banner's breadcrumb) and 0041 (the banner that
picks the member edits land on).

## Context

Editing a main component in place (0114) put a floating banner over the tools: the breadcrumb, how
many instances an edit reaches, which member of its choices the edits land on, and Done. Its
fields were edited in the right panel, and nodes selected in it were outlined in the selection's
blue, as a page's are, so nothing on the canvas said that a change there reaches every instance.
The person asked for Figma's experience: no bar over the canvas, the mode said in the sidebar
where the component is changed, and the main component's nodes outlined in the component's
purple.

## Decision

- **No banner.** While a main component is edited in place, the top of the inspector's Design tab
  says so, above whatever is selected in it and with nothing selected: the component icon, the
  breadcrumb from the page or board through each level (any of them a way back), Done with its
  key (Escape), "Main component · N instances" under it, and, on a page with a component that has
  choices, the row "Edits land on" (All variants, or one member).
- **The right panel is there while one is edited.** It counts as something to show with nothing
  selected, and "Edit main component" brings it back on its Design tab, when it was put away or
  showed the Code tab: it is now the way out.
- **The component colour inside the main component.** Every node of a main component edited in
  place, hovered or selected, is outlined in the component colour, its handles and size too, as
  an instance and a layer of an instance already were on the page (0114).

## Consequences

- Switched to the Code tab while one is edited, the mode is said by the outlines and Layers'
  "Editing …" heading alone, until the Design tab is shown again; Escape still goes up a level.
- The banner's `tools` placement is gone; banners are the canvas's notes at its top and foot.
