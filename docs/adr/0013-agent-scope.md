# ADR 0013: Agents are confined by the operating system, not by the protocol

Status: accepted, 2026-09-19.

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

- `stateDirs`: where it keeps its login, sessions and caches (`~/.claude`, `~/.codex`, …).
  Readable and writable inside the sandbox. `~` and `<uid>` are expanded.
- `sandboxEnv` and `sandboxMeta`: what stops the agent from starting a sandbox of its own, sent
  as environment and as `session/new` `_meta`. One sandbox cannot start inside another.

A JSON file under `~/.ultrapaint/agents/` carries the same three fields, so a new agent is still
added without code changes.

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

macOS, through `sandbox-exec`. Linux (bubblewrap) is next, and the thread carries `sandboxed` so
the editor says plainly when the platform cannot confine the agent rather than implying a
guarantee it does not have.
