# ADR 0113: Ultrapaint Dev runs beside the app, live and updated from main

Status: accepted, 2026-11-23. Amends 0078 (a third way to update) and 0100 (which editor a
project opens in). Stories UP-109, UP-116.

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
  (`manual`), with why. When the install fails, the checkout goes back to the commit it was at
  (`git reset --keep`), unless a commit landed there meanwhile, and that commit's dependencies are
  installed again; that install can fail too (offline, say), leaving them partly changed, and Pull
  and restart installs again. Going back can also be refused, when a file the pull changed was
  edited meanwhile: the checkout then stays on the pulled commit, its edits kept, and nothing is
  installed again. Either way the app then starts on the commit the checkout is at, says why the
  update failed and offers Pull and restart again, or says why it cannot. A fetch that fails shows nothing on the item, and About says it couldn't check,
  as the release does. The app only reads git; the runner writes.
- **It looks like Dev: "E · Blueprint"**, chosen by the maintainer from drawn directions, then
  moved to start from the window's left edge as T3 Code's night sky does. Blueprint paper with a
  grid lies under the whole tab strip, behind Home and the tabs, fading out towards the right, with
  a line of its blue along the window's top edge; a construction line, a dimension and a
  registration mark are drawn in the room past the +, never behind a tab, and give way to tabs.
  The light paper is as light as the canvas, so the tabs' muted names keep their contrast. Its icon is the release's mark, at the release's size, on a blueprint tile: a white grid, a border and drafting marks drawn thick enough to read in the Dock (`resources/icon-dev.svg`). The release looks
  as it did. Its colours are tokens (`--blueprint`, `--blueprint-ink`, `--blueprint-line`).
- **About names it**: Ultrapaint Dev, and the branch and commit it runs (`main · 3f2a1c9`).
- **It leaves the `ultrapaint` command to the release**: Settings offers no install, and the
  bridge refuses one.
- **On a Mac, `pnpm desktop:dev` makes Ultrapaint Dev's own app** (amended by UP-116; first
  `pnpm desktop:dev-app` wrote one into `~/Applications`). As T3 Code's dev run makes "T3 Code
  (Dev).app" and VS Code `Code - OSS.app`, the runner makes `apps/desktop/.dev-app/Ultrapaint
  Dev.app` in the checkout (ignored by git) from the checkout's Electron, and makes it again only
  when its stamp changes (a launcher version, the checkout, the Electron app, the icon, the bundle
  id). It carries Ultrapaint Dev's name and icon, a bundle id per checkout
  (`dev.ultrapaint.desktop.dev.<folder>.<hash of its path>`), helper apps named after it, and is signed ad hoc and
  registered with LaunchServices, so Spotlight finds it and it can be kept in the Dock. Its
  executable is a launcher script that reads the run the runner saved last (`.dev-app/run.sh`)
  and opens the checkout's last build in the bundle's Electron, which keeps its own name: Electron
  finds its helper apps by it. The runner starts the app through that launcher. Opened from the
  Dock, it starts at once on the last build, with no runner: asked to update, it starts one
  (`scripts/dev.ts --pull-first --after <pid>`, through the login shell, its output in the app's
  log folder), which waits for it to exit, pulls and runs it again (the runner says it is there by
  `ULTRAPAINT_DESKTOP_RUNNER`, which the saved run never holds). Rejected: `~/Applications`, one per
  Mac and outside the checkout; a Dock launch through the runner, which waits for a build.

## Consequences

- A fix on `main` reaches the Mac with a click on the update item, in the time a pull and a build
  of what changed take, with no Actions minutes spent.
- Both apps open the same project as one server: the second attaches to the first's, and shows the
  editor that server serves.
- An Electron upgrade in the checkout makes the next `pnpm desktop:dev` make its app again, a few
  seconds more once. An `~/Applications/Ultrapaint Dev.app` written before UP-116 is no longer used
  and can be deleted.
- A Nightly channel built by CI remains possible as its own story. Its look is chosen already:
  "D · Northern lights", aurora curtains past the + and a green line along the top edge.
