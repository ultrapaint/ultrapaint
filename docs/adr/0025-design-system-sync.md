# ADR 0025: One sync brings the design system and the code together, whatever the project starts from

Status: accepted, 2026-10-06. Builds on 0016 (Figma import), 0023 (design-system setup) and
0024 (style systems). Plan: `docs/PLAN-design-system-sync.md`.

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: the drift is what the code's comparison finds new; `SyncFacts`' unread fields and `tokensGone` go; Sync watches stylesheets only.

> Amended by [0028](0028-the-design-holds-the-values.md), 2026-10-25: values live in the design
> system, not the code; the code is compared with it as Figma and DESIGN.md are, and follows on
> export.

> Amended by [0039](0039-deep-modules-third-review.md), 2026-10-28 ([PLAN-architecture-3](../PLAN-architecture-3.md)
> step 9): a token from Figma or a Design Tokens file is named by contracts' `token-naming`. The
> type the tool gives decides the kind where it names a value type, the path's words for a
> dimension or a number; a name drops only its kind's own words (`Color/Text/Primary` is
> `color-text-primary`, not `color-primary`), and a token no word or type places is left out
> with a note the Design system panel shows.

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
code takes it (once matched; see the amendment below). Changed only in the code: Figma is behind and the code is kept. Changed on both
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

## Amendment, 2026-10-06: Figma's tokens are matched before anything is taken

Comparing by name took a Figma file's names into the code. An application that already has
tokens calls its colour `color-primary`; Figma's comes out as `color-collection-1-brand-600`, so
nothing matched, every variable counted as new in Figma, and Sync offered to add them all to
`@theme` beside the ones the application uses. A Figma file's names and palette are rarely what
the frontend wants.

**Each of Figma's tokens is matched to the code before it is compared.** A match says what a
Figma variable or style is in the code: one of the code's tokens, a new token under a name chosen
the code's way, or left out of the code. Only a matched token is compared and written; one that
is not matched is listed and never written. The matches are kept in the baseline (`sync.matches`
in `design-system.json`, by Figma's id, with the variable's place to read it and to find it again
when the id changes), so a newer import of the file is compared through them.

- **Rules take only what is certain**: the code declares a token of the same name, or exactly one
  token of the kind has the same value. When several of Figma's come to one code token by value,
  the one pointing at another (a semantic colour over its palette entry) takes it, and a palette
  entry a matched token points at is left out.
- **An agent takes the rest, with the user**: `/sync figma` (**Match with an agent** in the step)
  lists both sides in its task, asks where the meaning is the user's, and records its decisions
  with `map_values`, kind `figma`. No tool is added. It does not write the code.
- **The user reviews and changes any match** in the step, row by row, or adds or leaves out the
  rest at once, then writes as before. A match the user or an agent changes that leaves something
  to write puts the step back in front of the user.

Figma's own naming is kept for the names it proposes, with what Figma calls a collection nobody
named (`Collection 1`) and a word said twice (`Danger/Danger`) dropped.

The steps' order does not change: Figma's tokens still come before Define in the Figma-onto-code
case. Matching already keeps Figma's names out of the code, so Define describes the code's names
either way.
