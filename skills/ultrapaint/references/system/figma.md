# Importing from Figma

Turning a Figma file into the design system: how to read it and how to match each piece to a
role. Read the file through whatever Figma access you have: a Figma MCP server (its variable
definitions, design context and screenshots), the REST API (the file with its styles and
components, and its local variables on plans that expose them), or what was exported from it (a
variables or tokens JSON, the component list, screenshots).

A file holds a system in four places: variables (in collections, with modes), styles (text,
colour, effect), components (with properties and variants), and the frames that use them. Its
names are Figma's (`Collection 1/Brand/600`) and its scales often hold more than the product
uses, so each piece is matched to a role the product needs, and the system's names win.

## Variables

- **Primitives and aliases.** A collection of raw values (`blue/600`, `grey/100`) is the colour
  scales; a collection whose variables point at others (`text/primary → grey/900`) is the roles.
  Keep the aliasing: a role points at a step, the step holds the value.
- **Modes are themes.** Light and dark modes of the roles become the system's themes; a mode for
  a brand or a density is a theme only when the product switches it.
- **Number variables** are spacing, radius, border widths or sizes: read which by where the
  components bind them, not by their name.
- **Left out**: steps only other variables point at and nothing in the product shows, and
  variables only Figma needs (prototype states, documentation colours).

## Styles

- **Text styles** become text styles: size, weight, line height and tracking together. Match each
  to a role (body, field label, control, titles, display) by where the frames use it. Two styles
  the frames use for one role are one; a style no frame uses is left out.
- **Effect styles** are elevation: each drop shadow matched to a level (raised, overlay), paired
  with the surface it sits on.
- **Colour styles** in an older file play the part of variables: the same split into scales and
  roles.

## Components

- **Properties** become props: a variant property an enum prop (`variant`, `size`), a boolean
  property a boolean, a text property a text prop, a property that swaps icons the icon's name.
- **Variants that only draw states** (`State=Hover`) are the component's states, not variants.
- **A component matching one the system has** (a Button with Size and Type) is that one, its
  properties mapped to its props; one nothing matches is a new component
  (`references/system/components.md`); a decorative one (a status bar, a cursor) is skipped.
- **Code Connect**, where the file has it, names the code component each Figma one already is:
  take that over any guess.

## What Figma leaves out

- **Fonts**: Figma names a face the machine may not have. Load it, or the nearest free face of
  the same geometry, and say which.
- **Raw colours**: a fill bound to no variable is matched to the role it plays; a value that
  matches no role is reported, not added as a token.
- **Foundations Figma never had**: focus rings, disabled states, motion, a dark theme. Take them
  from `references/system/foundations.md`, in the file's character, and say they were added.

## Check by building

Build one frame of the file with the imported system and compare it with Figma's render of it: a
colour, a weight or a radius that differs is a match that went wrong.

## Check

| You see | Fix |
| --- | --- |
| A token named after a Figma collection (`collection-1-brand-600`) | The role's name; the step behind it |
| Every step of the file's scales imported | The steps the roles point at, and what the product shows |
| A role holding a raw value instead of pointing at a step | Alias it to the step |
| A mode imported as a theme the product never switches | Leave it out |
| Hover and pressed imported as variants | States of the component |
| A property that swaps icons imported as an element prop | The icon's name |
| A raw colour from a frame added as a token | The role it plays, or reported |
| No focus ring, disabled state or dark theme, and nothing said | Add them from the foundations and say so |
