# ADR 0078: The desktop app updates itself, and shows what a release brings

Status: accepted, 2026-11-11. Amends 0051 (how the macOS app and an AppImage are updated, and the
release's notes).

## Context

Under 0051 only an AppImage updated itself, with a system notification and nothing in the app. The
macOS app and a deb were told of a newer release by a banner over the canvas, which on macOS gave a
Homebrew command and a download, and each install had to be taken out of quarantine by hand again.
Squirrel, which electron-updater uses on macOS, updates signed apps only, and there is still no
Apple Developer ID. A release's notes were how to install it and a compare link: nothing said what
it brings. The person asked for an updater as easy as T3 Code's, with its changelog in view; a
signed app is for later.

## Decision

- **The app asks GitHub at start and every hour** for the releases since the one running (drafts
  and pre-releases are not), with their notes, and gets the newest ready (`Updater`).
- **The macOS app replaces itself, unsigned.** It downloads the release's zip, checks its size and
  SHA-512 against the release's `latest-mac.yml`, and unpacks it with `ditto` beside its data. A
  restart, once agents at work are stopped with the person's agreement, starts a script that waits
  for the app to exit, puts the new bundle where the running one is, keeping the old one until the
  new one is in place, and opens it. Where it is comes from the running executable, so a copy
  installed in another folder or under another name is replaced there. A file the app downloads
  itself is not quarantined, so nothing is taken out of quarantine by hand.
- **Where a copy cannot replace itself, it is downloaded by hand**, saying why: macOS running it
  from a temporary folder (opened in quarantine), a folder it cannot write (the dmg), a download
  that failed or did not match its checksum (tried again within the hour), and a deb.
- **An AppImage** keeps electron-updater, which downloads it; the app shows it as it shows the
  macOS app's, and the restart is electron-updater's. No system notification.
- **The update is shown only while there is something to do**, at the foot of the rail above
  Changes and Settings, where what frames the whole window sits, and on the start screen at its
  top right: never a banner over the canvas, which stays the loudest thing on the screen. The item
  is drawn in the foreground, not muted as the places are; the rail's dot is the agents' colour
  and is not used. It opens a popover beside it: the version and the one running, the notes of
  each release since, newest first, and one primary action, Restart to update or Download.
- **A release's notes end at an install mark** (`<!-- install -->`, `@ultrapaint/contracts/release-notes`):
  what comes before it is what the release brings, which the app shows; after it, how to install
  it. The release workflow writes them from the `feat:` and `fix:` commits since the previous
  release that change the app (`scripts/release-notes.ts`), each commit's behaviour up to its first
  colon. A stopgap: the changelog itself is issue #1.

## Consequences

- The Homebrew cask should say `auto_updates true`, so that `brew upgrade` leaves an app that
  updated itself alone; that is the tap's change.
- A Developer ID makes the swap electron-updater's on macOS too, with the same item and popover.
- An install the person cannot write to (a standard user under an admin's `/Applications`) is
  downloaded by hand each time.
- The notes are as long as the commits' first clauses until issue #1 makes a changelog a person
  reads.
