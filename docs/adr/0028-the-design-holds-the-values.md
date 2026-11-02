# ADR 0028: The design holds the values; the code is one side among others

Status: accepted, 2026-10-25. Supersedes 0025's "values live in the code". Amends 0015 (token
names), 0024 (the style system is the code's side) and 0027 (DESIGN.md is compared with the
design, not the code). Plan: `docs/plans/done/PLAN-design-source.md`.

> Amended by [0046](0046-deep-modules-fifth-review.md), 2026-10-30: one write path makes the code follow every write; Sync's takes are `designSystem.edit` operations; a baseline moves one way, outside undo.

> Amended 2026-10-25 (second round): `design.tokens.json` is a Sync source as well as an
> export; agents bring the code up to the design through `handoff` and `/sync code`; and a
> design's implementation waits on the tokens it uses that the code does not have yet.

> Amended by [0035](0035-design-tokens-hold-the-values.md), 2026-10-26: `design.tokens.json`
> holds the values and `design-system.json` the rest. It is no longer an export compared in
> Sync: another tool's change to it is the design's value. The `designTokens` baseline and the
> `dtcg` source go.

## Context

Since 0025 a token's value was read from the code every time, and editing it in the editor wrote
the stylesheet. That made drift impossible and redesigns awkward: changing the palette to try it
changed the application at once, and a project started from nothing had to have code before it
had a design. The same position applied to everything else was confining too: the tool drew
pages with the repository's components and handed a page to an agent once, with no link back.

The position now, across 0028–0030: ultrapaint owns what the UI looks like and which states it
has; the code owns what it does. The design leads, and the code catches up through a link the
tool keeps.

## Decision

**`design-system.json` holds every value.** Each token keeps its `value` and its `values` per
theme. A file written before this leaves out the values of the tokens the code declares; those
are read from the code until the file is written again, which writes them in.

**The code is a side, compared against a baseline.** As Figma (0025) and DESIGN.md (0027) were
compared with the code, the code is now compared with the design system: `codeSync` in
`design-system.json` keeps the values the two last agreed on, keyed as the other baselines
(`name`, `name@theme`). A token changed only in the design is waiting for the code; changed only
in the code, the design is behind and Sync offers to take it; changed on both, the user picks.
Taking the design's value writes the stylesheet through the style system (0024), which is the
export. Tokens the code declares and the design system leaves out on purpose (`omitted`) are not
compared.

**Every side is compared with the design system.** Figma's tokens and DESIGN.md's front matter
are matched and compared with the design system's tokens, and taking theirs changes the design
system, not the code. The sources are named `figma`, `designMd` (was `design`) and `code`. A
diff's other value is `design` (was `code`), the outcome `to-design` (was `to-code`) and a pick
`take: "source" | "design"`.

**A token edit changes the design.** It is one undoable step in the designs directory. With
`codeTokens: "auto"` in the configuration the stylesheet is written as well and the baseline
moves with it, which is how it behaved before; the default is `manual`, and the Sync view's
`code` step lists what is waiting.

**The preview draws the design's values.** The renderer already wrote `var(--color-primary,
<value>)`; the repository's components read the code's variables, so the style system adapter
writes the declarations that give those variables the design's values where they differ
(`previewTokenCss`). For Tailwind v4 an `@theme inline` alias is followed to the variable that
holds the value and set under the theme's selector (`:root`, `.dark`, `[data-theme=…]`). The
server keeps it in `DesignSystemState.previewCss`, the editor sends it with every render
(`ed:render`'s `styles`), and the preview keeps it in one `<style>` after everything else, so it
wins without `!important`. `PREVIEW_PROTOCOL` goes to 6.

**The Design Tokens format is an export, and a source.** `design.tokens.json` in the designs
directory is written with every change of the design system, in the Design Tokens Community
Group's format (2025.10): colours and dimensions as structured values, the other themes' values
under `$extensions["dev.ultrapaint"].themes`, a value the format has no type for as CSS under
the same extension. It is for Style Dictionary, Tokens Studio and Figma's variables;
`design-system.json` stays the file the tool reads, because it holds what the format does not:
groups, text styles, elevation, what each component is for, the baselines.

Another tool may write the file back. It is a Sync source (`dtcg`) compared with the design
system as the code is, by name, against `designTokens` in `design-system.json`: the values the
editor last wrote into the file, moved with every write, so the editor's own writes never read
as another tool's. While the file holds values of its own that differ from that baseline, the
editor does not write over it: Sync lists what the tool changed (taken into the design system),
what both changed (the user picks) and what the design system changed meanwhile, and writes the
file again once they are taken. A token taken out of the file is not taken out of the design
system; the file gets it back.

**Agents bring the code up to the design too.** `/sync code` lists what waits for the code, what
the code changed alone and what changed on both sides, and has the agent ask the user where it
is theirs to say. The values are written through the MCP tool `handoff` (0030): `export` writes
the design's values into the stylesheets through the style system, `import` takes the code's
into the design; with no tokens named, what changed on that side alone, and with names, those
tokens, conflicts included (how an agent applies the user's pick).

**A design's implementation waits on its tokens.** The tokens a page uses (its nodes', its text
styles', the specs it places whose look the design owns) or a spec uses, whose design value the
code does not have yet, are listed with its status (`tokens`), named in its `/implement` task
with the step that exports them, and shown in the inspector with an Export button. An agent's
`handoff` "mark" is refused while one waits: the code would not draw the design. The user can
still mark it, and the status says the tokens wait.

## Consequences

- A token's name is still the one pages write without the `$` (`color-primary`); it is the
  design's, and the adapter maps it to its library's (`--color-primary` in Tailwind).
- The application can be behind the design, and that is a normal state. The Sync view says how
  many tokens wait for the code, and the plan's maintain step counts them.
- Agents that change tokens through `write_design_system` change the design; the stylesheet
  follows on export, or at once with `codeTokens: auto`.
- `mirrorDocument` keeps DESIGN.md's front matter in step with the design system's values, as
  it did with the code's.
- A new style system implements `readTokens`, `writeTokens` and `previewTokenCss`; the sync, the
  preview and the export follow.
- `design-system.json` keeps one baseline more, `designTokens`, as long as the token list: the
  price of telling another tool's change from the editor's own.
