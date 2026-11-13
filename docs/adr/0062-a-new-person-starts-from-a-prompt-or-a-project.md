# ADR 0062: A new person starts from a prompt or an opened project, and the look is made when they choose

Status: accepted, 2026-11-05. Amends 0050 (an agent drawing in a project with no system writes
one) and 0023 (the setup's steps start from the Design system tab). The flows are drawn on the
Onboarding canvas, `docs/designs/onboarding/`. The setup started on opening is replaced by a
suggestion in 0073, and any folder opens as a project, its settings saved on the first change, in
0092.

## Context

A new person landed on an empty canvas with wireframe starters, and a design system was made by
`/init` or a Figma import. Someone who doesn't know what a design system is had nowhere obvious
to begin, and someone with an app had to go through a setup dialog first. The person reviewed four
flows in two rounds and answered the open questions in a deck (`decisions/onboarding-2`).

## Decision

- **The start screen is for a new project.** With nothing open, it asks what the person wants to
  make: a prompt with three quiet selects like the chat composer's: where it goes (a new folder in
  `~/Ultrapaint`, or a folder they choose, empty or holding an app), the look (*Agent picks the
  look* or *I'll pick the look*) and the model (never the agent's name). A chosen folder that
  already has an Ultrapaint configuration is not prompted into: a dialog opens it as a project.
  Everything already on disk is opened with one **Open project** button (a folder here or over
  SSH), straight into the editor.
- **The look is picked by seeing it.** *I'll pick the look* opens a look page before the first
  screen: the dials on a sidebar (a preset, brand colour, greys, corners, density, surfaces,
  typeface, icon stroke, the token preset), sample screens on a canvas, and an agent box for a
  description, a site or a picture. *Agent picks the look* settles it from the prompt (0050) and
  says what it chose in three lines with a way to change it.
- **Setup is a chat.** Opening a folder for the first time sets it up in an ordinary agent chat,
  and so does making the design system from the code; both stay in the Agents list to read back
  and continue. A running chat shows as a dot on the Agents icon; there is no separate progress
  strip.
- **A project has no design system until the person makes one.** Pages in an opened app without
  one are drawn in the **default look**, and an agent says so once; no agent writes a design system
  unasked (amending 0050; a new project still gets one, since the agent or the person picks its
  look). The Design system tab shows the default look like any system, with one bar to make the
  project's own: from the code (in a chat), a new look, or Figma. Nothing else nags.
- **The code's stack is chosen at the first implementation**, each choice filled in from the look;
  a new project starts as designs only.
- **Icons are Lucide**; a look chooses only their stroke.
- **A design system has one token preset**: simple roles (shadcn's names) or detailed tokens by
  property and meaning (Atlassian's: `text.subtle`, `background.success.subtle`, `border.focus`),
  chosen with the look. Others, inspired by other systems, may follow.

## Consequences

- The welcome page, the new-design dialog and the canvas's starters are replaced; the setup
  dialog's choice moves to the Design system tab. The work is in slices,
  `docs/plans/done/PLAN-onboarding.md`.
- The start screen has no server, so the chat's preferences (each agent's models as its sessions
  last offered them, the agent and model a new thread starts with) are the user's, in
  `~/.ultrapaint/chat/preferences.json`, not a project's: the start screen reads them through
  the desktop app, and a new project offers the models the last one learnt.
- The detailed preset writes Tailwind v4's per-property namespaces (`--text-color-*`,
  `--background-color-*`, `--border-color-*`) so classes read `text-subtle`; the token table needs
  them, and the system components must read their colours through the preset, not shadcn's role
  names directly.
- The design skill's colour and foundations references name the presets; that change starts as a
  gap in `evals/gaps/`.
