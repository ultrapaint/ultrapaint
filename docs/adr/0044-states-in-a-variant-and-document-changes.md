# ADR 0044: A state in a variant, and a document's changes

Status: accepted, 2026-10-29. Follows 0043. Amends 0041 (a system component's look sets a state
per variant member) and 0043 (the editor is told what an edit changed, not the whole document).
The terms are in `GLOSSARY.md`.

## Context

A system component's look (0041) set style fields at its base, per variant member and per state,
but a state applied to every member alike. Button's hovers differ by variant (a filled one a
little darker, a quiet one accented, a link none), so they stayed handwritten in `look.ts`, where
the design could not change them, and a hover set in the Components tab landed on every variant.

Every change to a document reached every editor as the whole tree: on the redesign canvas's
largest page (827 nodes), a text edited sent another editor 105,790 bytes, which it decoded and
compared node by node (`shareUnchanged`) to keep what had not changed, its main thread busy about
40 ms. The editor that made the edit was answered with the whole tree too.

## Decision

**A state can be set in one variant member**: `variantStates`, per axis, per member, per state,
per part (`variantStates.variant.outline.hover.root.fill`), beside the look's `states`, and
optional, so every file before it reads. The more specific wins: a member's state over the
state's own fields, those over the member's, those over the base; disabled's win over every other
state's, and a pointer's states (hover, pressed) show only on a component that can be used.
`lookCss` writes a member's state after the states and as specific as them, the member inside
`:where()`, matched on the root, on the part Base UI marks and pinned by `data-ed-state`, and the
states' rules end with disabled and then a member's disabled. A field's value may be any CSS
over the tokens' variables (a hover's `color-mix()`). Button's per-variant hovers and a ghost
button's open popup are its default look's; Button has the `open` state. The fields sit beside
`states` rather than inside a member's parts, where a part named `states` and a state's record
would share one record that neither the schema nor its type can tell apart.

The Components tab picks a variant and a state apart: both together edit that state in that
member. Its matrix draws a row per member of the axis edited (else one a state is set in), each
in each state with its own values, and an empty field shows what it takes and from where (this
member's state, the state, the member, the base, then the default look: `look-places`).
DESIGN.md writes what a state changes as `<component>-<state>` and
`<component>-<member>-<state>`; the briefing and `/implement` describe the field.

**A document's change is told as the nodes it changed.** The server keeps the state it last
published of each document. An event is a `DocumentPatch` when it can say what changed since
that state (`from`): each node new or changed in its own fields or in the children it holds, sent
with its children named by id (`changedNodes`); a node no one names is gone. It is the whole
document (`DocumentState`) the first time, when either side does not read, when an id repeats,
or when the change is about as big as the tree. `documents.apply` answers the editor that asked
with the same changes. The editor puts a patch into its copy when the copy is at `from`
(`withChangedNodes`, every node that did not change the object it was, which `shareUnchanged`
gave before by comparing), and reads the document again otherwise: an event missed or come out of
order, a copy started from a component's file. What is told while it reads the document, or
the canvas's documents (a canvas opened, the connection opened again), waits for the answer, which
the server may have read before the change, and is taken after it (`news` in `server-data.ts`).
A snapshot on screen holds the events back, as before, and is read again
when the editor goes back to now.

## Consequences

- The design owns every state of a system component, as each variant draws it; what `look.ts`
  still writes is layout, positioning, animations and a focus outline.
- A text edited on the 827-node page sends another editor 330 bytes instead of 105,790, its main
  thread busy 12 ms instead of 40 and its documents store 0.9 ms instead of 1.5. Undo, an agent's
  edit and a file written beside the editor are told the same way, as each is a published state.
- The server holds each document's last published tree, and every change is diffed once on the
  server rather than in each editor.
