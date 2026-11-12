# ADR 0041: System and app components

Status: accepted, 2026-10-29; a state in one variant member: amended by 0044; the Assets panel's
components and a view of their own: amended by 0045 (the Library). Renames 0040's
primitives and replaces 0029's specs and drafts.
Amends 0030 (a component is a design target as `component:<Name>`, its snapshot in
`_implemented/components/`) and 0027 (DESIGN.md's component tokens are read off the system
components' files). The terms are in `GLOSSARY.md`.

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: the migration is retired; an instance's `from` is one of the two origins, and a page that names another does not read.

## Context

0040 made the canvas draw the editor's own components, the primitives, each with a look the
project could own as a spec (`specs/<Name>.spec.json`, 0029). A part of a page could be made a
draft: a spec with a tree, drawn in its instances' place, whose instance text replaced the tree's
first text. That left two words for one thing (a primitive, a draft, a widget, a component), a
spec format with fields that only one kind used (`look: "code"` drew nothing once nothing was read
off the code; `draft` turned a look into a tree), and drafts that could vary only by one text. A
team's own components (a pricing card, a site header) need what a design tool's components have:
properties, slots, variants, nesting, and editing them where they are used.

## Decision

**Everything an instance places is a component, of two origins.** A **system component** is one
of the editor's own, the headless set on Base UI (`packages/system-components`, what 0040 called
the primitives), styled by the project's design system; an instance names it with
`from: "@ultrapaint/system"`. An **app component** is the project's own, built from system
components and other app components; an instance names it with `from: "#app"`. A layout, text or
image node is an **element**. "Primitive" now only means Base UI's own primitives, in code.

**One place: `components/<Name>.component.json`**, in the designs directory, one file per
component, in one envelope: `version`, `name`, `origin` (`system` or `app`), a `description`, a
`category` and the behaviour notes (`notes`, 0030), with a body of its origin's. A system
component with no file draws in its default look (`defaults.ts`, which is a file of the same
format); an app component cannot take a system component's name. The server validates every file,
whoever writes it, and lists what is wrong with one beside it.

**A system component's file is its look**: style fields per part (`root` or a `data-slot`) at its
base, per variant axis and member, and per state, as a spec said, and four things more:

- **Layout per part**: `direction`, `align`, `crossAlign`, `gap`, `padding` per side, and `order`,
  in the base, a variant or a state.
- **Content when empty** (`content`): nodes per slot, drawn when an instance gives that slot
  nothing; they are the look's, not the page's, and are not selected on the canvas.
- **Optional parts left out** (`hidden`): the catalogue marks which parts show something and may
  go (a dialog's close, a card's description, a field's label); a behavioural part may not.
- **An item template** (`item`) for Select and Menu: design nodes drawn for each item, the item's
  label in the text node `label` names and its picture in the image `image` names; an item is a
  label or `{ label, image }`. Selecting and highlighting stay Base UI's.

**The structure rule**: a system component's behavioural parts (a trigger, a popup, the items, a
tab list) are fixed. Anything that adds behaviour, or takes a behavioural part away, is an app
component built on the system component.

A state on a part matches where Base UI puts it: on the part itself (a checkbox's `data-checked`,
a tab's `data-active`, an item's `data-highlighted`, a new `highlighted` state) as well as on the
root, so the defaults say what `look.ts` wrote by hand (checked, focus rings, invalid, disabled,
highlighted items); what a look cannot say (positioning, animations, a mixed colour) stays there.

**An app component's file is a tree, its properties and its slots.** `tree` is a node, its root
the instance on the page. A **property** (`properties`) is what an instance sets, by name in its
`props`: a `text`, a `boolean`, an `image` or a `choice` of `members`, with a `default`, set on the
nodes its `targets` name: a node's own field for its kind (a text's text, an instance's text, a
node's visibility, an image's source) or, with `prop`, a property of the component instance the
node is (an outer "confirm label" set on an inner Button's text). A **variant** is a choice's
member: the nodes keep its overrides in their `at` under `<property>=<member>`, as they keep a
breakpoint's, so a change made to the component itself lands in every variant. A **slot**
(`slots`) is a container of the tree named for the instance's children that name it to fill, one
of them the default, as a system component's are. App components nest; one that places itself,
however deep, is refused when saved and drawn as a stand-in. The renderer draws an instance by
`expandAppInstance`, the instance's children in their slots selectable as the page's.

**Editing an app component happens in place.** A double-click on an instance, or "Edit component",
isolates it: the rest of the page dims and takes no pointer, the frame's selection and every edit
go to the component's tree, edited as a document of its own (`component:<Name>`), and every
instance follows. The inspector adds, renames and takes out properties (a choice's members too),
exposes a node's field as a property ("Expose as property": its text, its visibility, its
picture, a nested instance's text or prop), and makes a container a slot. A text edited in place
is its property's default. The banner at the canvas's foot picks the member of a choice edits land
on, recorded as an override as a view records a breakpoint's, and leaves with Done or Escape;
a click anywhere outside the component (the dimmed page, the ground, another frame) leaves too,
as nothing is lost by leaving: every edit is saved as it is made.
"Make an app component…" turns sibling nodes of a page into one, an instance in their place;
"Detach" puts the nodes an instance draws in its place, its values baked in. The Assets panel
lists System and App components apart; the inspector edits an instance's properties as props and
fills its slots. Side-by-side variants and a view of its own for components wait for a redesign.

**Implementing.** `/implement` on an app component writes it as a component of the application,
a prop for each property, children or a named prop for each slot, the system components inside as
the application's own components for them; it is marked implemented with that file, and a change
since shows as the design changed. On a system component with a file, the design owns its look,
and `/implement` applies it to the application's own component as 0040 says. A page's task names
the app components it places, to be used as the application's components.

**Migration** is Sync's one step (`components.migrate`), one undo step: instances named
`@ultrapaint/primitives` name `@ultrapaint/system`; each `specs/<Name>.spec.json` becomes
`components/<Name>.component.json`, a spec with the design's look a system component's file, a
draft an app component whose first text is a text property `text`, and a spec that mirrored the
code (`look: "code"`), which drew nothing, is dropped; a draft's instances (`#draft`) become an
app component's (`#app`), their text that property's value; `_implemented/specs/` moves to
`_implemented/components/`, each snapshot in the new format, and `implementation.json`'s
`spec:<Name>` targets become `component:<Name>`, their design hash the component's as implemented.
This repository's designs were migrated with it.

## Consequences

- One word, component, and one directory; agents write component files, which the briefing
  describes, and nothing else changed for pages.
- A team builds its own components on the canvas and varies them as its code does: props,
  children, variants, nesting. What they do stays the code's: an app component draws, it does not
  behave beyond its system components.
- A system component's look is richer, so fewer looks need an app component; one that does is a
  clear signal of behaviour the design adds.
- A component's tree is a document: undo, agents' edits and the file watcher reach it as they
  reach a page. Its breakpoint overrides are kept but not yet drawn in an instance, whose tree is
  drawn at the base.
