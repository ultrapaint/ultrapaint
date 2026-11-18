# ADR 0105: Node.js is checked in About

Status: accepted, 2026-11-18. Amends PLAN-desktop D7 (the user's Node, said up front).

## Context

The desktop app looks for `node` on the login shell's `PATH` and asks its version, as a new
application's packages are installed and run with it. A `node` that did not answer
`node --version` (a version manager's shim that fails without its setup, one slower than the
check's 10 seconds) was read as the version "unknown", so the banner over the editor said
"Node.js unknown is too old" and threw the error away: a Vite+ shim that printed v26.13.1 in a
terminal showed it on a Mac. The banner was also the only place the check was said, gone once
dismissed.

## Decision

- **One status, four cases** (`NodeStatus` on the shell bridge): `Ready` (its path and version),
  `TooOld` (its path and version), `Failed` (its path and the reason: the last line it printed
  with its exit code, a version it did not print, or no answer in time) and `Missing`. A `node`
  that did not say its version is `Failed`, never too old.
- **Asked as the servers would run it**: with the whole environment `LoginShell` gives the servers
  the app starts, not its `PATH` alone, and given 30 seconds, as a shim may fetch the Node it picks
  on its first run.
- **Settings › About has a Node.js row** (`node.status`, desktop only): the path as its line, the
  version or what is wrong as its status, Check again while it is not ready, and under it the
  reason it failed, or how to install a newer one (`brew install node` on a Mac, the download).
- **The notice over the editor is one line** (`ShellNotice` keeps an `id`, a `title` and the
  `section` it details): "Node.js is not installed", "Node.js v18.19.0 is too old" or "Node.js
  didn’t run", with Details opening that section. What to do lives in the row, said once.

## Consequences

- A failing `node` now says what it printed, in About, so its cause is read rather than guessed.
- The check runs twice as the editor loads with About open (the notices and the row), each a
  `node --version`.
- A future notice names its own section; nothing else in `ShellNotice` carries what to do.
