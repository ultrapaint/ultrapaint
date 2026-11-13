# ADR 0093: Settings are grouped by whose they are, and found by a search

Status: accepted, 2026-11-13. Amends 0079 (where Repository says where changes go), 0063 (Review
and New chats leave Settings › Agents) and 0066 (Keep findings moves to General). Shortcuts are
0090's.

## Context

The Settings dialog had four sections: Repository, Design system, Preferences and Agents. Nothing
said whose a setting was: the project's (saved in `ultrapaint.config.json` and shared), the
person's in every project (kept in the browser or `~/.ultrapaint`), or this computer's (installed
agents, the MCP command). Agents held all three in five groups on one long scroll; Preferences
was four unrelated rows, Appearance one select. "Detect from the repository" was a row whose
control rewrote the rows around it, and lists of paths were typed into text areas. The person
compared it with T3 Code's settings, approved a redesign drawn in the Settings canvas
(`docs/designs/settings/`) and answered its open choices in a deck (`decisions/settings-nov13`):
every proposal kept, a few accents to pick from, a search, and the dialog kept rather than a page.

## Decision

**The sections are listed under whose they are, and a search finds any setting.**

- Eleven sections in three groups (`apps/web/src/panels/settings-sections.ts`): **You** (General,
  Appearance, Chats, Shortcuts), **Project · its name** (Repository, Design system, Review,
  Skills), **This computer** (Agents, Connections, About). A project page names the file its
  settings are saved in beside its title; Rename and Save to file… are a notice at the top of
  Repository only while they apply. Sections needing a saved project (Design system, Review,
  Skills) wait for one. Narrow, the sections are a select over the page.
- **The search** sits at the top of the sections (`/` reaches it): it matches each setting's
  name, its section and the words it is looked for by (`SETTINGS_INDEX`), the setting's own name
  first; a result shows its section, scrolls to the row (`data-setting`) and outlines it a
  moment. Nothing found says so, with Clear search.
- **A setting changed from its default** has a reset arrow after its name, in a slot of its own.
- **General**: Display name, **Notifications** (Off, Notification, Sound, Notification and
  sound: when a chat finishes, stops or asks while the window is away; a notification asks the
  system's permission when picked), Keep review findings under Your data.
- **Appearance**: the theme as three drawings of the editor (System split in two), the
  **accent** (Ultramarine, Teal, Green, Orange, Graphite), the canvas's Grid and Comments (the
  toolbar's toggles, listed here too) and **Scroll wheel** (a mouse wheel pans or zooms; pinch
  and ⌘/Ctrl+wheel always zoom), the interface's **Text size** (the type tokens scaled by
  `--text-scale`, spacing and controls left as they are), **Increase contrast** (darker muted
  text and firmer edges in both themes) and **Motion** (System, Reduced, Full; Tailwind's
  `motion-safe`/`motion-reduce` and the camera follow it). The person's, in the browser
  (`state/preferences.ts`), drawn as data attributes on the root; the designs keep their look.
- **Chats**: New chats (agent, model, effort, permissions) and the send key, under Composer.
- **Repository**: Folder, Designs, Write a PNG of every design, then Your code (Application,
  Components as one field per folder with Add a folder); **Detect again** is in the page's
  header, with Undo in its toast. A package.json is no longer asked for (ADR 0092).
- **Design system**: a summary on a quiet surface (what it holds, Open, Update with an agent; with
  none, Read from the code and Make one with an agent), DESIGN.md's linter as a status, the
  stylesheets one field per file.
- **Review**: the level as five options each with its line in view, Standard marked
  Recommended, Custom's rows under it when chosen; the review models below.
- **Skills**: Sent as (Core, Whole, Summaries), then each skill with Read and its switch.
- **Agents**: each agent with its mark, its status as a dot and a word, where it was found, its
  one next action, and the rest in its ⋯ menu; in a browser, the agents the server starts.
- **Connections**: the MCP lines (ADR 0083) and the command's row with its status.
- **About**: the version and the app's update, the folders (ADR 0091), Documentation and Report a
  problem.

## Consequences

- `Settings › Preferences` and `Settings › Agents › Review` are gone from links: an old
  `settings=editor` opens General.
- DESIGN.md's accent is the person's to change; ultramarine stays the default and the one the
  product's pictures are drawn in.
- Every new string follows the design skill's interface words: a setting describes its on
  state, an error says what happened and how to fix it.
