# Plan: the desktop app, what is left

Status: proposed, 2026-10-26. Follows [PLAN-desktop](PLAN-desktop.md), whose Phases 0 to 3 are done
(ADR 0031). This plan holds its Phase 4, what building Phases 0 to 3 found, and the open
questions. The revision history has a plan of its own ([PLAN-revision-history](PLAN-revision-history.md)).

## What building it found

Things the phases left, ordered by how much they block a first release to someone else.

| # | Found in | What | Why it matters |
|---|---|---|---|
| F1 | Phase 1 | Codex's shell commands fail inside the agent sandbox: Codex starts its own bubblewrap inside ours. It fails the same way from the command with `npx`, so it predates the desktop | Codex cannot run a command in any project, on Linux at least |
| F2 | Phase 1 | The Claude adapter bundle carries the Claude Agent SDK's JavaScript, under Anthropic's commercial terms, not an open licence | Shipping it inside the app needs a legal check |
| F3 | Phase 1 | A user's Claude Code hooks outside the project (`~/Code/…/.claude/hooks/…`) are not readable inside the sandbox, so they block Claude's Bash calls | Anyone with global hooks sees Claude fail at its first command |
| F4 | Phase 1 | Not tried for real: ChatGPT sign-in, the API key in a real keychain, installing the deb, the macOS build | First run on another machine is untested |
| F5 | Phase 1 | The AppImage needs libfuse2 (absent on current Ubuntu) or `APPIMAGE_EXTRACT_AND_RUN=1`; the app has no icon | First start fails on a stock Ubuntu |
| F6 | Phase 2 | With git on and no git identity, the first commit fails with git's message | A new user with git on cannot finish a new design |
| F7 | Phase 2 | The starter gives specs to Button and Badge only, of its ten components; with git on, they are written after the first commit and show as uncommitted | The starter looks half done |
| F8 | Phase 3 | No password or passphrase prompt over SSH: key authentication only; an unknown host key must be accepted in a terminal first | A host reached by password cannot be opened |
| F9 | Phase 3 | The remote shell is started interactive (`-ilc`), so fnm set up in `.bashrc` is found; a `.bashrc` that starts tmux breaks the start | Some remote machines cannot start the server |
| F10 | Phase 3 | After a long outage the editor once came back on a new local port instead of its own | The page reloads, but the reason is unknown |
| F11 | Phase 3 | A page file written on the remote, in a folder made while the server ran, did not reach the open editor until a reload. Not SSH's: the watcher's | Pages made by hand or by another tool appear late |
| F12 | Phase 0 | A design-system setup started before the snapshot store cannot be redone; it asks to start again | Only affects setups in progress at the upgrade |
| F13 | Phase 0 | The snapshot store has no size limit; a project's first snapshot copies every file `.gitignore` keeps | A large repository fills the state directory |
| F14 | Phase 1 | Electron 44's headless mode crashes, so the desktop app cannot be driven in CI without a display | No end-to-end tests of the app in CI |
| F15 | Phase 0 | The `.git` placeholder the Linux sandbox mounts in a folder without git is visible as an empty folder while an agent runs | Cosmetic; git ignores an empty `.git` |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing.

### Phase 4: ready for someone else's machine

- [ ] 4.1 Codex in the sandbox (F1): run Codex with its own sandbox off (`sandbox_mode`
      `danger-full-access` inside ours, which is the outer boundary), check its shell commands run
      on Linux and macOS, and add a test that runs a command through each built-in agent.
- [ ] 4.2 Hooks and the user's agent configuration (F3): what of `~/.claude` and `~/.codex` the
      sandbox reads (the settings and the files they name), or hooks turned off inside the
      sandbox with a note in the chat. Decide with 4.1.
- [ ] 4.3 First run on a clean machine (F4, F5): a checklist run on a fresh Ubuntu VM and a Mac:
      install, Node missing and present, each agent missing, downloaded, signed in, an API key, a
      new design, a project over SSH. The AppImage gets an icon and says what to install when
      libfuse2 is missing, or the deb becomes the recommended Linux package.
- [ ] 4.4 Git identity (F6): the new-design dialog asks for a name and email when git is on and
      git has none, and sets them for that repository only.
- [ ] 4.5 The starter's specs (F7): every starter component gets its spec when the project is
      written, before the first commit.
- [ ] 4.6 The watcher (F11): a page in a folder made after the server started is picked up.
- [ ] 4.7 The snapshot store's limit (F13): a size cap in settings, the oldest unreferenced
      objects collected first; the first snapshot skips files over a size (assets stay).

### Phase 5: machines without the tools

- [ ] 5.1 A managed Node and pnpm: a pinned Node release for the platform, checked by its hash,
      downloaded into the app's data when none is found (opt-in, as the agents are), and put first
      on the PATH of the project's server.
- [ ] 5.2 New design without any Node installed works end to end on a clean VM.

### Phase 6: SSH, complete

- [ ] 6.1 Password and passphrase prompts (F8): `SSH_ASKPASS` pointing at the app, which asks in
      the window; accepting an unknown host key in the window, its fingerprint shown.
- [ ] 6.2 A non-interactive start first (F9): try `-lc`, fall back to `-ilc` only when the command
      is not found, and say which in the log.
- [ ] 6.3 The local port after an outage (F10): find why it moved; keep it.
- [ ] 6.4 New design on a remote machine: the dialog gets a host; `ultrapaint new … --progress-json`
      runs over the same connection, and the default folder is asked of the remote.
- [ ] 6.5 A pinned runtime uploaded to the remote, as T3 Code does, for machines without
      `ultrapaint` (and later without Node). Only if 6.1 to 6.4 show it is needed.
- [x] 6.6 Opening at start, never a blank window (found 2026-11-03): the app reopened the last
      project before it showed anything, so an SSH project whose machine was off or out of reach
      left the window grey for up to the connection's 40 seconds and the server's 2 minutes. Now
      every opening shows the welcome page at once with the project opening (its name and where
      it is), a Stop that gives the attempt up for the list, and the list, where another project
      stops the one opening.

### Phase 7: releases

- [ ] 7.1 macOS signing and notarisation (needs an Apple Developer account).
- [x] 7.2 Updates through GitHub Releases (ADR 0051): an AppImage updates itself through
      electron-updater, installed on quit; the unsigned macOS app and a deb are told by a notice.
      electron-updater on macOS waits for 7.1.
- [ ] 7.3 End-to-end tests of the app in CI (F14): under Xvfb on Linux, once Electron's headless
      mode works or with a virtual display.

### Phase 8: later

- [ ] 8.1 Windows: the agent sandbox first (there is none there), then the app; SSH without
      ControlMaster sockets (one ssh process per forward, or a library).
- [ ] 8.2 Tabs: several projects open at once, each in its own view, idle ones stopped after a
      while.

## Open questions

| # | Question | Options | Leaning |
|---|---|---|---|
| Q1 | Shipping the Claude adapter (F2) | Ask Anthropic; download the adapter on first use instead of shipping it, as `npx` does today; ship it | Download on first use until the answer: it costs one 2 MB fetch and keeps the app's own licence clean |
| Q2 | Claude sign-in for people without Claude Code | API key only (now); ask Anthropic for approval to offer claude.ai sign-in | API key now, ask before a release aimed at designers |
| Q3 | Storage without a local repository | A free hosted version keeping the work in the browser's storage; a GitHub integration (designs in a repository, read and written through the API); nothing | Both need the preview and the agents somewhere: the browser cannot run the project's Vite or an agent CLI. A hosted version means a canvas without the real components, or a machine in the cloud. Leave it until the desktop app has users; the GitHub integration first if any, since it keeps designs as files in a repository |
| Q4 | The Changes panel | Kept with git's status and diff; folded into History ([PLAN-revision-history](PLAN-revision-history.md) Phase 4); removed | Fold into History once revisions exist; until then, keep it as it is |
| Q5 | macOS signing | An Apple Developer account (99 USD a year); unsigned builds opened with a right click | Unsigned while it is only you; an account before anyone else installs it |
| Q6 | The Linux package | AppImage, deb, both | Both, the deb recommended (it carries the AppArmor profile and depends on bubblewrap) |
| Q7 | Agent versions | Pinned (now: Claude Code 2.1.308, Codex 0.160.1, matched to the adapters); following the latest | Pinned, raised with the adapters in one change |
| Q8 | The order of Phases 4 to 7 | As listed; releases (7) before machines without tools (5) | As listed: 4 makes it work elsewhere, 5 and 6 widen who it works for, 7 ships it |
