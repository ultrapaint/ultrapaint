# ADR 0070: Cal Sans for the headings, Figtree for the rest

Status: accepted, 2026-11-09. Amends 0058 (the editor's faces). The roles named here are
Atlassian's type tokens since 0071.

## Context

0058 set the editor in Onest, one round geometric sans for every role, with Geist Mono for values
and code. With the new mark and lockup the person chose the editor's faces again: Cal Sans for
headings and Figtree for the text.

## Decision

- **The two heading roles** (`font-heading-small` 16/24, `font-heading-xsmall` 14/20) are Cal Sans,
  loaded with `@fontsource/cal-sans`. Cal Sans has one weight, so the roles are 400 where Onest's
  were 600: a role asking for 600 would get a bold the browser draws itself. It is spaced for
  display sizes, and at 14 and 16 its words run together, so both roles open it by 0.02em.
- **Every other role** (body, label, small, caption) is Figtree, loaded with
  `@fontsource-variable/figtree`, at the sizes, weights and line heights Onest had.
- **Geist Mono** stays for values, tokens and code.
- The boards' documentation (`UI_FONT` in `boards/board-nodes.ts`) and the splash drawn before the
  editor's code arrives (`index.html`) take Figtree with the rest.

## Consequences

- `DESIGN.md` names the three faces, and the heading roles carry their weight and tracking.
- A heading role is the only place Cal Sans appears; a title written with `font-label` and a
  weight stays Figtree.
