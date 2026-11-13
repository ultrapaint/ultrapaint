# ADR 0088: Homebrew puts the `ultrapaint` command on the PATH, from inside the app

Status: accepted, 2026-11-13. Amends 0051 (what the cask installs) and 0083 (how the command gets
on the PATH).

## Context

Under 0083 the macOS app has no command until the person clicks Settings › Agents › Connect over
MCP › **Install the command**, which writes a launcher naming the app by absolute paths into a
folder on the PATH. `brew install --cask ultrapaint/tap/ultrapaint` gave only the app, and
`brew uninstall` left any command the app wrote behind. The person wants the cask to give both
and to take both away.

T3 Code, also an Electron app on Homebrew, has no `binary` in its cask: the app rewrites a
launcher in `~/.t3/bin` at every start and links it into `~/.local/bin`, on its first launch or
from Settings; on macOS its uninstall leaves the command behind. Its launcher saying "T3 Code
has moved or been removed" when the app is gone is worth having; the rest answers a question
this app does not have, as the cask can own the link.

## Decision

- **The macOS app ships its command**, at `Contents/Resources/bin/ultrapaint` (written by
  `scripts/dist.ts`, `apps/desktop/src/launcher.ts`). It follows the links that lead to it, then
  takes Electron's binary from `Contents/MacOS`, the server and the editor from
  `Contents/Resources/app`, and itself as the way `ultrapaint mcp` starts a server. A link to it
  works from any folder the app is installed in, and after the app updates itself, which puts
  the new bundle where the old one was (0078).
- **The cask links it**: `binary "#{appdir}/Ultrapaint.app/Contents/Resources/bin/ultrapaint"`,
  which `brew uninstall` removes with the app. The tap's hourly workflow rewrites only the
  cask's `version` and `sha256`, so the line stays once it is in. It goes in after the first
  release that ships the launcher: before, brew would fail on a missing file.
- **The cask's preflight removes the app's own launcher from Homebrew's `bin`**, a file with the
  launcher's mark that the app's Install wrote there (Homebrew's `bin` is on the PATH and
  writable): brew does not link over a file. Anything else there stops the install, as brew does.
- **Settings says where the command is.** When the `ultrapaint` first on the PATH is the app's,
  Connect over MCP says it is installed there; for a link to the launcher the app ships,
  "linked to this app", with no way to install a second one. For a launcher the app wrote, it
  offers **Install again**, which writes it again for an app that moved. A launcher the app
  wrote, run after its app moved or was removed, says so and how to install it again.
- **Linux is unchanged**: the cask is macOS's only, and an AppImage's launcher is written by
  the app as before.

## Consequences

- A command the app wrote into `~/.local/bin` or `/usr/local/bin` is not Homebrew's, and stays
  after `brew uninstall`; once the app is gone it says it has moved or been removed.
- The command runs the app's own binary, so until the app is taken out of quarantine
  (`xattr -dr com.apple.quarantine`, the cask's caveats) macOS stops the command too.
- The cask stays without `auto_updates true` (0078's suggestion) for now: with it, `brew upgrade`
  skips an app that updated itself, and an install from before this change would never get the
  link.
