/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const elevation = {
  name: "elevation",
  text: `# Elevation

Elevation says what is above what. Use the design system's levels, a surface and its shadow
together, and raise only what really sits above the page.

- Four levels are enough: sunken (a well below the page), default (the page), raised (a card
  that stands off it or moves), overlay (menus, popovers, dialogs, tooltips). The design
  system's \`elevation\` names them; use its surface and shadow as a pair.
- Most things are flat. A card on the page is the default surface with a border, or a change
  of surface, not a shadow. A screen where everything floats has no depth at all.
- A raised surface uses the raised shadow and nothing else; an overlay uses the overlay shadow.
  Do not invent a shadow for one element or stack two of them.
- Overlays are above everything, and their order is fixed: navigation, then popovers and menus,
  then dialogs, then tooltips and toasts. Use the levels' layers in code; never a z-index of
  9999.
- A dialog dims the page behind it; a popover does not. A menu is attached to what opened it.
- Sunken is for grouping and tracks: a code block, a well of filters, the track of a progress
  bar. It is not a second background for whole sections.
- Every theme keeps the order: on a dark theme a raised surface is lighter, not just darker
  shadowed. Check the other theme.
`,
} as const;
