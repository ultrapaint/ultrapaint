# ADR 0051: The desktop app ships with each release, unsigned

Status: accepted, 2026-11-03. Carries out PLAN-desktop D14 and D15 now that the repository is
public.

## Context

The release workflow built the desktop app and kept it as the run's artifacts: no download and no
update feed while the repository was private (PLAN-desktop D15). It is public now. There is no
Apple Developer account, so the macOS app cannot be signed or notarized, and Squirrel, which
electron-updater uses on macOS, updates signed apps only. Homebrew still installs an unsigned app
from a tap of one's own, though not from its official one.

## Decision

- Each release carries the app: an AppImage and a deb for Linux x64, a dmg and a zip for macOS on
  Apple silicon, with their update feeds (`latest-linux.yml`, `latest-mac.yml`). The workflow
  drafts the release, attaches the command and both platforms' builds, then publishes it, so
  nothing updates to a release that lacks its app.
- The command's package is attached twice: by its version, and as `ultrapaint.tgz`, which
  `releases/latest/download/ultrapaint.tgz` always finds. `npm install -g` that address installs
  and updates it.
- An AppImage updates itself through electron-updater from the GitHub release: downloaded in the
  background, installed when the app quits.
- Elsewhere (the macOS app, a deb) a notice over the editor says a newer release is out, read from
  GitHub's latest release at most once an hour: on macOS with `brew upgrade --cask ultrapaint`
  and the download, on Linux with the download.
- macOS installs through the tap `ultrapaint/homebrew-tap`:
  `brew install --cask ultrapaint/tap/ultrapaint`. The tap follows the latest release by a
  workflow of its own, every hour, with its own token: the main repository keeps no key to it.
  Its caveats say how to open an unsigned app (`xattr -dr com.apple.quarantine`).
- Windows waits: the command does not start agents there yet, and they would run unscoped.

## Consequences

- An unsigned macOS app has to be taken out of quarantine by hand after each install or upgrade.
  Signing and notarization, with an Apple Developer ID, make the cask `auto_updates true` and let
  electron-updater update the macOS app as it does the AppImage.
- The tap's hourly workflow stops if GitHub disables it after 60 days without activity in the tap;
  it is started again from its Actions tab.
- Intel Macs and Linux on arm64 get no build until there is a runner for each.
