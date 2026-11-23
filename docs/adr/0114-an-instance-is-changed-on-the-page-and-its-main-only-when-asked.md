# ADR 0114: An instance's layers are selected on the page and changed for it alone; its main component is edited only when asked

Status: accepted, 2026-11-23. Supersedes 0041's "Editing an app component happens
in place" (a double-click isolating an instance, every edit going to the main component). The rest
of 0041 stands: properties, slots, variants, nesting, Detach and implementing.

## Context

An app component's layers were not the page's: the renderer drew them under an attribute the hit
test never answers, Layers listed only an instance's slot content, and a click on an instance,
however often, stayed on it. The only way to reach a layer was a double-click or "Edit main
component", which edited the main component for every instance. A page whose whole layout is one
component (a shell with a sidebar and a slot) could not have one part of it changed for that page,
and nested components could only be reached by opening each one's main in turn. The person asked
for Figma's experience: a component's layers reached as if there were no component.

## Decision

- **An instance's layers are selected on the page.** A click steps into an instance as it steps
  into a group; double-click goes one level deeper and edits a text where it lands, never opening
  the main component; Ctrl/⌘-click (as Alt-click) takes the innermost layer. Layers lists an
  instance's own layers under it, beside its slot content. A layer inside an instance is outlined
  in the component colour, and the inspector's header names the instance it is in. Nested
  instances are the same at any depth: a nested instance's props are set for that place alone.
- **A change there is an instance override**: any field of a layer the component has (text, fill,
  spacing, size, radius, visibility, layout), kept on the instance in a field of its own keyed by
  the layer's id in the component, never a structural change. Adding, moving or reordering layers
  is the main component's or a slot's; Delete on a layer inside an instance hides it there. A
  field a property targets is set as that property's value, never overridden.
- **The main component wins where the instance did not change it.** An overridden field keeps the
  instance's value through every change to the main; a layer the main deletes takes its overrides
  with it. The inspector marks an overridden field and resets it; an instance's component section
  resets all its overrides, applies them to the main component (every instance), or makes one
  field a property of the component with this instance's value. An instance override made in a
  view lands at that view's breakpoint, as every edit does (0036); it stays when the instance
  switches a choice, winning over what the member sets; a layer inside an instance has no
  variations of its own (0098), the instance's variations each keeping their own overrides.
- **The main component is edited only when asked**: "Edit main component" in the instance's
  component section (always shown, properties or not) or its right-click menu, and its board,
  where a click selects with no double-click first. Editing the main reached through another
  component stacks: Escape, or a click outside, goes up one level, and a breadcrumb in the banner
  names each level and goes to any of them. A component whose root fills a page is drawn on its
  board at the frame of the first page that places it, or 1440×900. Edited from a page, the
  instance draws the main component's own values, its slots' content kept and the page dimmed.
- **Overrides reach the code as props.** `/implement` makes each field some instance overrides a
  prop of the component, named from its layer and field, each instance passing its value; the
  design keeps them as instance overrides. They are part of the page format, read in `read_page`
  and written with the existing `apply_operations`, with no new MCP tool.

## Consequences

- The cost accepted: a page now holds values for layers that live in another file, so a
  component's layer ids are part of every page that overrides them, and a rename or a re-made
  layer in the main loses those overrides as Figma's do.
- One-off tweaks no longer become properties of the component as they are made; a component can
  gain props when implemented that its file never declared.
