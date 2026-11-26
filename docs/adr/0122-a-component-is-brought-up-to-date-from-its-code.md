# ADR 0122: A component is brought up to date from its code, as a page is

Status: accepted, 2026-11-23. Amends 0115 (components left out of Update from code). Story:
UP-115.

> Amended 2026-11-26 (UP-227): a look changed through `handoff` is told to every thread with the
> tools, not only Update from code: the design briefing lists the look's changes, the MCP
> instructions name `setStyle`, and `get_component` answers a system component's parts, states
> and look as drawn. The first change to a system component with no file starts its file from
> the default look in the same undo step. The file check (0041) covers the parts, variant
> members and states a look styles, for every writer; a change to a look whose file does not
> read is taken when it adds no problem, so the file is fixed one change at a time.

## Context

A component's code changes too: a layout component gets a new region, a button a new size, a card
a new slot. Every page draws a component through its instances, from its file
(`components/<Name>.component.json`, 0041), so when the code moves on, every page that uses it
keeps drawing the old one. The component's binding (`component:<Name>`, 0030 amended by 0041)
turns *Code changed*, but 0115 brought pages up to date and left components out.

A component changes in a way a page does not: an instance names its properties and members in its
props, so a property renamed in the file alone leaves every page's instances naming one that is
gone. The editor renames them with the file (`ComponentService.change`, `instanceOps`), but no
agent could call it: it was the editor's `components.change` call only, and the MCP instructions
told agents to write a component's file as a file. The person decided on 2026-11-23 how an agent
makes such a change.

## Decision

- **`/update-from-code` takes components** beside pages, by their canonical target
  (`/update-from-code component:AppShell settings.page.json`). A component is taken when its code
  changed since it was implemented; one never implemented has no code to come from and is left out.
  Named by nothing, the update takes the components whose code changed along with the pages. The
  MCP prompt completes `component:<Name>` too. No new module: the page tasks write a component's
  entry through its file and its implementation link, as `/implement` does for a component.
- **Reconciling is 0115's, in its words**, for a component's file: the agent reads the files that
  draw it, the changed ones first, and the component as implemented (`_implemented/components/`);
  where it can see the running application, it looks at the component on a screen that uses it;
  where the design changed too, it keeps each side's own changes, lets the histories decide where
  both changed the same thing, asks the person where it can't tell, and puts the kept changes back
  after marking, so the component reads *Design changed*.
- **`handoff` changes a component**: its action `"change"` takes one `ComponentChange` and applies
  it through `ComponentService.change`, as the editor does, as `"note"` adds a component's note. A
  property or member renamed follows into every instance's props, on the pages and in app
  components' trees, in the same undo step (there is no slot rename among the changes); a system component's look changes one look change at a time. The tool's description
  grows by one clause and its schema by one parameter (13,333 of the 13,600 characters the tools
  may take); the ops are listed in the task that asks for them. The MCP instructions say a
  component's properties, members and slots change through it. Rejected: the ops in
  `apply_operations`, whose description would grow most; a tool of its own, which would force cuts
  elsewhere; the file edited by hand, which leaves it to the agent to catch every page.
- **Pages follow through their instances.** No page is rewritten for a component's change. The task
  names the pages that place each component, through other app components too, and the agent's
  last message lists them. A page whose own code changed is still its own update; an update that
  names only pages whose code is unchanged, but whose components' code changed, is refused with a
  pointer to their update (`/update-from-code component:<Name>`).
- **The editor offers it on the component's board** in the Library: an Implementation section,
  once the component is implemented, with its status and files and, for *Code changed*, the
  **Update from code** button under the same words as a page's. Each drafts the task in a new
  chat for the person to send (0074). The board is the component's place: there is no Code tab
  for it (decided with the person, 2026-11-23).
- **A component has one menu** (0102): the board's ⋯ opens the menu its row in the Library opens
  on a right-click. Insert, Open board, Implement, Update from code (when its code changed) and
  Copy its name, then Delete component for an app component, or for a system component Reset to
  default look when the look is the project's own and Take the look over when it is not (decided
  with the person, 2026-11-23).

## Consequences

- A change to a layout component in the code reaches every page that places it in one run, without
  redrawing a page.
- An agent's renames of a component's properties reach the pages from any task, not only this one.
- The two menus a component had, which had drifted apart (the ⋯ with Implement and Delete, the
  right-click with Insert, Open board and Copy), are one.
