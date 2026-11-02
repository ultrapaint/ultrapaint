# ADR 0046: What the components refactor and the board view left has one module too

Status: accepted, 2026-10-30. Follows 0037, 0038, 0039 and 0042, whose rule it applies again.
Amends 0004 (the ACP adapter keeps its updates' order, reopens by resume, signs nobody in on its
own), 0011 and 0037 (the framework seam goes), 0013 (the agent's process and environment), 0014,
0022 and 0043 (what an agent reads and the tools' hints), 0018 (a node reference wherever a tool
is pointed), 0023 (no plain elements in the inventory), 0024 (the scan reads what the reader
reads), 0025, 0027 and 0028 (one write path and one operation language for the design system,
baselines moved one way), 0041 and 0042 (the migration is retired; an instance has two origins)
and 0045 (the board view is a surface). The terms are in `GLOSSARY.md`; how tests are written is
`docs/TESTING.md`.

## Context

A fifth review, on 2026-10-30, after 0040 to 0045 replaced the repository's components with
system and app components and added the Design system and Library boards, found what those
changes left behind: rules that still assumed the catalogue was the repository's extracted
library, a board view attached to the page canvas by exceptions, and the agents reading more than
they used. Fifteen defects came with it, none tested:

- nothing could be dropped or inserted into a system or app component instance, the rule asking
  for a `children` prop no entry has;
- a checkout or hand edit of `design.tokens.json` never reached the editor;
- a node of an app component's tree on its board was taken for a page's (comment, make an app
  component, links; Zoom to selection left the board), and a node dragged off a board landed on
  the page canvas;
- the setup's inventory flagged every `<button>` and `<input>` of any repository as off the
  system, against the editor's own catalogue;
- one remembered shell permission answered every later shell command;
- a system component's Parts section wrote the whole look from the editor's copy;
- every MCP editing tool was advertised destructive and open-world (Effect's defaults);
- an agent was signed in with its first method when an error message said "auth";
- the `theme` setting did nothing;
- a node reference was honoured by one tool and ignored by the next;
- an agent's design system write did not make the code follow, and an undo between the design
  system's read and its write was lost;
- `canvas.json` was written in two formats;
- a reopened thread lost its sandbox `_meta`, and an unadvertised `plan_update` would have
  emptied the plan.

## Decision

Each concept has one module, with an interface its callers and its tests share.

**Components.**
- An instance's `from` is one of two origins (`InstanceFrom`). The migration is retired: its
  service, RPC, Sync step and conversion go, and a page that names another origin does not read,
  with a problem naming the node; a stand-in would have kept a third origin in the schema and the
  renderer.
- A component takes children when it has a default slot (`componentTakesChildren`), which insert,
  the canvas drop and the Layers drop share. A prop is a name, a type and a default.
- A component change is one thing of a look (a style at a place, an optional part, a slot's
  content, the item template) or a note added or taken out; every write of a component's file
  reads it inside the step.
- A frame draws the preview's look and a board's `css`, nothing else.
- The framework seam goes: no setting chose it and nothing draws through it since 0040. The setup
  calls the framework package's `detect` and `scaffold`; framework-api keeps the style system's
  interface (0024).
- `theme`, `componentPackages` and `/components` go; a configuration file naming the settings
  still reads.

**Agents (ACP).**
- `packages/acp`'s adapters keep the order of the agent's updates themselves, and a prompt
  returns once its updates are handled.
- A thread is reopened with `session/resume` when the agent offers it, else `session/load` with
  the replay dropped inside the adapter.
- What the agent advertised is read in one module (`negotiated`): what a prompt may carry, whether
  it takes the editor's MCP server, how it signs in. The editor never calls `authenticate` on its
  own: a sign-in is the desktop app's or the user's.
- The editor never answers a permission from memory; "always" is the agent's option.
- A turn is one module. Its files are the stamps' difference (0031), told apart by a witness of
  who wrote what meanwhile: a thread's agent (its ACP writes, its MCP calls, which the journal
  knows by the calling thread, the files its tool calls edit), the user, or nobody known. When
  another thread's turn overlapped it, or a file was written for the user or another thread, the
  files its agent was not seen writing are "changed during the turn", not its own; otherwise every
  file is, so an agent's shell edits in a thread of its own are still credited.
- Usage and the context are read from ACP's typed messages.
- A streamed chunk travels alone (`itemText`).
- The agent and its terminals are spawned by Effect's spawner, in a process group, with one kill
  policy and an environment given by `ServerConfig`.

**The server's designs.**
- One module hears every change to the designs (`DesignFiles`), sorts it once by kind and tells
  it once per content. Its two adapters are a watch of the directory and what a test reports.
- What a step writes from a file, it reads inside the step (`tx.read`, a file's codec,
  `updateFile`), so the journal's lock is the only lock. Each file has one codec.
- A page's move takes every follower along (`movePages`), links included, in app components'
  trees as well.
- `OpenProject` is the open project's services, apart from the settings in force.
- Event RPCs are derived from their schemas, and six RPCs no client used go.
- The setup's scaffold looks up its theme in what it is given (the open project's latest Figma
  import, which fails with no project open), so the editor's request handler only routes.

**The design system.**
- One write path makes the code follow every write, from what changed between before and after.
- Values change in one operation language: Sync's takes are `editsOf` operations, so they are
  validated as the inspector's are, and `setToken` goes.
- A baseline moves one way, outside the undo history.
- The themes are one module.
- The Tailwind adapter reads a stylesheet's themes once, and the scan classifies what the reader
  read, so `/init` and Sync cannot disagree.
- The inventory has no plain elements.
- The style system's interface says what any adapter can: whether the repository's styles are
  read, and why not in the adapter's words (`StyleSuggestions.supported` and `note`, the setup's
  `stylesNote`). Nothing outside the Tailwind adapter names a Tailwind version; an answer that
  still names one reads, and the version is dropped (0024).

**What agents read (MCP).**
- Each tool declares its kind once (read, edit, destructive, idempotent; a closed world).
- One resolver takes a page, a loose node or a node reference wherever a tool is pointed.
- Failures are worded for the agent by their kind.
- One outline rule serves `read_page` and `/implement`.
- The ways are per session: the server's flag and the agent's `mcpHttp`.
- The design skills go only to threads that draw designs, and to any agent as MCP resources.
- The slash commands are MCP prompts with completions.
- The page model and the component files' format are said once (`agent-docs`) for the
  instructions, the briefing and the tasks.
- A board pick crosses the wire as a `LookPlace`.

**The web editor.**
- A frame's id is parsed once (`frame-ref`) into what it names and allows.
- The main area is a `Surface` with two adapters, the page canvas and a board view, sharing one
  ground and one frame header.
- A board's picks have one grammar.
- The page layout and the selection's changes are modules of their own.
- Escape is one command.
- Leaving a board view is part of arriving somewhere.
- Nothing subscribes at import: the board view and the isolation are started.

**Tests** follow `docs/TESTING.md`:
- through the module's interface;
- awaiting the signal, never sleeping;
- each test building its own world;
- the clock, randomness and environment given as inputs;
- `pnpm test:shuffle` finds order dependence;
- no retries.

The editor's requests are tested through an in-memory RPC client over a test's own project; the
socket is kept for what the wire does.

0037's rule on seams stands. The seams added have two adapters (`DesignFiles`, `Surface`); the
ones removed had one (the framework, `DesignMdLint`).

## Explored and not done

- **A briefing of the skills' titles and summaries** (2,516 characters instead of 33,230): it
  waits for a run of the design evals, which were tuned on the full text (0043).
- **Serving the Figma and setup tools only to the threads that run them.** A session's MCP
  servers are fixed when it opens while those tasks can come in any later prompt, and Effect
  filters tools by protocol, not by token. It would save Codex about 760 tokens a turn and Claude
  Code, which loads tools on demand, none.
- **Splitting `GLOSSARY.md` into meanings and a module map**: the glossary is the index agents and
  reviews navigate by (0037), and a second file would be a second place to follow a rename.
  Instead, each overloaded word ("variant", "state", "look") is told apart in it.
- **Progress notifications for the long MCP tools**: each is one call with no steps to report.

## Consequences

- The defects above are fixed, each with a test that failed first.
- Two threads working at once, or the user editing while an agent works, no longer credits each
  turn with the others' files: a turn's end counts the files changed during it apart.
- What agents read:
  - an implement or Map/Migrate thread's briefing went from 43,100 to 9,800 characters;
  - `read_page` on the largest redesign page, from 105,760 to 2,722;
  - `get_component`'s props, from 3,343 to 1,439 characters over the system components;
  - an agent outside the editor reads the page model on connecting;
  - a design thread reads what the evals were tuned with.
- The wire and the work:
  - a streamed 4,000-character reply went from 425 KB to 22 KB on the socket;
  - a component written with the watcher on is read and published twice, not three times;
  - a canvas-node edit parses `canvas.json` once at most;
  - DESIGN.md's mirror reads the components only when one changed.
- About 2,100 lines went with the migration, the framework seam, the per-frame look and the dead
  code. `editor.ts` went from 796 lines to 247.
- The server's socket tests went from 53 to 18, and the domain tests run in-process, each in its
  own world. The suite passes shuffled and repeated, which the old shared server did not (it
  failed 5 of 52 tests shuffled).
- A change of rule is one edit:
  - what an instance may name, a component's drop target, what follows a page's move, how a file
    is read and written, what hears a change to the designs;
  - a theme convention, a tool's safety, what a board's node stands for, what a board view offers.
