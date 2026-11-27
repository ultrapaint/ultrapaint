# ADR 0155: `/init` maps the roles the system components draw with, and sets their looks

Status: accepted, 2026-11-27. Follows 0023 (the setup's steps), 0040 and 0041 (system components
and their looks), 0054 (a role the system lacks is added) and 0062 (the default look, the token
presets). Uses UP-227's way to change a look (`handoff`'s `change`).

## Context

After `/init` imported a product's design system, the canvas still drew the system components in
the default look. Their buttons were 36px where the product's were 48px, their fields see-through
where the product's were white, and their primary was a neutral the product never chose. The
components read roles (`$color-primary`, `$color-ring`, `$radius-md`), and `/init` asked nothing
about which of the product's tokens plays each role, or about the components' looks. A product
that names its colours by brand got no primary at all. Agents then patched every instance (UP-226,
finding T09: 15 design conversations).

## Decision

- **`/init`'s steps have two more**, which Define has too when it adopts the theme, since it
  reuses them: one for the **roles** before the design system is saved, and one for the
  **looks** after it. The end step is the seventh.
- **The roles come from the system components' package**, not from the task's text:
  `SYSTEM_ROLES` (`default-look.ts`) is the neutral palette's colours and the radii the default
  looks read, each with what it is for where the default look says. A role added to a component
  reaches `/init` on its own; a unit test holds every colour and radius the default looks read
  to the list.
- **A role the theme names as the components read it is mapped already.** Any other role that a
  product's token plays is added to the design system as a token whose value is a `var()` of it
  (`color-primary: var(--color-brand-ink)`), never the value copied, and described with what it
  is for and which token it stands for. The canvas declares every colour again in each theme
  (`designTokenCss`), so a brand change follows into the components in dark too.
- **What the code leaves open is asked in one `ask_user` call**, one question per role, the
  agent's pick first and the product's other candidates after it (0129, 0140). A role declined
  keeps the default look's value, and the summary names it.
- **A detailed system's colour roles are its detailed tokens** (`DETAILED_ROLES`, 0062): the step
  names those tokens to check, and maps only a missing one and the radii. A second map would
  contradict the preset's.
- **The looks are read from the product's code**: its Button, Input, Select and Badge at least,
  and any other component one of the system components stands for. Each gets height, radius,
  fill, border, font size and weight, per size and variant. With the tools, the look is changed
  one change at a time through `handoff`'s `change` (`AgentWays.setLooks`). Without them, it is
  written into the component's file, with the parts and states each look may style listed.
- **No stylesheet is written.** A role reaches the code when the person exports it through Sync
  (0074). Keeping the alias on export is UP-236's.
- **A re-import keeps the roles and looks set before**, and asks only about what changed.

## Consequences

- `/init`'s task grows from about 5,100 characters to 7,700 with the tools, and from 9,300 to
  13,100 without them, where the parts list comes along. The MCP tools' descriptions are
  unchanged, so the tool budget is too.
- `importSteps` takes what Define adds to DESIGN.md, since its steps no longer end on the one
  that writes it.
