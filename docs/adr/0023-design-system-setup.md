# ADR 0023: A design system is set up in steps the user sees, stops and redoes

Status: accepted, 2026-10-06. Builds on 0015 (the design system is imported by an agent).
Amended 2026-10-26 by [PLAN-desktop](../PLAN-desktop.md) Phase 0.4: the snapshots are kept in the
tool's own snapshot store, the code's files are listed by a walk that reads `.gitignore`, and no
git is needed (see the amendment at the end).

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: the inventory has no plain elements (the editor's catalogue is not the repository's library); a step's moves are one pure rule.

## Context

`/init` imports the design system a repository already has: it reads the Tailwind v4 theme,
looks at the components and asks the user what it cannot find out. That assumes the theme is
the design system. In most existing projects it is not: the screens use colours, spacing and
type sizes the theme never names (`bg-[#3b82f6]`, `p-[13px]`, an inline `color: "#333"`), the
default palette stands in for meaning (`text-gray-500` for muted text), and plain `<button>`s sit
beside the library's `Button`. Such a project needs a design system made from what it uses,
and then its code brought onto it.

That is too long and too consequential for one agent turn. The user has to see what each part
found and decided, stop it when it goes wrong, and start a part again without starting over.
The last part rewrites application code, which the turn checkpoints (0008) do not cover: they
keep the designs directory only, and agents write the application's files themselves.

## Decision

**The setup is five steps, in order, each ending at a gate.** Nothing goes on to the next step
until the user says so.

| Step | Done by | What it leaves |
|---|---|---|
| Inventory | the server, by fixed rules | what the code uses, value by value, and whether each value is the design system's, Tailwind's default or a raw value |
| Define | an agent | `design-system.json`, `DESIGN.md`, and the `@theme` when it proposes one |
| Map | an agent, rules first | what each value off the system becomes |
| Migrate | rules and an agent, in batches | the application's code on the design system |
| Verify | the server | the inventory again, against the design system |

Define works in one of two modes. **Adopt** is `/init`: the theme is the design system, to be
described. **Propose** makes one from the inventory: a palette and a semantic layer from the
colours in use, a scale from the spacing and type sizes in use, put to the user on question
cards, then written into the stylesheet's `@theme`. The inventory recommends a mode (a theme
with fewer than three colour tokens of its own, or code whose colours are mostly off the
theme, gets Propose) and the user can pick the other one.

**Map reads the code again, against the saved design system, and decides what each value off it
becomes**: a token of its kind (`color-primary`, `spacing-3`, `text-sm`), an elevation layer, the
library's component for a plain element, or kept as it is. Rules take the exact matches first (a
hex equal to a token's value, `16px` on a 4px scale, a plain `<button>` where the library has
`Button`); the agent decides the rest, asking the user where meaning is theirs, and the user can
change any decision in the Setup view. Nothing is written to the code.

**Migrate rewrites the code a batch at a time.** A batch is the files of one directory, twelve at
most, that the mapping touches. When the agent takes one, the rules rewrite what is mechanical —
a class (`hover:bg-[#3b82f6]/50` becomes `hover:bg-primary/50`, variants, sign and opacity kept),
an inline style value, a stylesheet declaration (`var(--color-primary)`, `--spacing(3)`) — and the
agent is told what is left in each file with what it becomes: a colour in a constant, a plain
element to replace with the component. It then runs the repository's type check and linter. Each
batch has its own pair of snapshots, so it is reverted on its own and taken again.

**Verify reads the code once more** and says how many uses are still off the system against how
many there were when the mapping was made, and how many of those the mapping keeps on purpose.

**A step is todo, active, review, stopped or done.** Starting a step that needs an agent opens a
thread linked to it, with `/design-system <step>` in its composer. The agent says it is finished
with `finish_setup_step`, which puts the step in review; the user can also mark it done
themselves. Stop cancels the thread's turn and keeps what was done. Resume opens the same
thread again.

**Every step is a pair of snapshots of the whole working tree, taken with git** (amended: in
the tool's snapshot store, below). When a step
starts and when it stops or is done, the server writes the working tree, untracked files
included and ignored files left out, into a tree object through a temporary index, and points a
ref under `refs/ultrapaint/setup/` at it. The user's index, branch and stash are not touched.
Redoing a step puts back every file that this step or a later one changed, as it was when this
step started, and the later steps go back to todo. The editor lists those files before anything
is put back. Files the user changed outside the steps are left alone unless a step changed them
too.

**The setup is kept in the state directory**, with its inventory, not in the repository: the
snapshots are refs of this clone, so a setup committed for a teammate would offer redos their
clone cannot do. What the steps write, the design system and the code, is in the repository
like everything else.

**Reading and rewriting the code is the framework's.** What counts as a value of the design system
is a Tailwind question, so `packages/framework-react-vite` reads it: the string literals of the
source files (class names, colour literals), the JSX `style` objects, plain elements where the
catalogue has a component, and the declarations and `@apply` of the stylesheets, outside the
theme. Every use is recorded with where it is written, so the same reading rewrites it. The rules
of the mapping and the rewrite live there too. It is synchronous and pure; the server lists the
files (with git, as amended below: by a walk that reads `.gitignore`), reads them, hands them
over one by one and writes back what changed.

**A step's agent reads in its task and acts through tools.** The inventory and the mapping a step
needs are in the task `/design-system <step>` expands into, read once; the tools are only what
acts (`map_values`, `next_batch`, `finish_setup_step`), since every session carries the editor's
tools on every turn.

## Consequences

- The Design system panel has a Setup view: the steps, what each one found or wrote, its thread,
  and the gate. The panel's Tokens view is where Define's result is reviewed.
- Agents get `finish_setup_step`, `map_values` and `next_batch` on the editor's MCP server, and
  `/design-system define|map|migrate` expands into the step's task.
- The setup needs a git repository; without one a step cannot start, and says why (amended:
  it needs none).
- Map and Migrate need the editor's MCP server; started without it, their task says so.
- What the rules cannot rewrite in place — a string with an escape in it, a colour in a constant,
  an element — is left to the agent, never guessed at.

## Amendment, 2026-10-26: snapshots without git

The tool no longer needs git (PLAN-desktop D9), so the setup's snapshots move out of it (D10).

- **The snapshots are in the tool's snapshot store**, `store/` in the state directory: each
  file's contents once, named by their SHA-256 (`objects/`), and one manifest per snapshot naming
  the hash of every file it holds (`manifests/<id>.json`, the id being the hash of that list).
  A snapshot costs only the files that changed since the last one; a file whose time and size
  did not move is not read again. A ref per setup (`refs/setup/<project>/<id>`) keeps a snapshot;
  one no step names any longer is let go, and what no ref keeps is removed with the contents only
  it named. The same store is meant to carry the revision history later
  ([PLAN-revision-history](../PLAN-revision-history.md)).
- **The files are those the folder's `.gitignore` keeps.** The server walks the folder and reads
  every `.gitignore` in it (and `.git/info/exclude` when there is one) as git does; `node_modules`,
  `dist`, `.git` and the state directory are never walked. Git need not be installed.
- **Redoing puts the files back from the store**, keeping each file's permissions; the user's
  index, branch and stash are not involved at all. A setup started by a version that kept its
  snapshots in git cannot be redone from those snapshots: the redo says so, and the setup is
  started again from its first step.
- The store is in the state directory, so it is kept in every storage mode; an unsaved session
  keeps it in its temporary directory, and moves it with the rest when the session is saved.
  A first snapshot copies the project's kept files there, a few megabytes for most projects.
