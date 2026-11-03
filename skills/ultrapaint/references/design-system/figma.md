# Importing from Figma

A Figma file holds a system in four places: variables (in collections, with modes), styles (text,
colour, effect), components (with properties and variants), and the frames that use them. Its
names are Figma's (`Collection 1/Brand/600`) and its palette is often more than the product uses,
so nothing is taken as it is: each piece is matched to a role the product needs, and the
system's names win. [with the editor's tools: Ultrapaint's `/sync figma` and `/import-figma` run the steps; this is how to decide each match. | without: Read the file through whatever Figma access you have (its variables, styles and components); this is how to decide each match.]

## Variables

- **Primitives and aliases.** A collection of raw values (`blue/600`, `grey/100`) is the palette.
  A collection whose variables point at others (`text/primary → grey/900`) is the roles. Keep the
  aliasing: a role points at a palette step, the step holds the value.
- **Modes are themes.** Light and dark modes of the roles become the system's themes; a mode for
  a brand or a density is a theme of its own only when the product switches it.
- **Number variables** are spacing, radius, border widths or sizes; read which by where the
  components bind them, not by their name.
- **Left out**: palette steps only other variables point at and nothing in the product shows,
  variables only Figma needs (prototype states, documentation colours).

## Styles

- **Text styles** become text styles: size, weight, line height and tracking together. Match each
  to a role (body, field label, control text, titles, display) by where the frames use it. Two
  styles the frames use for one role are one; a style no frame uses is left out.
- **Effect styles** are elevation: each drop shadow matched to a level (raised, overlay), paired
  with the surface it sits on.
- **Colour styles** in an older file play the part of variables: the same split, palette and roles.

## Components

- **Properties** become props: a variant property an enum prop (`variant`, `size`, `state` is a
  state, not a prop), a boolean property a boolean, a text property a text prop, an instance-swap
  of icons the icon's name.
- **Variants** that only draw states (`State=Hover`) are the component's states, not variants.
- **A component that matches one the system has** (a Button with Size and Type) is that one, its
  properties mapped to its props; one nothing does is a new component, made with
  `references/design-system/components.md`; a decorative one (a status bar, a cursor) is skipped.
- **Code Connect**, where the file has it, names the code component each Figma one already is:
  take that over any guess.

## What Figma leaves out

- **Fonts**: Figma names a face the machine may not have. Load it, or the nearest free face of
  the same geometry, and say which.
- **Raw colours**: a fill in a component or a frame bound to no variable is matched to the role it
  plays; a value that matches no role is reported, not added as a token.
- **Foundations Figma never had**: focus rings, disabled states, motion, a dark theme. Take them
  from `references/design-system/foundations.md`, in the file's character, and say they were added.

## Check by building

Draw one frame of the file with the imported system and compare it with Figma's: a colour, a
weight or a radius that differs is a match that went wrong.

## Before you finish

| You see | Fix |
| --- | --- |
| A token named after a Figma collection (`collection-1-brand-600`) | The role's name; the palette step behind it |
| Every palette step of the file imported | Only the steps the roles point at, and what the product shows |
| A role holding a raw value instead of pointing at a step | Alias it to the palette |
| A mode imported as a theme the product never switches | Leave it out |
| Hover and pressed imported as variants | States of the component |
| An instance-swap of icons imported as an element prop | The icon's name |
| A raw colour from a frame added as a token | The role it plays, or reported |
| Figma's face named and not loaded | Load it, or the nearest free face, and say which |
| No focus ring, disabled state or dark theme, and nothing said | Add them from the foundations and say so |
