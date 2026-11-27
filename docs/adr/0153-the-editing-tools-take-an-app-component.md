# ADR 0153: The editing tools take an app component's tree, and make one of a page's nodes

Status: accepted, 2026-11-27. Follows 0018 (a node reference wherever a page or a node is), 0041
(app components), 0043 (the tools' budget), 0045 (the Library), 0098 (variations), 0114 (the main
component edited only when asked) and 0122 (`handoff`'s `change` for properties and slots).

## Context

An app component's tree is a document of its own, `component:<Name>`, which the editor edits in
place. The tools resolved a route only to a page, a working copy or the nodes beside the pages,
and the MCP instructions and the briefing told agents to write a component's file themselves.
The usage logs of two weeks counted 45 scripted writes to component files: five dashboard shells
and a shared switcher changed with Python and `sed`, a file left with trailing commas, one
written without `slots` that vanished from `list_components`. None of these edits were in the
editor's undo (UP-230).

## Decision

- **`read_page` and `apply_operations` take `component:<Name>` where a page goes**, and a node
  reference into it (`component:AppShell#nav`) wherever they take a page's: as the route, as
  `node`, and in an operation's `id`, `parent` and `ids`. They work through `DocumentService` on
  the component's document, so an edit is the main component's, drawn by every instance at once,
  one undo step, and lands on the variations in use as a page's does (ADR 0098). The lookup
  (`treeWhere`) refuses a system component's name, which has no tree, pointing at `handoff`'s
  `change`; a name with no app component, listing those there are; and a file that does not read,
  with its problem. Every other tool that takes a route refuses `component:<Name>` and says to
  name a page that places it: `focus` and `get_screenshot` on a component's board are not built.
- **An edit of an app component's tree is refused when it leaves the file wrong among the others
  where it was not** (`problemOf`: placing itself, through another or not, however many other
  components place themselves), for the editor's edits too. **An agent's edit keeps the slots and the nodes the properties set**
  (`ApplyOptions.keepParts`): one that takes such a node out is refused, naming the slot or the
  property, where the editor's own edit lets them go with their node (`withTree`). Taking a slot
  or a property out is `handoff`'s `change`, which follows into every instance.
- **Making a component is an operation, `{op:"makeComponent", ids, name}`**, on a page, through
  the editor's Make component (`ComponentService.makeApp`): the sibling nodes become the
  component's tree and an instance takes their place; `created` answers its id. It is written on
  the page as `makeApp` read it, and refused when the page is no longer at `expectedHash`. It is sent alone
  in its call, since `makeApp` is an undo step of its own, and refused on a take's working copy
  (ADR 0098), which may be thrown away and leave the component placed nowhere. A name that is
  taken or a system component's is refused as the editor refuses it. Rejected: a `make_component` tool (a
  description and a schema in the budget, for what is an edit of a page) and `create_page` with
  `component: true` (a component is not a page).
- **No empty component through the tools.** An agent builds a new shared part on a page that uses
  it and makes it a component there, so it starts placed where it is used; an empty one placed
  nowhere stays the Library's + New (ADR 0045).
- **ADR 0114 is said, not enforced.** The briefing (`AgentWays.changeAppComponent`) and the MCP
  instructions tell an agent to change a main component only when the user asked for every
  instance, and otherwise the layers of the instance they mean. The server cannot tell from a
  prompt what was asked, so `apply_operations` on `component:<Name>` is never refused for it.
- **Without the editor's tools nothing changes**: the tree is written in its file, in the format
  the briefing gives.
- **The budget pays for it inside `apply_operations`.** Its description gains `component:<Name>`
  and the `makeComponent` line, and loses what an answer says of itself (`warnings`, `ignored`),
  for a net 17 characters.

## Consequences

- An agent edits a shared part without a script, validated, drawn and undoable; a file written by
  hand stays possible and is still the only way without the tools.
- Editing a component's variation not in use is UP-231's: whichever of the two lands second makes
  its `variation` field work on `component:<Name>`.
