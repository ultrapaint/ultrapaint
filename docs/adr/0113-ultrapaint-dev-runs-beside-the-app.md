# ADR 0113: Ultrapaint Dev runs beside the app, live and updated from main

Status: accepted, 2026-11-23. Amends 0078 (a third way to update) and 0100 (which editor a
project opens in). Story UP-109.

## Context

The maintainer wants the latest `main` in the desktop app on their Mac without cutting a release.
The installed app updates only from published GitHub releases (0078), and a release is a version
bump in a PR and a workflow run by hand: a fix merged in minutes reached the Mac an hour later at
best. A nightly channel built by CI, as T3 Code publishes, was weighed and set aside for now: it
spends Actions minutes on every build, and a fix still waits for the build.

The app could already run from a checkout (`pnpm desktop:dev`), but not beside the release: its
manifest was named Ultrapaint, so both used one data folder, and Electron allows one running copy
per data folder. Nor was it live: it built the editor into itself once, ran a local project's
server without watching its sources, and opened a server of its version in its bundled editor
(0100). `ultrapaint --dev` already served a checkout live, and the app attached to such a session
left running, but it had to be started by hand in each project's folder first.

## Decision

- **Ultrapaint Dev is the app run from a checkout**, told apart from the release by its runner
  (`scripts/dev.ts`), which describes the run in `ULTRAPAINT_DESKTOP_DEV_RUN`: the checkout, its
  branch and commit, the version it names, and why the last update failed. `Edition` (`edition.ts`)
  reads it once. `app.isPackaged` does not decide it: Electron renamed in `Ultrapaint Dev.app`
  reads as packaged.
- **Its own name, data and Keychain entry.** It is named Ultrapaint Dev and keeps its data in
  `Ultrapaint Dev` beside the release's folder, so it has its own single-instance lock, projects,
  agent downloads and settings, and `safeStorage` its own Keychain entry. `ULTRAPAINT_DESKTOP_USER_DATA`
  still wins, for throwaway runs. The person's folder (`~/.ultrapaint`) is the same in both.
- **Its first start copies the release's projects list**, local and over SSH, into Recent with no
  tab open; once it has a list of its own, nothing is copied again. A throwaway run copies nothing.
- **A local project runs the checkout's `ultrapaint --dev`**, started by the app as it starts any
  project's server (the flags it gives, a pipe on stdin that stops it), and opens in the editor its
  ready line names (Vite), never the app's own (amends 0100 for Ultrapaint Dev). A project already
  open in the release is attached to as before: one server per project.
- **It updates from `main`** (amends 0078: `Updater`'s `Checkout` mode). At start, every hour and as
  About opens, it fetches `main` from the checkout's origin and offers the commits `main` has
  since the commit the app runs (a pull in a terminal moves the checkout on, not the app), newest
  first, with their subjects (`AppUpdate`'s `pull`). Pull and restart stops the projects as a
  restart to update does, asking first where an agent is at work, and exits with code 75; the
  runner checks again that the checkout is clean on `main`, pulls by fast-forward only and runs
  `pnpm install` when the lockfile changed, then hands over to a new runner, whose modules are the
  pulled code, which builds what changed (the editor when its sources differ from the commit it was
  built from, or were built while not committed) and starts the app again. A checkout on another
  branch, with changes not committed or commits of its own, is offered nothing to click
  (`manual`), with why. When the install fails, the checkout goes back to the commit it was at,
  unless a commit landed there meanwhile, and that commit's dependencies are installed again; that
  install can fail too (offline, say), leaving them partly changed, and Pull and restart installs
  again. The app then starts on that commit, says why the update failed and offers Pull and
  restart again. A fetch that fails shows nothing on the item, and About says it couldn't check,
  as the release does. The app only reads git; the runner writes.
- **It looks like Dev: "E · Blueprint"**, chosen by the maintainer from drawn directions, then
  moved to start from the window's left edge as T3 Code's night sky does. Blueprint paper with a
  grid lies under the whole tab strip, behind Home and the tabs, fading out towards the right, with
  a line of its blue along the window's top edge; a construction line, a dimension and a
  registration mark are drawn in the room past the +, never behind a tab, and give way to tabs.
  The light paper is as light as the canvas, so the tabs' muted names keep their contrast. Its icon is the mark on a blueprint tile (`resources/icon-dev.svg`). The release looks
  as it did. Its colours are tokens (`--blueprint`, `--blueprint-ink`, `--blueprint-line`).
- **About names it**: Ultrapaint Dev, and the branch and commit it runs (`main · 3f2a1c9`).
- **It leaves the `ultrapaint` command to the release**: Settings offers no install, and the
  bridge refuses one.
- **On a Mac, `pnpm desktop:dev-app` writes `~/Applications/Ultrapaint Dev.app`**: a copy of the
  checkout's Electron, with Ultrapaint Dev's name, icon and bundle id (`dev.ultrapaint.desktop.dev`),
  signed ad hoc for this machine, around a small app. Opened from the Dock, it hands over to the
  runner through the login shell (for its `PATH`) and exits, the runner's output going to
  `~/Library/Logs/Ultrapaint Dev.log`; started by the runner, it loads the checkout's build, only
  then, so a Dock launch never needs a build that is not there yet, and the Dock shows one
  Ultrapaint Dev. The runner starts the app inside it when it was made for this checkout and its
  Electron: another checkout's would load that checkout's build. For another Electron it says to
  run the command again. Its Electron executable keeps
  its name: Electron finds its helper apps by it. A shell `.app` that runs `pnpm desktop:dev` was
  rejected: it shows two Dock icons and Electron's name in the menu bar.

## Consequences

- A fix on `main` reaches the Mac with a click on the update item, in the time a pull and a build
  of what changed take, with no Actions minutes spent.
- Both apps open the same project as one server: the second attaches to the first's, and shows the
  editor that server serves.
- An Electron upgrade in the checkout needs `pnpm desktop:dev-app` again; until then Ultrapaint Dev
  runs on the checkout's own Electron, under its name.
- A Nightly channel built by CI remains possible as its own story. Its look is chosen already:
  "D · Northern lights", aurora curtains past the + and a green line along the top edge.
