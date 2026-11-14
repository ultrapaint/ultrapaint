# Deploy

Settings for [`/up-ship`](../../.agents/skills/up-ship/SKILL.md). Its `## Settings` section
defines each one.

## Deploy

None. Nothing deploys on a merge to `main`, so ship ends at the merge and says so.

A release is made by hand, and only when the person asks for one: the **Release** workflow
([`.github/workflows/release.yml`](../../.github/workflows/release.yml), run from the Actions tab
on `main`) raises the version in `package.json`, tags `v<version>`, attaches the command's
package to a draft release, builds the desktop app on Linux and macOS, and publishes the release
once both are attached. Its receipt is the published GitHub release for the tag
(`gh release view v<version>`). AppImages update to it, and the Homebrew cask follows within the
hour.
