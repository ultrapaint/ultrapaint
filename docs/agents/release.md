# Release

Settings for [`/up-release`](../../.agents/skills/up-release/SKILL.md), which a person starts
when a batch of merged changes is ready. `/up` `## Settings` defines each one.

## Releases

Tags by hand, cut by the **Release** workflow
([`.github/workflows/release.yml`](../../.github/workflows/release.yml)) run from the Actions tab
on `main`, never after every merge.

- **The version:** raised first in the root `package.json` by a PR of its own, one commit
  `chore: release v<version>`, rebase-merged once `check` passes; the workflow releases the version
  `main` holds and pushes only its tag. `main` takes commits only through a PR (ADR 0096), the
  workflow's included.
- **The tag:** `v<version>`, such as `v0.1.5`. The batch is the commits since the last one
  (`git describe --tags --abbrev=0`).
- **What publishes:** a draft GitHub release with the command's package (`pnpm pack:local`), then
  the desktop app built from the tag on Linux and macOS with its installers and update feeds
  attached, then the release published. AppImages update to it, and the workflow starts the one
  in `ultrapaint/homebrew-tap` that points the Homebrew cask at it, so the cask follows within
  minutes (ADR 0103; the tap's hourly schedule is the fallback).
- **The receipt:** the published GitHub release for the tag (`gh release view v<version>`), with
  the package and the installers attached, and the cask's version once the tap's run ends
  (`gh api repos/ultrapaint/homebrew-tap/contents/Casks/ultrapaint.rb -H "Accept: application/vnd.github.raw" | grep '^  version'`).
- **Bump rules:** the pack's, from `/up` `## Settings` under **Releases**.
