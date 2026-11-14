---
name: up-outdated
description: Reports which dependencies of a pnpm workspace have newer releases past the release quarantine, and what every changelog in between means for this codebase. Use when asked what is outdated, what a new release brings, or what an upgrade would involve.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Outdated

Packages in, one report out: each scoped dependency's newest version past the **quarantine**, and what every release in between means for this codebase. The report changes nothing. [`/up-upgrade`](../up-upgrade/SKILL.md) applies it.

The **quarantine** is the age a release must reach before the workspace takes it. It is the age the user gave, or else `minimumReleaseAge` in `pnpm-workspace.yaml` — in minutes there — and it skips each package in `minimumReleaseAgeExclude`. With neither, ask the user for this run's quarantine, and recommend `minimumReleaseAge`: pnpm enforces it at install, so the next run reads it too.

The skill reads the registry and the tree and runs no product, so it works in any checkout as it is.

## 1. Pin the scope

- **The packages** — the ones the user named: by name, by catalog ("the tanstack catalog") or by product. With none named, every npm dependency in the workspace: each catalog entry, each direct range in a `package.json`, and the root `packageManager`.
- **The families** — packages released or used together form one family, and a named package brings its family in. Read them off the workspace: packages published from one source repository (`pnpm view <pkg> repository.url`), a package with its `@types/*`, and the packages of a catalog named for one ecosystem — a `convex` or `sentry` catalog is a family, a catch-all `tooling` catalog is not.
- **The couplings** — a comment beside a pin or an override in `pnpm-workspace.yaml` is a constraint, and it joins the packages it names into one family. A comment saying `vitest` follows the Vitest that `vite-plus` bundles moves `vitest` only to that version.
- **The quarantine**, in days.

Done when you can name the packages, their families, and the quarantine in days.

## 2. Find the targets

[`taze`](https://github.com/antfu-collective/taze) reads the catalogs and every manifest in one pass:

```sh
pnpx taze latest -r -l --no-github-actions --no-node-version --include <a>,<b> --json
```

- `latest` crosses majors. Leave out `--include` for the whole workspace.
- `-l` is required. Without it taze skips exact pins, and almost every catalog entry is one.
- `--no-github-actions --no-node-version` keep the run to packages. Action pins and the Node version are outside this report.
- taze reads `minimumReleaseAge` and `minimumReleaseAgeExclude` itself. Add `--maturity-period <days>` only for a quarantine the user gave; it replaces the repo's.
- taze writes the `packageManager` target with a caret. The field takes an exact version, so report the exact one.

taze drops a package without a word when its newest release is still in quarantine and a release on another line — a `v9` maintenance tag, a canary — is the newest one past it. The package then has no row at all, or a row with `"diff": "error"`, and reads as current. So check every scoped package taze did not report: its target is the highest version in `pnpm view <pkg> versions --json` that is newer than the current one and past the quarantine in `pnpm view <pkg> time --json`. Take the versions from `versions`, because `time` also keeps unpublished ones.

Confirm the quarantine held on one target that has a younger release: `pnpm view <pkg> time --json` shows the target past the quarantine and the newer release skipped.

Done when every scoped package has a target with its publish date, or reads as current.

## 3. Read the changelogs

Read every release between the current version and the target. A breaking change ships in a middle release as often as in the last one. Sources, in order: the GitHub releases (`gh release list -R <owner>/<repo>`, the repository from `pnpm view <pkg> repository.url`), the `CHANGELOG.md`, then the migration guide of each major.

Fan the reading out: subagents in parallel, one per large family and one per handful of small ones, each given its packages and their version spans. Each returns, per package:

- **Breaking** — each change that touches our code, with the files it hits (`rg` the imports).
- **Deprecated** — each API we call that the span deprecates, with its replacement and the files that call it.
- **Improves us** — each new feature that replaces or simplifies code we have: a workaround, an override, a patch, a hand-rolled helper, a comment that names an upstream issue. With the files.
- **New** — each feature worth knowing that no code of ours needs yet.
- **Security** — each advisory the span fixes, with its id.
- **Defaults** — each changed default that alters what the product collects, stores or shows, with what our config sets today.
- **Peers** — the target's `peerDependencies` and `engines` (`pnpm view <pkg>@<version> peerDependencies engines`).

A package with no changelog to find says so, and the gate becomes its only check.

Done when every target has its items, or reads as nothing that touches us.

## 4. Check the targets fit

Check each target's peer ranges against the other targets and against the couplings, and its `engines` against the project's Node version — `.node-version`, `.nvmrc`, or the root `engines.node`. A **Breaking** item can hold a package with no range to show it — a plugin we keep that misbehaves under the target. A package in `minimumReleaseAgeExclude` skips the quarantine, but its dependencies do not. When it pins one exactly, check that dependency's publish date too (`pnpm view <pkg>@<version> dependencies`). A dependency still in quarantine holds the package at its newest version whose dependencies have all passed. A conflict holds the package at the newest version that fits (`pnpm view <pkg> versions --json`), or at its current one.

Done when no target's peer range excludes another target, no `engines` range excludes the project's Node version, and each held package has its reason.

## 5. Find the unused

A scoped dependency is **unused** when nothing reaches it: no import (`rg` the package name across the workspace), no binary in a script, no reference in a config file, and no peer range of another installed package it satisfies. Check each manifest's entries and each catalog entry that no manifest references. The check is workspace-wide: a package that any workspace package reaches is used, whichever manifest declares it.

Done when each scoped dependency is used, or listed as unused with where it is declared.

## 6. Write the report

The report lives in the reply only — a later `/up-upgrade` in the same thread reads it from there, and another thread runs this skill again. It is read top-down: the highlights first, the detail by family after them. Every line holds one fact, and every version is exact, because `/up-upgrade` takes the report as its plan.

```markdown
**Quarantine:** 3 days, from `minimumReleaseAge`. **Scope:** the whole workspace — 80 of 112 packages behind, 12 families.

## Highlights

1. **Sentry 10.65.0 → 11.8.0** — breaking: `beforeSend` receives … Touches `src/lib/sentry/server.ts`.
2. **TanStack Router 1.170.17 → 1.170.45** — improves us: typed search defaults remove the casts in `src/routes/…`.

## By family

### vite — `vite-plus`, `@voidzero-dev/vite-plus-core`, `vitest`, `@vitest/coverage-v8`

`vite-plus` and `vite-plus-core` 1.0.0 → 1.3.0 (minor) · `vitest` and `@vitest/coverage-v8` 5.0.1 → 5.0.5 (patch)

- **Breaking:** none that touches us.
- **Improves us:** `vp test --changed` … could replace … in `package.json`.
- **New:** …
- **Peers:** fit.

### Nothing that touches us

- **tailwind** (4 packages) — 4.3.2 → 4.3.3, patch. Bug fixes in …

## Held

- `posthog-js` 1.438.13 — under the quarantine until 2026-10-23. Takes 1.438.12.
- `better-auth` 1.7.10 — `@convex-dev/better-auth` 0.12.5 peers on `<1.7.0`. Takes 1.6.33.
- `jsdom` 30.1.3 — its `engines` excludes Node 24.14.0, the project's Node version. Stays on 29.1.1.

## Open questions

1. **Sentry `dataCollection`** — v11 removes `sendDefaultPii` and collects request bodies, headers and IPs by default, because … Our events then carry … (`src/lib/sentry/…`). Options: keep v10's set — …; take the new default — …. Recommended: keep v10's set, because ….

## Unused

- `@tailwindcss/cli` — in the `styling` catalog. No manifest references it.
```

- **Highlights** — the items that change what the user decides, ranked: **Security** for an advisory our current version has — in shipped code before a dev tool — then **Breaking** and **Defaults**, then **Improves us**, then a **New** feature with real weight. Each names the family, the version jump, the item and its files.
- **A family block** for each family with at least one item, majors first, then by item count. The version line names every package that moves. The bullets keep the order of step 3; **Breaking** is always there, as "none that touches us" when empty, so the reader knows it was checked. Any other label with nothing is left out.
- **Nothing that touches us** — one line per remaining family: the span, the kind, and what the releases did in a few words.
- **Held** — every release a package does not take, its reason, and the version it takes instead. A held package that still moves also keeps its line in its family block.
- **Open questions** — each choice the report leaves to the user: a major to take or hold, a held package with another way out, a default that changes what the product collects or shows, an optional adoption. Each carries what [`/up-upgrade`](../up-upgrade/SKILL.md) needs for its briefing: what changed and why, what it touches here, the options with their consequences, and a recommendation with its reason.
- **Unused** — last, each unused dependency with where it is declared. Leave the heading out when there is none.

Done when every scoped package that moves appears once — in a family block or under **Nothing that touches us** — every release it does not take is under **Held**, every package that neither moves nor is held is in the count of current packages, and every unused one is under **Unused**.
