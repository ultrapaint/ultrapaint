# Elevation

Elevation says what is above what. Use the design system's levels, a surface and its shadow
together, and raise only what really sits above the page.

## Four levels, as pairs

Sunken is a well below the page and default is the page. Raised is a card that stands off it or
moves; overlay is a menu, popover, dialog or tooltip. The design system's `elevation` names
them: set `fill` to the level's surface and `shadow` to its shadow, always together.

## Most things are flat

A card on the page is the default surface with a border, or a change of surface. A shadow says
the thing moves or floats. A screen where everything floats has no depth at all.

## Nested surfaces step apart

A surface nested in another (a panel inside a floating card) differs from it by at least one tone
step of the system's surfaces: in dark, about `0.045` oklch lightness. It is flush with its
container's edges, and draws its edge only where it meets its container. Two surfaces of nearly one tone read as one, with no depth between them.

## Shadows come from the levels

One shadow per element, a token from its level. A custom `box-shadow` is a level the system
lacks: ask the user before adding one.

## Overlays stack in a fixed order

Navigation, then popovers and menus, then dialogs, then tooltips and toasts. In code, each
level's `layer` is its z-index.

## Attached or modal

A menu, popover or tooltip sits against what opened it, `4px` off its edge, and leaves the page
undimmed. A dialog is centred and dims the page behind it.

## Sunken holds small groups

Sunken is for a code block, a well of filters, the track of a progress bar. Sections of a page
keep the default surface.

## Before you finish

| You see | Fix |
| --- | --- |
| A shadow on a surface of another level | The level's own surface and shadow |
| A shadow on every card in a list | Flat cards with a border |
| A custom `box-shadow` string | The level's shadow token |
| A popover floating apart from its trigger | Attach it, `4px` off the edge |
| A whole section on the sunken surface | The default surface |
| A surface inside another of nearly the same tone, in either theme | One tone step apart, flush, an edge only where they meet |
