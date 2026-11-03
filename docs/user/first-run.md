# First run

Start `ultrapaint` inside a repository and the setup looks at it for you: it asks only where
the designs go (`docs/designs` unless you already have one) and which stylesheet sets up your
design system, and proposes both. Where your application and its components are is filled in
quietly, as hints for the agents that implement (Settings → Repository → Implementation).
Confirm or change the proposals, and the canvas opens with **Sync**, which takes you on from
there. A repository with no React
application gets **Start a new application here** instead.

Only Tailwind v4 is read today: the tokens are its `@theme`. The setup says so when the
stylesheets set up Tailwind v3 or no Tailwind at all. Styling is a separate adapter from the
framework, so StyleX or Emotion would be another one, not a rewrite
([ADR 0024](../adr/0024-style-systems.md)). Yarn Plug'n'Play is not supported.

Nothing is installed for the designs, and none of your code runs: the canvas draws the editor's
own system components in your design system's tokens.

Started like this, without a configuration file, the top bar says **Not saved**: your settings
and agent threads go away when the tool stops. Click it to save an `ultrapaint.config.json` in
the repository. The file holds no path of your machine and is meant to be committed, so the next
person only runs `ultrapaint`. A configuration file that appears while the tool runs (a
teammate's pull, one you wrote) is taken at once, without a restart. A file still called
`ultrapaint.json`, its earlier name, is read too, and **Settings** renames it.

| Started with | Settings | Agent threads, checkpoints, caches |
|---|---|---|
| an `ultrapaint.config.json` (or `ultrapaint.json`) found from the working directory up, or `--config <file>` | that file | `.ultrapaint/` next to it, git-ignored |
| neither | not saved until you save a configuration | a temporary directory |
| `--home <dir>` (what `pnpm dev` uses) | `<dir>/settings.json` | `<dir>` |

Your pages are files in your repository and are written there in every case.
