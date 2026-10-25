# Plan: the design is the source, the code is a side

Status: done, 2026-10-25. Decisions in ADR 0028 (the design holds the values), 0029
(component specs) and 0030 (the implementation link). Builds on 0015, 0021, 0024, 0025, 0027.

## Why

The tool draws designs with the repository's components and then hands a page to an agent once,
with nothing kept of it. Nothing says which code implements which page, a business-logic request
made while designing has nowhere to go, a component cannot be restyled without editing its code,
and every token edit lands in the application at once, even in the middle of a redesign. The
three ADRs take one position: ultrapaint owns what the UI looks like and which states it has;
the code owns what it does. The design leads, and the code catches up through a tracked link.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Where token values live | `design-system.json`, every value and every theme's; the code is compared against a committed baseline (`codeSync`) as Figma and DESIGN.md are |
| D2 | DTCG | `design.tokens.json` in the designs directory, written with every change of the design system, in the Design Tokens format 2025.10. Kept as an export; the design system stays the richer file (groups, text styles, elevation, components) |
| D3 | A token edit in the editor | Changes the design system, undoable. Written to the code too only when `codeTokens` is `auto` (default `manual`) |
| D4 | The preview | Draws the design's values: the style system adapter writes the CSS that overrides the code's declarations where they differ, the editor sends it with every render |
| D5 | Sync sources | `figma`, `designMd` (was `design`), `code`; all compared with the design system. Taking the design's value for `code` writes the stylesheet (export) |
| D6 | Component specs | `specs/<Component>.spec.json` in the designs directory: slots, base, variants, states, defaults; `look` is `design` or `code`; a `draft` spec has a tree of nodes and no code |
| D7 | Applying a spec | An unlayered stylesheet keyed on attributes the renderer puts on every instance (`data-ed-c`, `data-ed-v`) and on the code's own `data-slot`s; states as pseudo-classes, the headless libraries' attributes, and `data-ed-state` to pin one |
| D8 | Reading a spec off the code | The style system adapter turns a component's cva classes, state prefixes included, into spec fields |
| D9 | Scaffold | Components written as cva with `data-slot`; dialog, select, tabs and checkbox on Base UI; once the application is set up, the editor reads a spec for each with `look: design` |
| D10 | Bindings | `implementation.json` in the designs directory: per page and per spec, `ready`, the files that implement it, the design's hash and each file's hash when it was implemented; the design as implemented in `_implemented/` (a directory the page scan passes by); a page renamed or deleted takes its binding along |
| D11 | Status | draft, ready, implemented, design changed, code changed (both can hold) |
| D12 | Incremental implement | `/implement` sends the node diff since the implemented design, the behaviour notes, then the whole design |
| D13 | Behaviour notes | A comment with `kind: "behaviour"`: pinned to a node, shown apart, carried by `/implement` |
| D14 | Page states | `orders@empty.page.json` with `empty` listed in the canvas's `states`; not a prototype-wide variant; links may name a state's file |
| D15 | Thread purpose | `design` (default) or `implement`. A design thread's sandbox and its ACP file writes reach the designs directory only |
| D16 | External agents | One MCP tool `handoff` (list, read, mark, note) and the server's `instructions` |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing.

### Phase 1: the design holds the values (ADR 0028)

- [x] 1.1 Contracts: `DesignSystem.codeSync` (a `DocumentBaseline`), `settings.codeTokens`,
      `TokenSourceKind` `figma | designMd | code`, `TokenDiff.design` (was `code`),
      `source` optional, outcomes `to-design` (was `to-code`), decisions `take: source | design`,
      `DesignSystemState.previewCss`.
- [x] 1.2 `DesignSystemService`: values kept in the file; a value the file leaves out (older files)
      is taken from the code once; `setToken` writes the design system (undoable) and, with
      `codeTokens: auto`, the code with the baseline; `exportTokens` writes chosen tokens to the
      code and moves `codeSync`.
- [x] 1.3 Style system adapter: `previewTokenCss(ctx, tokens)` writes the declarations that make
      the code's variables carry the design's values (aliases followed, theme selectors).
- [x] 1.4 Sync: the `code` comparison (both ways, `omitted` ignored), Figma and DESIGN.md compared
      with the design system and applied to it; the plan's drift counts what is waiting for the
      code.
- [x] 1.5 DTCG mirror `design.tokens.json`.
- [x] 1.6 Preview: `ed:render` carries `styles`; preview-core keeps one `<style>` last in the head;
      `PREVIEW_PROTOCOL` 6.
- [x] 1.7 Web: token edits say where they went; the Sync view's `code` step (export, import,
      conflicts) and the `codeTokens` toggle; frames send the CSS.
- [x] 1.8 Tests: service, rules, adapter, protocol, web model.

### Phase 2: the implementation link (ADR 0030)

- [x] 2.1 `diffTrees(before, after)` in `@ultrapaint/design-document/diff`.
- [x] 2.2 `ImplementationService`: bindings, snapshots, status, mark ready, mark implemented,
      unbind; RPCs and an event.
- [x] 2.3 Behaviour notes: `Comment.kind`, created from the composer and by agents.
- [x] 2.4 Page states: `CanvasLayout.states`, `Page.state`, create a state, links to states,
      prototype.
- [x] 2.5 `/implement`: incremental, with notes and states, the binding named; ends by marking.
- [x] 2.6 Thread purpose and the sandbox's writable roots; ACP writes checked too.
- [x] 2.7 MCP `handoff` and the server's instructions, inside the 16,000-character budget.
- [x] 2.8 Web: status in the Pages panel and the inspector, mark ready / implemented, the diff,
      the behaviour note composer, states in the Pages panel, the thread's purpose.
- [x] 2.9 Tests.

### Phase 3: component specs (ADR 0029)

- [x] 3.1 Contracts: `ComponentSpec`, `SpecList`, RPCs, `RenderRequest.drafts`.
- [x] 3.2 Style system adapter: `componentSpec(styles, tokens)` from cva classes with states.
- [x] 3.3 `specCss(specs, styleContext)` in `@ultrapaint/design-document/spec`.
- [x] 3.4 `SpecService`: list, read from code, write, set look, draft from a node, watcher.
- [x] 3.5 Renderer: `data-ed-c`/`data-ed-v` on instances, drafts rendered from their tree.
- [x] 3.6 Web: Components tab in the Design system panel (matrix of variants × states, live),
      fields for a slot in a variant or state, look toggle, read from code, make a draft from a
      selection, implement.
- [x] 3.7 Implement a spec: `/implement` takes a component; bindings for specs.
- [x] 3.8 Scaffold: cva, `data-slot`, Base UI, specs.
- [x] 3.9 Tests.

### Phase 4: briefing, docs, end-to-end

- [x] 4.1 Briefing: the design leads; behaviour goes to notes; specs; the thread's purpose.
- [x] 4.2 README, ADR index, AGENTS-facing text.
- [x] 4.3 Run the editor on a scaffolded project and on this repository; screenshots.

## What was built differently

- **DTCG is written, not read.** `design.tokens.json` is written with every change of the design
  system; `tokensFromDesignTokens` reads one (aliases, `$ref`, other tools' files) and is tested,
  but no Sync source uses it yet.
- **The MCP budget.** `handoff` fit under the 16,000 characters by shortening the page parameter's
  description and the scan and write tools' descriptions (which also stopped saying the values
  are the code's): 15,997.
- **ACP failures carry their reason.** A handler's failure reached the agent as "Internal error";
  it is now `Internal error: <reason>`, which a design thread's refused write needs.
- **The scan reads theme values set on theme variables.** `.dark { --color-accent: … }` was only
  read through `@theme inline` aliases; with the values in the design system it has to be read
  directly.
- **A design thread that already started cannot become an implement thread.** `/implement` turns
  a thread into an implement thread only before its agent starts; one that is running is told to
  send the user to the Implement button.
- **Not done:** pages copied or moved to another canvas do not take their binding; a Sync source
  for `design.tokens.json`; the Code tab still writes Tailwind directly.

## Verified

`pnpm typecheck`, `pnpm lint` and `pnpm test` (870 tests, 69 more than before) pass. On a scaffolded
application in a scratch repository, driven in headless Chrome: a token edit changes the design
system and not the stylesheet while the canvas draws the new value; a spec's variant restyles the
real Base UI button on the canvas while the other variants keep the code's look; export writes the
stylesheet and the preview's overrides empty out; a page marked implemented shows "Design changed"
with the node diff and the new behaviour note in the inspector.
