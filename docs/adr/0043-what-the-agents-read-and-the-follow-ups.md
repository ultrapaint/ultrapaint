# ADR 0043: What an agent reads, and 0042's follow-ups

Status: accepted, 2026-10-29. Follows 0042. Amends 0041 (an app component's breakpoint overrides
are drawn in its instances; the migration's RPC is `migration.run`) and 0042 (a component change
covers a system component's look and a note taken out; a rename's instance edits are made inside
its undo step). The terms are in `GLOSSARY.md`.

## Context

0042 made an app component's properties change on the server, on the file as it is, but the
Components tab still wrote a system component's whole file to save its look or take a note out,
and a rename read the documents for its instance edits just before its undo step, so an edit
made meanwhile could fail it. An app component's slot laid out only as its base said, and its
breakpoint overrides were kept but not drawn. Measured, what an agent reads had grown: the tools'
definitions sat at 15,986 characters against a 16,000 budget, `get_document_format` answered 89k
characters (the page format's JSON Schema, a length's description repeated 204 times),
`/implement` gave a page as indented JSON (470k characters for the redesign canvas's largest), and
`read_design_system` carried the sync's baselines.

## Decision

- **A component change is any change the editor makes to a component's file**: an app component's
  properties and slots, a system component's look (`setLook`, its notes and envelope kept) and a
  note taken out (`removeNote`), made by `ComponentService.change` on the file as it is under the
  journal; adding a note takes the same path. `DocumentService.apply`'s `alongside` reads the
  documents as they are in the step (`ApplyStep.all`, `get`) and may give edits of its own, so a
  rename's instance edits are made of what the step holds.
- **A slot's layout turns where its container does**: the catalogue keeps an app component's
  container type per `at` key, a member's or a breakpoint's (`layoutIn`), and `slotLayoutOf` lays
  the breakpoints that hold over the instance's variant. A frame's request says the breakpoint its
  page is resolved at (`at`), and the renderer resolves an app component's tree at it after the
  instance's choices.
- **What an agent reads says each thing once, and compactly.** The tools' descriptions are terse
  and their schemas leave out JSON Schema's default (`additionalProperties: true`, written on
  every object), registered through a lean wrapper of the toolkits; the budget test is 13,600
  characters, 15% under the old one. A schema an agent is given is compacted (`compactSchema`):
  no `null` or "NaN" alternative a file never holds, flat `anyOf`s, a part written three times
  put once in `$defs`. `read_page` reads an outline (`depth`); `list_components` is a line per
  component (`componentLine`, the briefing's too) and `get_component` the detail; the sync's
  baselines stay the tool's. A task gives a design as compact JSON, a page too big for that as an
  outline to read in parts. The design skills stay in the briefing: the design evals were tuned
  with them, and making them a tool's answer is a change to measure first.
- **An edit draws again only what changed**: the web's documents store keeps the nodes the server
  sends back unchanged as the objects it had (`shareUnchanged`), and the renderer memoises a node's
  view under a scope kept while its parts are. The server keeps the documents it read by their
  text's hash, so an edit parses its page once.

## Consequences

- The Components tab, the inspector and an agent can change one component at once without one
  losing the other's change, and a rename no longer fails on an edit made while it runs.
- The tools take 12,768 characters (about 3,200 tokens), `get_document_format` 17k instead of 89k,
  `/implement` on the largest page 7.7k instead of 470k; a field edit on an 827-node page takes
  6.6 ms of the editor's main thread instead of 34, and the server answers it in 47 ms instead of
  73.
- The briefing is still about 42k characters, 37k of them the design skills: the next cut.
