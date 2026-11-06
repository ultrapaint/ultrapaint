# Plan: a new person starts from a prompt or an opened project

Status: done, 2026-11-06. Decisions in ADR 0062 (amends 0050 and 0023). The flows are
drawn on the Onboarding canvas (`docs/designs/onboarding/`); their screens show what happens, and
each slice is designed again with the design skill as it is built, not copied from them.

## Slices

Each one ships alone, in this order.

1. **The start screen** (the desktop app's welcome page). *Done.* "Start a new project": a prompt with
   three quiet selects, as the chat composer has: *where* (a new folder in `~/Ultrapaint`, or
   one chosen), *the look* (*Agent picks the look*, *I'll pick the look*) and *the model* (the
   agent's model and effort, the agent's name only when no model is known). Sending writes the
   project, opens it, and sends the prompt in a new chat with that model. A chosen folder that
   is already an Ultrapaint project opens in a dialog instead; one holding an app is opened as
   a project, the prompt sent there. One **Open project** button (a folder here, over SSH) and
   the recent projects under it. The new-design dialog goes.
2. **Setup is a chat.** A folder opened for the first time is set up by an agent in an ordinary
   chat (what detection found, the designs directory, the stylesheet), not the setup dialog; a
   running chat is a dot on the Agents icon. *Done:* the editor starts *Set up <name>* with
   `/setup` when the settings in force were detected and never saved; the agent saves them with
   `save_setup`, which writes `ultrapaint.config.json` and the designs directory. With no folder
   open at all, the panels say so and the settings choose one.
3. **The default look.** A project with no design system draws in the default look; the Design
   system tab shows it like any system, marked as the default, with one bar to make the
   project's own: from the code (in a chat), a new look, or Figma. The canvas's starters and the
   "Plain wireframes" line go. Agents no longer write a design system unasked: the server's task
   prompts change here, the skill's part starts as a gap in `evals/gaps/`. *Done:* the default
   look is a design system in `system-components/default-look`; the briefing tells agents to draw
   in it and say so once (`DEFAULT_LOOK_NOTE`); the skill's part is gap `p09`. *A new look* drafts
   a chat until slice 4.
4. **The look page.** *I'll pick the look* opens it before the first screen: a preset and the
   dials on a sidebar, sample screens on a canvas, an agent box for a description, a site or a
   picture. *Use this look* writes the design system and sends the prompt. *Done:* the page is
   the Design system place's `look` item, its samples drawn in the trial look; the agent box
   takes a description, a site or pictures, pasted, dropped or added with its picture button
   (ADR 0064). Icon stroke
   and the token preset come with slice 5.
5. **Token presets and icon stroke.** One preset per system, simple (shadcn's roles) or detailed
   (Atlassian's); the detailed one writes Tailwind v4's per-property namespaces and the system
   components read their colours through the preset. Lucide's stroke is the look's. *Done:*
   `tokenPreset` and `icons.stroke` on the design system, contracts' `token-presets` (the
   detailed tokens each role is), the role aliases in the frames' token CSS, `--icon-stroke` for
   the system components' glyphs, both dials on the look page, the briefing's note on a detailed
   system; the skill's part is gap `g51`. The code's own components (shadcn's, in the app) still
   read the roles: an implementation of a detailed system writes the aliases into its `@theme`.
6. **The stack at the first implementation.** A new project is designs only; the first
   implementation asks for the stack, filled in from the look. *Done:* `ultrapaint new
   --code=none` writes the configuration and the designs directory alone, which the start screen
   asks for; `/implement` in a project with no application starts with the stack, settled with
   the user (`first-implementation.ts`): the look's typeface package, Lucide at its stroke,
   Tailwind v4 in its token preset's names. The agent points the settings at the new stylesheet
   with `save_setup`; the rest of the setup (resolveFrom, the component library) is detected
   the next time the folder is set up.

## Notes

- The start screen has no server behind it, so it cannot ask an agent for its models. It shows
  what the chat remembers (`~/.ultrapaint/chat/preferences.json`, the user's); with nothing
  remembered, the agent's name, as the composer does.
