# ADR 0042: What the system components left written in several places has one module too

Status: accepted, 2026-10-29. Follows 0037, 0038 and 0039, whose rule it applies again. Amends
0007 (the catalogue is a view over the component files, not the extractor's output), 0011 (no
framework package draws: the frame↔renderer interface is preview-core's, and the framework only
finds and writes an application), 0023 and 0025 (the design system notes no components), 0039 (a
frame's host has one writer, the editor), 0040 (an instance's layout is the catalogue's, not
reported by the frame) and 0041 (an app component's properties change on the server; the
migration is one module). The terms are in `GLOSSARY.md`.

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: the migration is retired (its web menu, the renderer's stand-in, `metaOf`'s match by name and the Code tab's default imports with it); the framework seam goes; a frame has no look of its own.

## Context

0040 and 0041 replaced the repository's components with the editor's own and the project's
component files. A review of the branch that built them found the concepts they touch written in
several places, and the leftovers of what they replaced still shaping interfaces. The catalogue, a
constant, sat behind a service, an RPC and a web store, and app components joined it only on the
web, so the agents never saw them; its entries still carried the extractor's fields. An
instance's layout, a fixed fact of the catalogue, travelled from the frame's DOM to the editor
after each paint, every slot read as the default one and a look's `direction` ignored; the
server's fill warnings got none. Filling an instance's slots was written four times and the copies
disagreed: the Code tab wrote a child naming an unknown slot as a part that does not exist, while
the canvas drew it in the default one. A render request promised a look per frame while the
renderer wrote one stylesheet all frames share, so the Components tab's unsaved look leaked onto
the canvas. A component's description lived in its file, the catalogue and `design-system.json`,
and Sync asked agents to describe the seventeen system components. Two services decoded a
component's file with two schemas, the inspector wrote the whole file from its last copy (losing
a tree edit made just before), renames orphaned variants and instances' props, and names were not
checked unique. A one-off migration widened two services and wrote `implementation.json` past its
owner. "Remove, then insert at the sibling's index" was written four times, the placement fields
twice. And the frame's interface sat in a framework package no framework drew with, its host kept
a writer for page code that no longer runs, and its stylesheets were translated for CSS the editor
writes itself.

## Decision

Each such concept has one module, with an interface its callers and its tests share:

- **The catalogue.** system-components' pure `catalogueOf(componentFiles)` lists the system
  components, then the app components that read, each slot laid out as the project's look says;
  `ComponentService.catalogue` gives it to the agents (`list_components`, `get_component`, the
  briefing, the page tasks, Sync, Figma's import) and the web's components store makes it from the
  files it holds. contracts' `metaOf` finds an instance's entry. The entry carries what a new
  instance starts with (`example`, `text`), so `newInstance` takes the entry alone.
- **Slot layout and filling slots.** design-document's `slots` module is the one rule for both
  origins: `fillSlots(instance, slots, content)` says what each slot holds (the children naming
  it, the rest in the default slot, the component's own content in a slot given nothing) and
  `slotLayoutOf(instance, slot, catalogue)` how it lays it out, in the instance's variant. The
  renderer, `expandAppInstance`, the Code tab, the inspector and the fill warnings ask it.
- **The design's look.** `Preview.setLook` takes the look once (system-components' `designCss`,
  made once per change of the design system or the components); the core writes its stylesheet
  for every frame and draws each again. A request that gives a look of its own (the Components
  tab's matrix) is drawn in a stylesheet of its frame's.
- **A component's file.** The server's pure `component-files` codec reads, writes, checks
  (`problemOf`, names unique) and changes a file (`withTree`, `renameProperty`, `renameMember`,
  `removeProperty`, `changedComponent`) and says what a change does to a document's instances
  (`instanceOps`). The inspector sends `components.change`; `ComponentService.change` makes it on
  the file as it is under the journal, with the instances' props across every document, in one
  undo step. An app component's tree is published as its document whenever its file changes, so
  the isolation keeps one source of the tree.
- **The migration.** The server's `Migration` service says what is left and runs Sync's step, on
  `DocumentService.all` and `apply` and the implementation module's `editIn`; the legacy names live
  in it and in system-components' `migrate.ts`, the pure conversion the editor shares.
- **Replacing a node in place.** The `replace` document operation puts a node where sibling nodes
  were; `appComponentFrom` makes an app component of nodes as `detachedOf` undoes it, over one
  placement list.
- **The frame's interface.** preview-core's `preview.ts` holds `Preview`, `FrameRuntime` and the
  internal seam `RenderToCanvas`, which keeps its two adapters: the React renderer, still a package
  of its own so the core stays free of React, and the scripted one the tests draw with. The host
  has one writer; the design's and the system components' CSS say `:host` themselves.

What nothing used goes: `CatalogueService`, the `catalogue.get` RPC and store, the extractor's
fields; `InstanceDrawn`, the report path and everything `wrapped`; `ComponentNotes`, the
component drift, `SyncFacts.components` and `librarySources`; `ProjectFramework` and the
`framework` and `storybookUrl` settings (a configuration file naming them still reads);
contracts' `page-runtime.ts`; `frame-css.ts`; `PageError.source`; `previewReady`.

0037's rule on seams stands: `RenderToCanvas` keeps two adapters; no seam was added with one.

## Consequences

- Agents see app components: the briefing lists them, `list_components` and `get_component` answer
  for them, and `get_component` no longer says `file: ""`.
- Bugs found where copies had drifted are fixed, each with a test: the matrix's unsaved look on
  the canvas, a fill inside a system component unwarned for agents, the Code tab sizing a child in
  a named slot, a turned look or an app component's slot as a block, a child naming an unknown slot
  written as a part that does not exist, Sync asking agents to describe the system components, a
  tree edit lost to the inspector's next save, a rename orphaning variants and instances' props,
  two properties of one name, an edit shown undone while the components' news was on its way.
- A change of rule is one edit: a new origin of components, a slot's layout, what fills a slot, a
  component file's format, a node replaced in place. Retiring the migration is deleting
  `migration.ts` and `migrate.ts` with Sync's step.
- The interfaces narrowed: `ComponentService` and `DocumentService` lost the migration's members,
  `RenderSetup` its constant and its stylesheet, a frame's events their instances, the settings two
  fields nothing read.
