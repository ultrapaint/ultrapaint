# ADR 0024: Tokens are the style system's to read and write, behind one interface

Status: accepted, 2026-10-06. Amends 0011 (framework packages) and 0015 (the design system).

> Amended by [0028](0028-the-design-holds-the-values.md), 2026-10-25: the style system is the
> code's side of the design system; it also writes the preview's overrides (`previewTokenCss`)
> and reads component specs off classes (`componentSpec`, ADR 0029).
>
> Amended 2026-10-25 (second round, `docs/PLAN-design-source.md`): the Code tab's translation is
> behind the interface too. `nodeClasses(designSystem)` gives a `ClassWriter` (the classes of a
> node, and of the element around an instance that keeps its props), which
> `@ultrapaint/design-document/code` writes its JSX with; the server writes the tab's code
> (`code.write`), so the editor no longer knows Tailwind's utilities.

## Context

Tailwind v4 is the only styling the tool understands, and its knowledge was spread through the
React + Vite framework package and the server: the `@theme` scan, the reading and rewriting of
classes for the setup (0023), the stylesheet the preview imports, and the rules that tell an
agent how a token becomes a class. The design-system sync is about to read the tokens, compare
them with Figma's and write them back. Built on Tailwind directly, every one of those would have
to change for the first project styled with StyleX or Emotion.

Two things vary independently. The UI library and its bundler (React and Vite) decide how
components are catalogued and how the preview is served. The style system decides where the
tokens are declared, what the code's styling looks like, and what the preview's stylesheet needs.
A React app can be styled with Tailwind, StyleX or Emotion alike.

## Decision

**A style system is a second interface beside the framework.** `StyleSystem` in
`@ultrapaint/framework-api/node` has:

| Member | What it does |
|---|---|
| `detect` | Finds the stylesheets that set it up in the packages the framework proposed |
| `readTokens` | Every token the code declares, with where each theme's value is written |
| `writeTokens` | The files as a list of token changes (set, add, remove, per theme) leaves them |
| `scan` | A first design system from the tokens, by fixed rules (what `/init` starts from) |
| `previewCss` | Lines of the preview's stylesheet, so every token is a custom property there |
| `usage` | What the code uses, for the setup's inventory, map and migrate |
| `codeRules` | How a token and a page's fields become code, for agents implementing a page |
| `nodeClasses` | The classes a node is written with in the Code tab, the same rules as `codeRules` (added later) |

**The tokens are neutral.** `@ultrapaint/contracts/tokens` has the model the server speaks: a
token's name is the one pages use without the `$` (`color-primary`), with its kind, its value
per theme, whether the repository declares it, and its origins (file and span). The server
never parses a stylesheet.

**The preview contract is a custom property per token.** Pages draw `$color-primary` as
`var(--color-primary)`. Tailwind's `@theme` defines them already; another style system's
`previewCss` would declare them from `readTokens`. The renderer and the page format do not change.

**Tailwind v4 is `packages/style-tailwind-v4`**, the scan, the usage reader and rewriter, the
stylesheet detection and the code rules moved there from the framework package and the server,
plus the new `readTokens`/`writeTokens`. An `@theme inline` alias (`--color-primary:
var(--primary)`) is followed to the variable that holds the value, in `:root` and in each
theme's block, and is written there.

**Settings name it.** `styleSystem` in the configuration, `tailwind-v4` when absent, proposed
by detection. The server loads it as it loads the framework, through `ProjectStyleSystem`.

## Consequences

- Adding StyleX or Emotion is a package implementing `StyleSystem` and an entry in the
  server's list of bundled style systems; the sync, the setup and the Figma comparison follow.
- `hostCss` stays a top-level setting, read by the Tailwind adapter. It moves under a style
  section with the first second adapter, and the configuration's schema is versioned then.
- Still Tailwind-shaped, to move behind the adapter when next touched: the Tailwind checks in
  the setup's rules, and the wording of the briefing. The Code tab's translation moved behind it
  (`nodeClasses`, Tailwind's in `packages/style-tailwind-v4/src/node-classes.ts`).
