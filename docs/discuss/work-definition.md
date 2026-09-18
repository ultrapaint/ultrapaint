# Work definition: ultrapaint v1

Status: draft for review, 2026-09-16. Source of truth for the goal: [`docs/PROJECT-GOAL.md`](../PROJECT-GOAL.md).
This document turns the goal into decisions, epics, stories with acceptance criteria, spikes,
and a delivery order. It is the DISCUSS-wave artifact; DESIGN (architecture, ADRs) follows it.

---

## 1. What we learned before defining the work

Facts that shape the scope. Each one is either verified in a sibling repository or in the
public reference material.

**The first target repository is the epicparty monorepo** (`~/Code/epicparty/epicparty-1`,
`github.com/epicparty/epicparty`).

- pnpm workspace driven by `vite-plus` (`vp`), Biome via `ultracite`, TypeScript, Vitest.
- React 19.2, Tailwind CSS 4.3, Base UI 1.7 (not Radix), `class-variance-authority`, Lingui for i18n,
  TanStack Router and Start for the product apps.
- Design system split in two packages: `@epicparty/ui-design-system` owns semantic `--ds-*` CSS tokens
  and the Tailwind `@theme` mapping; `@epicparty/ui-components` owns about 100 shadcn-derived,
  Base UI-backed components with Storybook stories and local usage docs.
- Styling rule set is written down (`docs/standards/STYLES.md`, `ui/components/AGENTS.md`): token
  names, class ordering inside `cn()`, no `.dark` class, variants through `cva`. The editor must
  write code that passes these rules, or the design will not survive review.
- Product apps need Convex, SST and env files to start. The design preview must not depend on
  that stack.

**A previous attempt exists and points the other way.** `~/Code/epicparty/epicparty-design` is a
fork of OpenPencil: a vector editor with binary `.fig` files, a local MCP bridge, and a
Codex-only native companion. Its `LOCAL-POC.md` records the pain the new goal is reacting to:
binary files do not merge, the design lives outside the code, and the agent integration is
provider-specific. Two ideas from it are worth keeping: strict loopback and path guarding for
anything that touches the machine, and serialising mutating tool calls through one lease with
one undo entry per call.

**T3 Code is the structural reference** (`github.com/pingdotgg/t3code`).

- `apps/web` (React, Vite), `apps/server` (Node, WebSocket, Effect), `apps/desktop` (Electron
  wrapping web), `packages/contracts` (Effect Schema types for everything on the wire),
  `packages/shared` (runtime utils), `packages/client-runtime` (client logic shared across
  surfaces), `packages/effect-acp` (an ACP client and agent implementation on Effect RPC).
- Server pattern: typed requests become commands, a pure decider produces events, a projector
  derives the read model, side effects run in reactors that emit receipts.
- Provider complexity is confined to adapters. That is the exact property the goal asks for,
  except we allow only one adapter type: ACP.
- T3 Code's own preview is a desktop-only Chromium webview. We cannot copy that: our canvas is
  the product and must work in the browser, so screens are embedded as iframes inside the web app.

**ACP** (`agentclientprotocol.com`).

- JSON-RPC over stdio for local agents. Core methods: `initialize`, `session/new`,
  `session/load`, `session/prompt`, `session/cancel`, `session/update` notifications (message
  chunks, thoughts, tool calls, tool call updates, plans), `session/request_permission`, plus
  client-side filesystem and terminal methods the agent may call.
- TypeScript SDK: `@agentclientprotocol/sdk`. Protocol v2 is being finalised alongside v1, so
  the protocol layer must be isolated behind our own package.
- Adapters: Claude Code via Zed's `claude-agent-acp`, Codex via `agentclientprotocol/codex-acp`,
  Gemini CLI speaks ACP natively.

**React 19 removed `_debugSource`.** Mapping a DOM element back to its JSX source location needs
our own dev-only JSX transform that stamps file, line and column on elements. This is the one
piece of the system with no off-the-shelf answer and is the first spike.

---

## 2. Decisions and assumptions

Stated so they can be overruled before DESIGN starts. Each is the recommended option.

| # | Decision | Why |
|---|----------|-----|
| D1 | ultrapaint is a standalone tool in its own repository, generic over a target repository. epicparty is the first target and the acceptance environment. | The goal says "runs locally against a code repository". Building it inside epicparty would couple the tool to one codebase. |
| D2 | A **screen** is a TSX file in a configured designs directory of the target repo that default-exports a React component. A **flow** is a subdirectory. Canvas layout (position, size, viewport preset) lives in a text file next to the screens, e.g. `designs/<flow>/canvas.json`. Superseded by [ADR 0012](../adr/0012-spaces-pages-router.md): a screen is a **page**, its path is its route, and a flow is a **space** that owns one router. | Everything text, everything in the repo, everything diffable. TSX per the goal's storage section. |
| D3 | The preview runs on a **dedicated Vite design host** inside the target repo: one Vite config that resolves the target's design system and providers (theme, fonts, i18n) but not its product backend. Each screen is served at its own URL and embedded as one iframe per screen on the canvas surface. | Product apps need Convex and SST. A design host starts in seconds and isolates screens from each other. Per-screen iframes give real scrolling, real events and crash isolation. Validated by spike S1. |
| D4 | Element to source mapping uses a dev-only JSX transform (Vite plugin) that adds `data-ed-src="<file>:<line>:<col>"` and the component name to every JSX element. Only files under the designs directory and the design system are stamped. | React 19 offers nothing else. Validated by spike S2. |
| D5 | Edits are **AST edits on TSX** performed by a backend code-edit service, then formatted with the target repo's formatter. Three edit kinds: Tailwind utility in `className`, JSX attribute (component prop), and JSX text. No inline `style` writes. | Writing Tailwind and props is what keeps the output reviewable and consistent with the target's standards. |
| D6 | Stack mirrors T3 Code: pnpm, `vite-plus`, React, TypeScript, Effect and Effect Schema for server and contracts, WebSocket between web and server, Biome. Tool-local state (settings, threads, transcripts) lives under `~/.ultrapaint/`; design state lives only in the target repo. | The goal asks to reuse T3 Code's structure and conventions. |
| D7 | The editor UI has its **own** component set (Tailwind, Base UI), not `@epicparty/ui-components`. | The tool must not depend on the repository it edits. Open question Q1 records the alternative. |
| D8 | v1 supports Vite-based React targets only. | Both the first target and the reference use Vite. Other bundlers are out of scope. |
| D9 | ACP is wrapped in our own `packages/acp` on top of `@agentclientprotocol/sdk`. Agent launch configurations are data: display name, command, args, env, auth hint, and how to discover models. Two ship in the box: Claude Code and Codex. | Isolates protocol churn (v1 to v2) and keeps provider knowledge out of the editor. |
| D10 | Browser first. The Electron shell is a separate milestone after agents work. | The goal states the shell adds no features. |
| D11 | Single user per running instance in v1. Concurrency means humans and agent threads on one machine, not multiple people. | Keeps the edit-serialisation problem tractable. |

---

## 3. Scope map

Epics, in delivery order. Each milestone ends in a demo statement that can be checked by hand.

| Milestone | Epics | Demo |
|-----------|-------|------|
| M0 Foundations | E0 | `pnpm dev` starts server and web on one origin; settings point at epicparty; the backend lists the screens it found. |
| M1 Walking skeleton | E1, E2, E3 (read-only) | One real epicparty screen renders live on the canvas. Clicking a button selects it in the layers panel and the inspector shows its actual padding, font and colour, with the class that produced each value. |
| M2 Edit loop | E4 | Changing padding in the inspector rewrites the Tailwind class in the TSX, the canvas updates within the latency budget, and `git diff` shows a one-line change that passes the repo's lint. |
| M3 Many screens | E5 | A four-step wizard sits on one canvas, pans and zooms smoothly, positions survive a restart and are committed as text. |
| M4 Real components | E6 | A design-system `Button` is inserted from the palette into a card; its `variant` is switched from a dropdown; the import and JSX were added by the tool. |
| M5 Agents | E7 | Two threads run at once: Claude Code adds a new screen to the flow while Codex restyles a header. Both changes appear on the canvas as they land. A permission request is approved from the thread UI. |
| M6 Versioning and safety | E8 | Changed files are listed and committed from the tool. Manual and agent edits to the same file never corrupt it. |
| M7 Desktop shell | E9 | The same web bundle runs inside Electron with the server bundled and a native folder picker. |
| Checkpoint | E10 | A written verdict on whether TSX stays the canonical format. |

Out of scope for v1: Figma import and export, MCP server or MCP inside threads, remote or
multi-user access, non-Vite targets, vector or freeform drawing, cloud accounts.

---

## 4. Stories and acceptance criteria

Sizing: S under a day, M one to three days, L a week or more. Stories inside an epic are
ordered by dependency.

### E0 Foundations

**E0.1 Monorepo scaffold in the T3 Code shape** (M)
Given a fresh clone, when a developer runs install and `pnpm dev`, then a server and a web
client start on one origin with the web client proxying the API, and the workspace contains
`apps/web`, `apps/server`, `packages/contracts`, `packages/shared`, `packages/client-runtime`.

**E0.2 Typed wire contract** (M)
Given a request or event defined in `packages/contracts` as an Effect Schema, when server or
client code uses it, then the type is inferred on both sides and any payload failing decoding is
rejected with a typed error. There is a request/response channel and a server-push subscription
channel over one WebSocket.

**E0.3 Settings: target repository** (M)
Given the settings screen, when the user enters a repository path, a designs directory relative
to it, and optionally the design system package name, then the backend validates that the path is
a git repository with a `package.json`, persists the settings under the tool home, and refuses
paths outside the chosen repository for every later file operation.

**E0.4 Project open and health** (S)
Given valid settings, when the app loads, then the header shows the repository name, branch, and
whether the preview host is running, and every backend failure surfaces as a readable message,
never a silent blank.

### E1 Preview runtime

**E1.1 Design host starts inside the target repo** (L)
Given a target repo with settings configured, when the user opens the project, then the backend
starts a Vite design host with the target's Tailwind entry, design tokens, fonts and theme
providers, without the product backend, and reports the port. Stopping the app stops the host
by the PID it spawned, never by pattern matching.

**E1.2 Screen discovery** (S)
Given a designs directory, when it contains `*.tsx` files, then the backend lists them as screens
grouped by subdirectory, and additions, renames and deletions on disk appear in the list within
one second.

**E1.3 One screen on the canvas** (M)
Given a discovered screen, when the user selects it, then it renders inside a frame on the
canvas at a chosen viewport preset (mobile, tablet, desktop, custom) and is fully interactive:
buttons click, inputs type, menus open.

**E1.4 Hot update preserves state** (M)
Given a rendered screen, when its file changes on disk by any writer, then the frame updates
through HMR without a full reload, the current selection remains selected if the element still
exists, and the update is visible within 500 ms of the write on the reference machine.

**E1.5 Errors stay on the frame** (S)
Given a screen with a compile or runtime error, when it renders, then the frame shows the error
with file and line instead of a blank, and the rest of the canvas stays usable.

### E2 Layers are the DOM

**E2.1 Element tree** (M)
Given a rendered screen, when the layers panel opens, then it shows the live element tree with
design-system component instances as named nodes (`Button`, `Card`) wrapping their host
elements, host elements by tag and a short summary (`div.flex`, `p "Welcome"`), and text
nodes summarised rather than listed.

**E2.2 Two-way selection** (M)
Given the layers tree and the canvas, when the user clicks an element in either, then the other
highlights the same element, the canvas draws a selection outline with size in pixels, hover
draws a lighter outline, and the inspector loads. Selection is expressed as a source location
plus a DOM path, so it survives re-renders.

**E2.3 Tree stays live** (S)
Given the tree, when the DOM changes from interaction or an HMR update, then the tree updates
within one frame of the change, keeps expanded and collapsed state, and never resets scroll.

**E2.4 Keyboard navigation** (S)
Given a selected element, when the user presses arrow keys, then selection moves to
sibling, parent or first child like Figma; Escape selects the parent; a modifier click on the
canvas selects the deepest element instead of the nearest component instance.

### E3 Inspector, read side

**E3.1 Property groups** (L)
Given a selected element, when the inspector renders, then it shows Layout (display, direction,
wrap, gap, align, justify), Size (width, height, min, max), Spacing (four padding and four
margin fields), Typography (family, size, weight, line height, letter spacing, alignment),
Colour (text, background), Border (width, colour, radius) and Effects (opacity, shadow), each
as a Figma-style control.

**E3.2 Provenance per value** (M)
Given a value in the inspector, when it is displayed, then it is tagged with its origin: a
Tailwind utility (named), a component prop, a design token (named), inherited, or browser
default. Values that cannot be attributed to editable source are shown read-only with a reason.

**E3.3 Component props section** (M)
Given a selected design-system component instance, when the inspector renders, then a
Component section lists its props with current values and types, using the extracted metadata
from E6.1.

### E4 Editing loop

**E4.1 Tailwind-backed edit** (L)
Given a selected element with a Tailwind-backed value, when the user changes it in the
inspector, then the backend rewrites the element's `className` in the TSX: it replaces the
conflicting utility, keeps the class order rules of the target repo, runs the target's
formatter on the file, writes atomically, and the canvas reflects the change within 300 ms.
The resulting diff touches only the changed attribute.

**E4.2 Prop edit** (M)
Given a selected component instance, when the user changes a prop, then the JSX attribute is
added, changed or removed with the right literal kind (string, number, boolean, enum member),
and unchanged attributes keep their order and formatting.

**E4.3 Tokens first** (M)
Given a colour, spacing, radius or typography control, when it opens, then design-system
tokens and Tailwind scale steps are offered first with previews, an arbitrary value is allowed
and written as a Tailwind arbitrary value, and the last used tokens are pinned.

**E4.4 Inline text edit** (M)
Given a text element, when the user double-clicks it on the canvas, then the text is editable
in place and committing rewrites the JSX text or string literal. If the text is wrapped in a
localisation macro, the message source is edited and the tool says so.

**E4.5 Undo and redo** (M)
Given a sequence of inspector edits, when the user presses undo, then the previous file
content for that edit is restored and the canvas follows; redo reapplies. An external change to
the same file since the edit invalidates the older entries and the tool says why.

**E4.6 Unmappable selection** (S)
Given a selected element whose source is outside the designs directory or the design system,
when the user tries to edit, then the inspector explains where the element comes from and
offers the nearest editable ancestor or the owning component instance.

**E4.7 Structural edits** (M)
Given the layers tree, when the user drags an element to a new position, duplicates it, or
deletes it, then the JSX is moved, copied or removed accordingly and imports that become unused
are removed.

### E5 Infinite canvas with many screens

**E5.1 Pan and zoom** (M)
Given the canvas, when the user scrolls, pinches, holds space and drags, or uses zoom presets,
then the surface pans and zooms around the cursor at a steady frame rate, frames stay crisp at
every zoom level, and "zoom to fit" and "zoom to selection" exist.

**E5.2 Several screens, one surface** (L)
Given a flow directory with several screens, when it opens, then every screen is a live frame at
its saved position and size, and moving or resizing a frame writes the layout file in the
designs directory as formatted text.

**E5.3 Screen lifecycle** (M)
Given the canvas, when the user creates a screen (blank or from a design-system layout
template), renames, duplicates or deletes one, then the backend performs the file operation, the
layout file is updated, and the new screen renders immediately.

**E5.4 Frame chrome** (S)
Given frames on the canvas, when the user looks at them, then each shows its name and viewport
preset, snaps to neighbours while dragging, and can be arranged with align and distribute.

**E5.5 Frame virtualisation** (M)
Given more frames than fit the viewport, when the user pans, then offscreen frames are unmounted
or paused and remounted on return, and 12 mounted screens keep pan and zoom at a steady frame
rate on the reference machine.

### E6 Design with real components

**E6.1 Component metadata extraction** (L)
Given the configured design-system package, when the backend indexes it, then it produces a
catalogue of exported components with prop names, types, enum members, defaults, required flags
and `cva` variants, cached and refreshed when the package changes.

**E6.2 Palette** (M)
Given the catalogue, when the palette opens, then components are listed by category with search
and a rendered preview taken from their Storybook story or default render.

**E6.3 Insert** (M)
Given a selected container, when the user drops a component from the palette, then the import
is added, the JSX is inserted at the drop position with required props filled from defaults,
and the element renders and is selected.

**E6.4 Typed prop controls** (M)
Given a component prop, when it is shown in the inspector, then enums become dropdowns,
booleans toggles, numbers steppers, strings inputs, and props typed as React nodes are shown as
a summary with a jump to the child in the layers tree.

**E6.5 Scope of the palette** (S)
Given settings, when the user adds another package or a directory of product-local components,
then they appear in the palette under their own group and are stamped and editable like the
design system.

### E7 Agents through ACP

**E7.1 ACP package** (L)
Given `packages/acp`, when the backend spawns an agent process, then it performs `initialize`
with client capabilities, negotiates the protocol version, and exposes typed methods for
session creation, prompting, cancellation, updates and permission requests. Nothing outside the
package imports the SDK.

**E7.2 Agent launch configurations** (M)
Given the built-in configurations for Claude Code and Codex, when the user picks one, then the
backend resolves the binary, environment and authentication hint from the configuration only;
adding a third agent such as Gemini CLI is a configuration entry, verified by an acceptance test
that adds one without touching editor or server code.

**E7.3 Thread and prompt** (L)
Given a new thread with an agent, when the user sends a prompt, then the backend starts a
session with the target repository as working directory, streams message chunks, thoughts,
plans and tool calls into the thread as they arrive, and marks the turn complete with the stop
reason.

**E7.4 Permission requests** (M)
Given an agent requesting permission, when the request arrives, then the thread shows the
tool, the affected paths or command and the offered options, the user chooses, and the
choice can be remembered for the thread.

**E7.5 Design context in prompts** (M)
Given a selection on the canvas, when the user writes a prompt, then the composer can attach
the selected screen files, the selected element's source location and a screenshot of the
frame as context blocks, and the agent receives them as ACP content.

**E7.6 Parallel threads** (M)
Given two threads with different agents, when both run turns, then each streams independently,
each can be cancelled alone, and the thread list shows per-thread state.

**E7.7 Agent edits reach the canvas** (S)
Given an agent editing a screen file, when the write lands, then the canvas, layers and inspector
update through the same path as manual edits, and the thread shows a list of files changed
during the turn with a diff per file.

**E7.8 Client filesystem and terminal for agents** (M)
Given an agent calling the client's read, write or terminal methods, when the path or command
is inside the target repository, then the backend serves it; when it escapes the repository
(including through symlinks), the call is refused with a reason.

**E7.9 Persistence and resume** (M)
Given threads and transcripts stored under the tool home, when the app restarts, then threads
reopen with their history, and an agent that supports session loading resumes the session.

**E7.10 Modes and configuration options** (S)
Given an agent advertising session modes or configuration options, when a thread is open, then
the UI shows them as generic selectors driven by the advertised data, with no per-agent code.

### E8 Versioning and safety

**E8.1 One writer per file** (M)
Given manual edits, agent edits and external edits on the same file, when they overlap, then
backend edits are serialised through a per-file lease, a stale edit is rejected and re-read
instead of overwriting, and the file is never left half-written.

**E8.2 Git inside the tool** (M)
Given the target repository, when the user opens the changes panel, then changed design files
and layout files are listed with a diff, a commit can be made with a message, and the current
branch is shown. All git calls run in the backend.

**E8.3 Turn checkpoint** (M, stretch)
Given an agent turn, when it starts, then the backend records a checkpoint so the user can
review the turn's diff and revert it as one unit.

### E9 Desktop shell

**E9.1 Electron wrapper** (L)
Given the web bundle and server, when packaged, then the desktop app runs them locally with a
native folder picker for the repository and nothing else that the browser build lacks. The
editor source has no Electron imports.

### E10 Storage format checkpoint

**E10.1 Format verdict** (S)
Given M5 is complete, when the team reviews, then a memo records edit reliability, agent success
rate, merge behaviour and review readability with TSX as the format, and recommends keeping TSX
or defining a text-based screen format with a translation path.

---

## 5. Spikes

Timeboxed, throwaway code, findings written to `docs/feature/<spike>/findings.md`. All four
must pass before E1 to E4 and E7 are designed in detail.

| Spike | Question | Pass condition |
|-------|----------|----------------|
| S1 Canvas embedding | Can eight live iframes on a CSS-transformed surface pan and zoom at a steady frame rate and stay crisp, and can pointer events be routed to the right frame? Compare one iframe per screen with one iframe hosting all screens. | 60 fps pan with 8 frames on the reference machine, text crisp at 50 % and 200 %, clicks reach the frame under the cursor. |
| S2 Source mapping and edit round trip | Can a Vite plugin stamp JSX with file, line and column in React 19, and can an AST edit change a Tailwind class and land through HMR quickly with stable formatting? Compare `oxc`, Babel and `ts-morph` for the edit. | Click to source location is exact; class edit round trip under 300 ms; `ultracite check` passes on the edited file; the diff is one attribute. |
| S3 ACP round trip | Do `claude-agent-acp` and `codex-acp` complete initialize, session/new, prompt, streamed updates, a permission request and cancel from a Node host, and what do their launch configurations need? | Both agents finish a prompt that edits a file in the target repo, a permission round trip works, and cancel stops the turn. |
| S4 Component catalogue | Can prop types, enums, defaults and `cva` variants be extracted from `@epicparty/ui-components` reliably, and can Storybook stories serve as insertion previews? | 90 % of components yield usable prop metadata; a `Button` with a variant enum inserts and renders from extracted data. |

---

## 6. Open questions for the owner

Answers change the DESIGN wave, not this scope.

- **Q1 Editor UI kit.** Own component set (D7) or reuse `@epicparty/ui-components` and accept
  the coupling in exchange for speed and brand consistency?
- **Q2 Where screens live in epicparty.** One `designs/` at the root, or `products/<product>/designs/`
  with one product picked first? The recommendation is per product, starting with `prime`.
- **Q3 Design host.** Confirm the dedicated Vite host (D3) over starting the product's own dev
  server. The product server needs Convex and SST and would slow every session.
- **Q4 Localisation in screens.** Should screens use Lingui macros so they can be promoted to
  product code unchanged, or plain strings for speed? This decides E4.4.
- **Q5 Effect.** Adopt Effect for server and contracts as T3 Code does, accepting the learning
  curve, or plain TypeScript with Zod? The recommendation is Effect, since the goal asks to
  follow T3 Code's conventions and `packages/effect-acp` can be studied directly.
- **Q6 Repository visibility.** Private tool for epicparty or eventually open, which affects
  licensing of borrowed T3 Code patterns and how generic settings must be from day one.
- **Q7 Reference machine.** Which machine defines the performance budgets above.

---

## 7. Definition of done for v1

The v1 demo, run on the reference machine against the epicparty repository:

1. Open the tool on a branch, see a four-screen onboarding flow on one canvas, pan and zoom.
2. Click a button on screen two, change its padding and variant in the inspector, see the
   change instantly, and see a two-line diff in the changes panel that passes the repo's lint.
3. Insert a `Card` from the palette into screen three and fill its title inline.
4. In thread A, ask Claude Code to add a confirmation screen to the flow. In thread B, ask Codex
   to align the headers of all screens. Approve one permission request. Both results appear on
   the canvas while the agents work.
5. Commit everything from the tool and open a pull request containing design and code together.
6. Restart the tool: canvas layout, threads and transcripts are back.

---

## 8. Next steps

1. Answer the open questions in section 6, or accept the recommendations.
2. Run the four spikes (`/nw-spike`), one timebox each, findings into `docs/feature/`.
3. DESIGN wave (`/nw-design`): architecture document and ADRs for D2 to D6 and D9, using spike
   findings.
4. DISTILL and DELIVER milestone by milestone, starting with M0 and M1.
