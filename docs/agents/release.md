# Release

Settings for [`/up-release`](../../.agents/skills/up-release/SKILL.md), which a person starts
when a batch of merged changes is ready. `/up` `## Settings` defines each one.

## Releases

Tags by hand, cut by the **Release** workflow
([`.github/workflows/release.yml`](../../.github/workflows/release.yml)) run from the Actions tab
on `main`, never after every merge.

- **The version:** the workflow's `bump` input raises a part of the root `package.json`'s version,
  or releases it as it is, and commits it.
- **The tag:** `v<version>`, such as `v0.1.5`. The batch is the commits since the last one
  (`git describe --tags --abbrev=0`).
- **What publishes:** a draft GitHub release with the command's package (`pnpm pack:local`), then
  the desktop app built from the tag on Linux and macOS with its installers and update feeds
  attached, then the release published. AppImages update to it, and the Homebrew cask in
  `ultrapaint/homebrew-tap` follows within the hour.
- **The receipt:** the published GitHub release for the tag (`gh release view v<version>`), with
  the package and the installers attached.
- **Bump rules:** the pack's, from `/up` `## Settings` under **Releases**.
