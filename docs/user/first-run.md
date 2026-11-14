# First run

Start `ultrapaint` inside a repository that has no configuration file, and it reads the
repository for its settings: where the designs go (`docs/designs` unless you already have a
designs directory), which stylesheet sets up your design system, and where your application is.
The editor opens with those settings in force, and nothing is written into the folder yet: your
first change (an edit, or a prompt to an agent) makes the designs directory and saves the
settings to `ultrapaint.config.json`.

Nothing starts on its own after that. While the settings are detected and not saved, **Agents**, on
the rail, says so and offers **Set up** followed by the folder's name, and a new chat lists the same
row first. It puts `/setup` in a new chat's composer; you send it. The agent checks what detection
found against your code, saves it to `ultrapaint.config.json` with the designs directory, changes no
file of your code, and tells you in a few lines what it found. You can also skip it and design
straight away.

When the repository cannot be read for settings, the panels say **No folder open**: **Choose a
folder…** opens **Settings** › **Repository**, where **Detect again**, in its header, fills in the
fields from what it finds.

Only Tailwind v4 is read today: the tokens are its `@theme`. Settings says so under
**Stylesheets** when it cannot read yours. Styling is a separate adapter from the framework, so
StyleX or Emotion would be another one, not a rewrite ([ADR 0024](../adr/0024-style-systems.md)).

Nothing is installed for the designs, and none of your code runs: the canvas draws the editor's
own system components in your design system's tokens. A project with no design system of its own
is drawn in Ultrapaint's default look until you make one ([The design system](design-system.md)).

## Saving the settings

Started without a configuration file, the editor shows a ⚠ beside the project's name: your
settings and chats go away when the tool stops. Click it to open **Save configuration**, which
writes `ultrapaint.config.json` in the repository (the field says where; you can change it). The
file holds no path of your machine and is meant to be committed, so the next person only runs
`ultrapaint`. **Settings** offers the same as **Save to file…** in its footer, and **Apply** to
use your changes until the tool stops.

A configuration file that appears while the tool runs (a teammate's pull, one you wrote) is taken
at once, without a restart. A file still called `ultrapaint.json`, its earlier name, is read too;
the footer of **Settings** then offers **Rename to ultrapaint.config.json**.

| Started with | Settings | Chats, checkpoints, caches |
|---|---|---|
| an `ultrapaint.config.json` (or `ultrapaint.json`) found from the working directory up, or `--config <file>` | that file | `.ultrapaint/` next to it, git-ignored |
| neither | not saved until you save a configuration | a temporary directory |
| `--home <dir>` (what `pnpm dev` uses) | `<dir>/settings.json` | `<dir>` |

Your pages are files in your repository and are written there in every case.
