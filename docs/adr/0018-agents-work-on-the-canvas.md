# ADR 0018: Chats are found by what they work on, and agents' work shows on the elements

Status: accepted, 2026-09-29. Extends 0014 and 0015.

The editor was redesigned with the tool itself: the pages are in `docs/designs/redesign/`, and
`ultrapaint.json` at the root opens this repository in the editor.

## Decision

**Three selection colours, each with one meaning.** Blue (`--selection`) is a plain element: a
row, a column, a group, a text, an image. Purple (`--component`) is a component of the library,
because what it offers is its props. Pink (`--agent`) is an agent, whichever agent: its button,
its work on an element, its status in the chat. The agent's own brand colour is never used; the
tag names the agent instead.

**A rail with words.** Each panel is named under its icon. Settings sits at the bottom, then the
git user: `user.name` and `user.email` from the repository's git configuration, not an account.
A dot in the icon's own corner says an agent is working (Chats) or that a turn changed files
nobody looked at yet (Changes).

**Chats are a list first.** Each thread shows a picture of what it works on, its scope: the first
node its first prompt attached, or the page. The picture is drawn by the preview, kept in the
state directory under the document's hash, and drawn again only when the document changed. The
thread also shows its last line and whether it waits on the user (`summary`, derived when the
list is read and kept up to date from the transcript's events). Opening one gives the thread, its
scope pinned under its header.

**The composer's context is chips.** Elements added from the canvas (Add to chat, the toolbar, the
right-click menu) are chips in their selection colour, removable one by one. When nothing was
attached, the selection goes along, shown dashed; the page goes only when it is attached.

**A Vibe toolbar over the selection, not in Design.** It offers only what the design system has:
a component's own `cva` variants, a text's styles, the colour, radius, spacing and shadow tokens
of a container. Every control is a select showing its value alone; the menu names the prop or the
token, and previews a component's values drawn by the real component. Two props at most, then
`+ n` with all of them, so a component with twenty options stays one line. The selection's name
sits on its edge, with a menu to its parents and children.

**Agents' work shows where it lands.** The strip under the canvas and the "agent updated" badge
are gone. `apply_operations` called from a thread publishes `agent.edited` with the nodes the
operations touched (`touchedBy`), and `focus` takes `nodes` and `action` to say what the agent is
about to change. The canvas draws those nodes pink with a light passing through, the agent's
name and action on the first one's edge; the text and images announced and not yet changed are
skeletons, drawn by the preview (`ed:skeleton`). When the turn ends they say "Changed" for a
moment.

**A node can be linked and referred to.** `/orders#c_8x2k1q` (and `canvas#id`,
`marketing:/pricing#id`) names a node; its id is kept in the page file, so the reference lasts as
long as the node. The right-click menu copies it, or a link (`?route=/orders&node=c_8x2k1q`) that
opens the editor with the node selected and in view. The MCP tools take a reference where they
take a route or a node id.

## Consequences

- The picture frame of the preview (`specimen`) draws without transitions or animations: a
  component that animates between states was captured half way, in thumbnails, screenshots and
  the toolbar's previews alike.
- A component's import is its package's `exports`, else the package's own path alias
  (`@/components/ui/button`), else its name when it has an entry, else none: an import that does
  not resolve broke every page. The preview's list of component modules follows the catalogue
  both ways.
- Tailwind's `@theme inline` variables are declared again on every element in the preview, so a
  design drawn in a theme's scope (a `.dark` wrapper) reads that theme.
- `set_frame` sizes a page's frame, so an agent can see a long page whole.
- Several nodes of one frame can be selected: Shift-click on the canvas or in the layers, or a
  marquee drawn from the page or from a container that is not selected (a selected node, a text, a
  picture or a component is dragged instead, as in Figma). The toolbar over them offers what they
  share when they are of one kind, set on all of them, "mixed" where they differ, wrapping
  siblings, and all of them to the chat. Delete and ⌘G act on all of them.
- A prompt sent while the agent works waits in the thread's `queued` list and goes when the turn
  ends by itself; after a turn that was stopped or failed it waits for the user's Send now. A queued
  prompt can be taken back to be edited or dropped.
- A thread does not float over the canvas: the panel is where it lives.
