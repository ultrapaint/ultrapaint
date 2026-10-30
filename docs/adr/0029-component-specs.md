# ADR 0029: A component's behaviour is the code's; its look can be the design's

Status: superseded by 0041 (specs and drafts become components) and 0045 (a component's look is edited on its board), 2026-10-30. Accepted 2026-10-25. Builds on 0015 (instances render the repository's components),
0027 (component tokens from cva) and 0028 (the design holds the values). Plan:
`docs/PLAN-design-source.md`.

> Amended 2026-10-25 (second round): a spec keeps the component's behaviour notes (`notes`),
> and every spec can be read off the code at once, linked to its component's file.
>
> Amended 2026-10-28 (`docs/PLAN-architecture-2.md`, step 5): a spec read off the code alone is
> linked to its component's file too, unless it keeps behaviour notes, which the code is not
> read for.

> Amended by [0040](0040-the-editors-own-primitives.md), 2026-10-28: the components are the
> editor's primitives, whose specs start from their parts over a default look; nothing is read off
> cva classes, and a primitive's spec is implemented on the application's own component.

> Replaced by [0041](0041-system-and-app-components.md), 2026-10-29: specs and drafts are
> components' files, `components/<Name>.component.json`: a system component's look, or an app
> component with properties, slots and variants. Sync migrates them.

## Context

Pages are drawn with the repository's real components, which is what makes a design look like
the product. But a component could only be used: not restyled for a redesign, not proposed, and
a new project had to take the scaffold's look as it was. Drawing components without code would
lose what makes them worth drawing — a dialog that opens, a menu that keeps focus — and building
that again is a project of its own.

Modern React UI already separates the two. shadcn's components are Base UI or Radix behaviour
under cva classes, every part marked with `data-slot`, and the headless libraries say their
state in attributes (`data-open`, `data-highlighted`, `data-disabled`, `data-state="checked"`).

## Decision

**A component spec is a document of the design.** `specs/<Component>.spec.json` in the designs
directory:

| Field | What it is |
|---|---|
| `component`, `from` | The component it describes, as an instance names it |
| `look` | `design`: the spec is drawn over the component; `code`: it mirrors the code and draws nothing |
| `slots` | The parts by `data-slot`, the root first |
| `base` | Style fields per slot |
| `variants` | Per axis (`variant`, `size`), per member, style fields per slot |
| `states` | `hover`, `focus`, `active`, `disabled`, `open`, `checked`, `invalid`: style fields per slot |
| `defaults` | The member each axis starts in |
| `draft` | A spec with no code: a tree of nodes drawn in its place |
| `notes` | Behaviour notes (0030): what the code must do that the spec cannot show, about a slot or the whole component |

Style fields are the design document's own (`fill`, `color`, `border`, `radius`, `padding`,
`height`, `width`, `shadow`, `opacity`, `fontSize`, `fontWeight`), tokens included.

**Behaviour always comes from code.** A spec with `look: design` is applied as a stylesheet over
the real component. The renderer marks every instance with `data-ed-c` (its component) and
`data-ed-v` (its variant props, `variant:outline size:sm`); a slot is the root, or a descendant's
`data-slot`. A state is its pseudo-class, the headless libraries' attributes and `data-ed-state`,
which pins it for the spec's matrix. The stylesheet is unlayered and comes after the code's, so
it wins over Tailwind's utilities without `!important`; a property the spec does not set stays
the code's. A component that keeps its props to itself is styled through the wrapper the
renderer already draws (0015).

**Who owns the look is per component.** A team can redesign Button and Card and leave their data
table to the code. A spec read off the code (`look: code`) is a mirror until someone takes it
over.

**A spec is read off the code by the style system.** `componentSpec(styles, tokens)` turns the
catalogue's cva classes into spec fields, `hover:`, `focus-visible:`, `disabled:`,
`data-[state=open]:`/`data-open:`, `aria-invalid:` into states, and classes into tokens where
they name one.

**A draft is a component the code does not have yet.** A selection becomes a draft: its subtree
is the spec's `draft`, and the selection is replaced by an instance (`from: "#draft"`). The
renderer draws the tree in the instance's place, and only the instance can be selected. A draft
is an implementation item like a page; once the code has it, its instances name the real one.

**A new project starts with specs.** The scaffold writes its components as cva with `data-slot`,
the dialog, select, tabs and checkbox on Base UI; once the application is set up, the editor reads
a spec for each with `look: design`: the project is restyled in the editor and the code follows.

**Implementing a spec is an agent's.** `/implement` takes a component: the spec, what changed
since it was implemented (0030), its behaviour notes, and the rules that turn style fields into
the code's classes.

**A component's behaviour notes live in its spec.** A page's notes are comments pinned on it
(0030); a component has no canvas to pin them on, so its spec keeps them, each with an id, the
slot it is about and its text. Being part of the spec, a note added or changed is part of what
tells the spec changed since it was implemented, and `/implement` names it. Reading the spec off
the code again keeps them: they are not the code's look. The Components tab lists and adds them,
and `handoff` "note" on `spec:<Component>` (the node a slot) adds one.

**A project built already comes in at once.** **Read every spec from the code** in the
Components tab reads a spec for every component with classes and no spec yet, mirroring the code
(`look: code`), in one undo step, and links each to its component's file as implemented: from
then on a look taken over and changed reads as the design having changed.

## Consequences

- `ed:render` carries the drafts' trees and the specs' stylesheet with the design's tokens.
- The Design system panel has a Components tab: the specs, a live matrix of each one's variants
  and states, the fields of a slot in a variant or a state, who owns the look.
- A component on a library that does not mark its parts can only be styled at its root.
- No MCP tool is added: agents write spec files, which the server validates when they change.
