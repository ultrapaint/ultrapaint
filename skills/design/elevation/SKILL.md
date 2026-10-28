---
name: elevation
description: "Elevation says what is above what. Use the design system's levels, a surface and its shadow together, and raise only what really sits above the page. Use when designing or reviewing an interface's elevation."
---

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

## Dark themes raise with light

Shadows barely show on dark, so a raised surface is lighter than the page. Check that each
level's surface gets lighter as the level rises in the dark theme.

## Before you finish

| You see | Fix |
| --- | --- |
| A shadow on a surface of another level | The level's own surface and shadow |
| A shadow on every card in a list | Flat cards with a border |
| A custom `box-shadow` string | The level's shadow token |
| A popover floating apart from its trigger | Attach it, `4px` off the edge |
| A whole section on the sunken surface | The default surface |
