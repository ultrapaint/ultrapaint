# ADR 0013: Agents are confined by the operating system, not by the protocol

Status: accepted, 2026-09-19.

Update, 2026-10-06: the decision stands; the sandbox was tightened where a confined process could
still reach something outside it (commit `499e57c`).

- The variables of a launch are set inside the sandbox, by the sandbox (`--setenv` for
  bubblewrap, `/usr/bin/env` under `sandbox-exec`), and the process that makes it gets none:
  `bwrap` and `sandbox-exec` run unconfined until they have confined what they start, and an
  `LD_PRELOAD` on either would run its library there. Variables an agent asks for a terminal
  command lose `LD_*` and `DYLD_*`, which no command needs and which are a way out when set on
  the wrong side.
- On Linux the session's own temporary directory is its `/tmp` (and `TMPDIR`); the machine's
  `/tmp`, with the sockets and files other programs leave there, is out of reach. macOS keeps
  sharing `/tmp` and the system's temporary directory: Seatbelt cannot give a session one of its
  own, and shell commands expect both writable.
- Bubblewrap gives the agent its own process tree and System V IPC (`--unshare-pid`,
  `--unshare-ipc`), so nothing outside can be signalled, traced or read through `/proc`, and no
  controlling terminal (`--new-session`), so a command cannot push keystrokes into the one the
  server runs in.
- The user's runtime directory (`/run/user/<uid>`) is blanked like the home directory, and
  `DBUS_SESSION_BUS_ADDRESS` unset: the session bus, the user's systemd and the keyring listen
  there, and each would run a command outside the sandbox for whoever asks. A toolchain on
  `PATH` under it (fnm's) is let back read-only.
- The package managers' caches stay writable. The built-in agents start through `npx`, which
  unpacks them into its cache, and a package installed from inside the sandbox fills them;
  read-only, neither works. Nothing of the user's work lives there. They are, with `/tmp` on
  macOS, what "the temporary directories" below now means.

## Decision

An agent process is started inside an operating system sandbox that lets it read the repository,
its own files and the machine's toolchain, and write only the repository, its own files, the
package managers' caches and the temporary directories. Nothing of the user's work lives in the
last two, and shell commands and `npx` need them writable; the home directory is closed to both
reading and writing except for what is listed. Network is not restricted: an agent talks to its model.
Everything the agent starts — its shell, its file tools, an `npx` grandchild — inherits the
sandbox, so the confinement does not depend on which agent runs.

The rules are built in `packages/acp/src/sandbox.ts`, which is pure: a policy in, a launch out.
What this machine needs (the home directory, the toolchain the user's `PATH` points into, the
files git reads its configuration from) is gathered once by the `AgentSandbox` service and does
not change while the server runs. `spawnAcpAgent` takes the resulting launch and knows nothing
about sandboxes.

Terminals the agent asks the client to run go through the same wrapper: a command we run for the
agent must not reach further than one it runs itself.

Two things stay per agent, as data in `AgentConfig`, because only the agent knows them:

- `stateDirs`: where it keeps its login, sessions and caches (`~/.claude/`, `~/.codex/`, …).
  Readable and writable inside the sandbox. `~` and `<uid>` are expanded, and a trailing `/`
  marks a directory, which is made before the launch if it is missing: on Linux nothing can
  come into being in the read-only home from inside.
- `sandboxEnv` and `sandboxMeta`: what stops the agent from starting a sandbox of its own, sent
  as environment and as `session/new` `_meta`. One sandbox cannot start inside another.

A JSON file under `~/.ultrapaint/agents/` carries the same three fields, so a new agent is still
added without code changes.

## What it is for, and what it does not stop

The sandbox keeps an agent's own reads and writes inside the repository: a careless `cat
~/.aws/credentials`, a `find /` that wanders into the home directory, a write meant for the
repository that lands next to it. It is not built to hold an agent that is trying to get out,
and it does not. The routes are all the same shape — the agent writes something into the
repository, or talks to something outside the sandbox, and a process that is not confined does
the rest:

- **Hooks kept in the tree.** A project that points `core.hooksPath` into its own files (husky's
  `.husky/`) has hooks the agent can edit, and they run when the user commits. That is the
  user running the project's code, as `npm test` would be.
- **The preview.** The host runs Vite on the project's own configuration and restarts when it
  changes. The formatter is whatever `node_modules/.bin` holds.
- **The editor itself.** Its API listens on loopback, and the network is open. A browser page from
  another site is turned away by its origin, but a process can send none.
- **Other local processes.** macOS lets a sandboxed process ask Launch Services to open an
  application; anything with a socket in the shared temporary directory (a tmux server, say)
  answers whoever connects.

The next two were read off the code, not tried; the fourth is the general shape of an
allow-by-default Seatbelt profile. Closing them is a different project — a deny-by-default
profile, the preview and the formatter in a sandbox of their own, an API that wants a token only
the user's browser has — each with a cost to what an agent or the editor can do. It was deferred
when the scope was chosen, and is still to be decided.

One route was closed here, because nothing had to be asked for it to be taken. The editor runs
git in the repository on every turn, outside the sandbox, and a hook in `.git/hooks` or a
`core.fsmonitor` in `.git/config` would have run with it — planted by an agent that was careless,
or talked into it by something it read. `.git` is read-only inside the sandbox, under every name
the repository has; `git status`, `diff` and `log` work, and an agent cannot commit, branch or
stash. Everything the editor's own git commands could be made to run has to be written into
`.git` first: hooks, `core.fsmonitor`, filter, textconv and diff drivers. The briefing tells a
confined agent that commits are the user's, so it does not find out by failing.

## Why not the protocol or the agents' own settings

ACP has no way to tell an agent to stay inside a directory, and the `fs/*` and `terminal/*`
handlers the server already guards see almost nothing: Claude Code runs its own Read, Edit, Write
and Bash inside its process, Codex its own shell and `apply_patch`.

Per-agent policies were measured first (spike, `docs/feature/spikes/agent-scope-mcp.md`): a
`PreToolUse` hook plus Claude Code's sandbox settings do contain Claude Code, and Codex's
configuration contains its writes. But they only cover the agent they were written for, and
codex-acp overrides its sandbox configuration on every turn from the current mode. They remain
the fallback where no OS sandbox exists.

Anthropic's `sandbox-runtime` was tried as the generic wrapper and rejected: it refuses an open
network policy and blocks the Keychain, so an agent inside it has no login.

## Where it works

macOS through `sandbox-exec`, Linux through bubblewrap when `bwrap` is installed: the filesystem
read-only, the home directory blanked with a tmpfs and then remounted read-only, and only what
the policy allows bound back over it. Windows has no equivalent.

The thread carries `sandboxed`, so the editor says plainly when the platform cannot confine the
agent rather than implying a guarantee it does not have.

A sandbox that is installed can still refuse to start: a kernel that restricts unprivileged user
namespaces (Ubuntu 24.04's desktop default) stops bubblewrap, and a path it cannot mount stopped
it once. So the sandbox is tried at startup, with this machine's policy around `true`. If it
refuses, agents run unconfined as they would with no sandbox at all, the reason is logged, and
the thread carries it as `sandboxProblem` for the scope chip to show — one reason, once, rather
than every thread failing to start with whatever its agent made of the error.

The repository is allowed under its real name as well as the one it was opened by: Seatbelt
sees the resolved path, and a repository reached through a symlink (`/tmp` on macOS is one)
could not otherwise be written, nor even entered.

A policy never names a path that another path in the same list already contains. That is tidiness
on macOS and necessity on Linux: bubblewrap cannot mount over a symlink that sits inside a mount
it has already made, and fnm puts one on `PATH` (`~/.local/state/fnm_multishells/<pid>`, under
`~/.local`, which `~/.local/bin` had already allowed). It refused, and the agent did not start at
all.

## How it is checked

`apps/server/spike/probe-sandbox.ts` runs shell commands through the real service and the real
launch configuration, with no agent and no model. Eleven probes: the repository readable and
writable, the toolchain and network working, and the home directory, the user's ssh keys and the
next repository over refused. An agent can decline to try, or try in a way that proves nothing; a
shell does what it is told, so this is the check that answers the question, and it costs nothing
to run on a new machine.

Seventeen probes now: the ones above; `.git` readable by git but refused to a config write, a
planted hook and an attempt to move it aside; the same repository opened through a symlink; and — on
Linux — the home directory reached through another process's `/proc/<pid>/root`, which the user
namespace bubblewrap makes refuses, along with that process's environment and working directory.
Its command line stays visible, as it would to `ps` anywhere.

Verified on macOS 15 (Seatbelt) and Ubuntu with bubblewrap 0.11.1, for both built-in agents, and
with a real session of each driven through `verify-scope.ts` on both: started, signed in, read and
wrote the repository, ran git and node, reached the network, and could neither read nor write the
home directory. On Linux a Codex thread also reached the editor's MCP server over loopback from
inside the sandbox and finished a benchmark task with it.
