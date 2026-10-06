# ADR 0025: One sync brings the design system and the code together, whatever the project starts from

Status: accepted, 2026-10-06. Builds on 0016 (Figma import), 0023 (design-system setup) and
0024 (style systems). Plan: `docs/PLAN-design-system-sync.md`.

## Context

A project comes to the tool from one of four places: nothing at all; an application with
components and colours but no design system; a Figma file, with or without an application; or
a design system and the code it describes, which drift apart as people change one and not the
other. The tool had an answer for parts of each — the first-run form, `/init`, the step-by-step
setup, the Figma import — and left the user to know which to use and in which order. A
repository whose components lived inside its application (`front/src/components`) got none of
them right: detection only proposed component libraries that were packages, and the agent
asked to fix it wrote a configuration file the running editor never read.

## Decision

**One Sync, which works out the case.** The Design system panel's Sync view (the panel's former
Setup view), `/sync` in the composer and the panel's empty state all lead to it. The server
reads what the project has — an application, its components, its tokens, a design system, the
newest Figma import — and lays out the steps:

| Found | Case | Steps |
|---|---|---|
| no application | scratch | start an application → define |
| a Figma import, no application | figma | start an application → Figma's tokens → define → frames to pages |
| an application, no design system | code | the setup's five steps (0023), map, migrate and verify offered |
| a Figma import and an application | figma-code | Figma's tokens → the setup's steps → frames to pages |
| a design system | maintain | describe what changed → Figma's tokens and frames, when there is a file |

Settings that point nowhere — no component directory, one with no components, no stylesheet —
put a step first in every case: detection runs again and its proposal is applied once the user
has seen it. The plan is worked out again whenever what it reads changes (the design system,
a step, the project, a stylesheet or component file) and pushed to the editor; the rail's
Design system button has a dot while something is waiting.

**Values live in the code.** A token's value is read from where the style system declares it
(0024), every time; `design-system.json` keeps what the tokens and components are for. The
file leaves a token's value out when the code declares the token, and an older file that has
one is read with the code's value over it. Editing a value in the panel writes the code. Drift
of values between the two cannot happen; what is left to sync is which tokens and components
exist, which `/sync describe` has an agent bring up to date, and what the design system leaves
out on purpose (`omitted`).

**Figma is imported, and compared against a baseline.** Importing a `.fig` opens the Sync view:
its variables and colour styles become tokens named the way the code names them, and each is
compared with the code's and with what the last sync agreed on (`sync` in `design-system.json`,
committed, so a teammate starts from the same point). Changed only in Figma, or new there: the
code takes it. Changed only in the code: Figma is behind and the code is kept. Changed on both
sides, or differing with no baseline: the user picks, in the view. The frames then become pages
as before (0016). Exporting to Figma is not done.

**The configuration file is `ultrapaint.config.json`.** It says what it is next to the designs'
own JSON. `ultrapaint.json` is still found (the new name wins in the same directory), and
Settings renames it. An unsaved session follows a configuration file that appears in the
repository, without a restart. Agents never write it: `/init` and `/import-figma` stop and send
the user to Sync when the editor sees no components.

**Detection finds an application's own components.** When no package of the repository is a
component library, the anchor's own `src/components` (or `components`, `src/ui`, …) is
proposed. A component that no export or path alias reaches is imported by a path from the
anchor's root (`/src/components/header`), which the preview resolves against the anchor.

## Consequences

- `/sync` alone opens the view; `/sync describe` is an agent's task. No MCP tool is added.
- The setup's steps keep their snapshots, stop, resume and redo; the sync's own steps write
  the code through the style system and are undone from the toast that reports them.
- A Figma comparison that finds nothing to name (no variables, no styles) says so and asks
  nothing. Variables that are neither colours nor numbers on a known scale are left out, with
  a note.
