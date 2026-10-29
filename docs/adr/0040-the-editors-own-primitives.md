# ADR 0040: The canvas draws the editor's own primitives

Status: accepted, 2026-10-28. Supersedes the repository's components on the canvas of 0015 and
0034 (the frames stay shadow roots of the editor's page) and the sandbox of
`docs/PLAN-preview-sandbox.md`. Amends 0007 (the catalogue is the primitives), 0011 (no framework
package builds or serves a preview), 0029 (a primitive's look is its spec; nothing is read off cva), 0027 (component tokens come from
the specs)
and 0030 (`/implement` applies a primitive to the application's own component). The terms are in
`GLOSSARY.md`.

> Renamed by [0041](0041-system-and-app-components.md), 2026-10-29: the primitives are **system
> components** (`packages/system-components`, `from: "@ultrapaint/system"`), drafts and widgets
> are **app components**, and both are kept in one `components/` directory. The decision here
> stands.

## Context

The canvas drew pages with the repository's own React components, which made a design look like
the product. To do it the server ran a Vite server per project, generated an entry the editor
imported through `/preview/`, and fenced the repository's code inside the editor's own page with a
sandbox: guards on the window's listeners, timers, requests, storage, head and body, a "turn" that
said whose code was running, a watchdog for a page that froze the editor, and a desktop watchdog
that ended a stuck script and named its line. Each guard was a bug class of its own.

It also tied design to code. A new project could not design until it had a component library; a
change to a component's structure (a dialog's footer buttons on the left) could not be made on the
canvas; a design could not be opened without its repository, nor hosted. And a library's compound
components (a dialog is a root, a trigger, a popup, a footer…) were hard to place by hand.

## Decision

**The editor ships its primitives** (`packages/primitives`): Button, Badge, Spinner, Avatar,
Card, Separator, Input, Textarea, Checkbox, Switch, Tabs, Select, Menu, Popover, Tooltip, Dialog
and Toast, built on Base UI and run by the editor's own React in every frame. Their catalogue
(`catalogue.ts`, no React) says each one's props, variant axes, parts by `data-slot`, the slots
that hold nodes, the states its look can be given for, and its layer: in the page's flow, anchored
above it, or blocking it. An instance names one with `from: "@ultrapaint/primitives"`.

**Slots are filled by the instance's children.** A child names the slot it fills (`slot`, a field
of every node: `"dialog-footer"`); the rest fill the default slot. The inspector lists a selected
primitive's slots, with what fills each and a menu to add to it; Layers shows a child's slot.

**A primitive's look is the design's.** Each primitive's default look is data: a spec (0029) in
the design document's own fields over the design system's tokens (`defaults.ts`), drawn by the
same `specCss` as a project's specs, in a layer of its own under them, with a neutral theme for a
project with no design system yet (`look.ts`). What a spec cannot say stays written by hand in
that layer: layout and positioning, a dialog's sheet on a narrow frame, animations, and what a
pointer or a state does to a part. Taking a primitive's look over starts the project's spec from
its default, so the designer edits real values; removing the spec resets it. A spec styles any
part in any variant and state; a portalled part is marked for the specs as a portal
(`data-ed-p`), and a part's rule finds it through the portal.

**Each frame is a viewport.** A popup is portalled into its frame's body, so a dialog's backdrop
covers its page only; Floating UI's viewport is the frame and its edge margin is in the frame's
pixels (`frame-viewport.ts`), so a popup sits where its page puts it at any zoom; containment and
`@container ed-frame` make a dialog a bottom sheet on a narrow frame. Designing, an overlay is
open where the design's `open` says, and the frame is inert: nothing takes focus or the pointer,
and a hover shows only where a spec's matrix pins it. In the prototype and interact mode the
primitives run, each kept to its frame: a press, a focus or an Escape from another frame or from
the editor closes nothing of it.

**Nothing of the repository's runs.** The preview server, `/preview/`, the generated entry and
editor bundle, the component registry, the catalogue's TypeScript extractor, preview-core's
sandbox, the renderer's registry and the watchdogs go. The frames take every token's value from
the design system (`designTokenCss`) and a canvas's images from the server's `/api/asset`. An
instance of a repository component from before is drawn as a stand-in that says so, until it is
drawn as the primitive its name says (`migrate.ts`, offered by Sync and by the stand-in's menu).

**Implementing applies the design to the application's components.** `/implement` writes each
primitive as the application's own component for it, its slots as that component's parts, and a
primitive's spec as the look of the application's component in whatever library it uses (Base
UI, Radix, shadcn, MUI), created on Base UI where there is none.

## Consequences

- A project designs with no code at all, and a design opens without its repository's toolchain;
  the desktop app and `pnpm pack:local` install nothing beside the server.
- The canvas shows the design, not the running application: a component of the application's
  that has no primitive is redrawn from primitives (a widget) or left as a stand-in, and drift
  between a design and the code is the implementation link's (0030) to report.
- A primitive's behaviour is Base UI's, which the application's library may not match exactly;
  implementing says so where it cannot follow.
- DESIGN.md's component tokens (0027) are read off the specs, not cva classes: a primitive whose
  look the project owns writes its root's fields, as it starts and in each colour variant and
  size; one in its default look writes nothing.
- Widgets (reusable compositions of primitives, a project's own components) are drafts (0029)
  until they get a name and a panel of their own.
