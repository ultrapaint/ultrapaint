# ADR 0104: About checks for an update as it opens

Status: accepted, 2026-11-18. Amends 0078 (when the app asks GitHub for a newer release, and what
About says of it).

## Context

Under 0078 the app asks GitHub at start and every hour, and Settings › About showed "Up to date"
whenever that check had found nothing. After v0.3.0 was published on 18 Nov, an app started
before it still said "Up to date" on 0.2.0: About read the last hourly check as an answer it never
gave, and a check that failed (offline, rate-limited) read the same.

## Decision

- **About asks GitHub as it opens** (`checkUpdate` on the shell bridge, the `Updater`'s
  `checkNow`): the same check as the hourly one, one at a time with it, which makes the newest
  release ready as before.
- **About says what that check found** (`UpdateCheck`), in a status region a screen reader
  announces: "Checking for updates…" while it runs; "Up to date" only once it went through and
  found nothing (`current`); "Downloading the update…" when it found one not ready yet (`newer`,
  an AppImage downloaded whose `update-downloaded` has not come yet); "Couldn’t check for updates" when
  GitHub or an AppImage's feed could not be asked or the release not made ready (`failed`); and
  nothing where this copy checks nothing (`unavailable`: development, or a shell from before the
  check). An update already found shows its button at once, as before.
- The start and the hourly check stay; nothing else asks on open.

## Consequences

- Opening About with a release out downloads it, as the hourly check would, on the macOS app and
  an AppImage alike, and the check answers once it is downloaded: "Checking for updates…" until
  then, then the restart action (or "Downloading the update…" for the moment an AppImage's
  `update-downloaded` has not come yet). An AppImage's feed that lists no newer release yet, or a
  download that fails, is a check that failed.
- The Homebrew cask says `auto_updates true` (0078's consequence, made in the tap the same day):
  plain `brew upgrade` leaves alone an app whose bundle already updated itself to the cask's
  version, and still upgrades one left behind it; `brew upgrade --cask ultrapaint` upgrades it
  when asked by name.
