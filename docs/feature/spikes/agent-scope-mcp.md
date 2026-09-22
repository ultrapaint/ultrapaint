# Spike M0: agent scope, network and MCP

Run on 2026-09-19 on macOS against `@agentclientprotocol/claude-agent-acp` 0.79.0 (Claude Code
2.1.272) and `@agentclientprotocol/codex-acp` 1.12.0 (codex-cli 0.154.0). Harness and fixtures:
`packages/acp/spike/`.

- `agent-scope.mjs <claude|codex> [scenario...] [--mcp url] [--no-policy | --seatbelt | --srt]` builds a throwaway
  repository, a secret outside it in the temp dir and one in `$HOME`, starts the agent with the
  policy under test, approves every permission request (so only the policy stops the agent),
  and scores each scenario.
- `scope-guard.mjs` is the Claude Code `PreToolUse` hook.
- `mcp-server.ts` is a Streamable HTTP MCP server on Effect's `McpServer`.

## Decisions this spike serves

Scope (b): reads and writes confined to the repository. Global `~/.claude` stays loaded. Agent
shells have network. And the mechanism must work for **any ACP agent**, not only the two built in.

## Result: one OS sandbox around the agent process, the same for every agent

ACP has no sandbox field, and the per-agent policies below (a Claude hook, Codex config) only
cover the agents they were written for. What covers every agent is starting the agent process
itself inside a sandbox profile. Everything it spawns (its shell, its tools, `npx` grandchildren)
inherits it.

On macOS that is `sandbox-exec` with a profile we generate per session (`--seatbelt` in the
harness):

```scheme
(version 1)
(allow default)
(deny file-read-data (subpath "$HOME"))
(allow file-read-data (subpath "<root>") <agent home dirs> <toolchain dirs> <git config files>
                      (subpath "~/.npm") (subpath "~/Library/Keychains") (subpath "~/Library/Caches"))
(deny file-write* (subpath "/"))
(allow file-write* (subpath "<root>") <agent home dirs> (subpath "~/.npm") (subpath "~/Library/Keychains")
                   (subpath "~/Library/Caches") (subpath "<session TMPDIR>") (subpath "/tmp/claude-<uid>")
                   (subpath "/dev"))
```

with `TMPDIR` pointed at a temp dir of the session's own. Network is not restricted.

Claude Code under it, with **no Claude-specific settings at all** (no hook, no `_meta`), the
outside directory placed under `$HOME`:

| Scenario | Result |
|---|---|
| read, write inside the repository | work |
| Read / Grep / Write tools outside (in `$HOME`) | refused (`Operation not permitted`) |
| `cat`, `echo >` outside in Bash | refused |
| `node --version && git status` | works |
| `curl https://registry.npmjs.org/` | 200 |
| MCP tool over http | called |
| login (macOS Keychain) | works |

Codex under it (mode `agent-full-access`, since its own Seatbelt cannot start inside ours):
the adapter starts, logs in and reaches OpenAI; prompts are refused by the account's usage
limit until 2026-09-22, so the scenarios are still to run.

What the agent-agnostic sandbox needs as data, per agent (`AgentConfig`): the home directories the
agent keeps its login and sessions in (`~/.claude`, `~/.claude.json` for Claude Code, `~/.codex`
for Codex). A custom agent's JSON file lists its own; the rest is computed per session.

Findings:

- **Nested Seatbelt is refused.** Codex's own sandbox fails inside ours (`sandbox_apply:
  Operation not permitted`). Under the outer sandbox, agents run with their own sandboxes off
  (Codex in `agent-full-access`); ours does the scoping. That also removes the codex-acp problem
  below: network is ours to decide, not the mode's.
- **Anthropic's `sandbox-runtime` (`srt`) does not fit.** It is built to confine untrusted
  commands: it refuses `"*"` as an allowed domain (no open network) and blocks the Keychain, so
  Claude Code inside it has no login.
- **Temp dirs.** Denying all of `/tmp` breaks Claude Code (`/tmp/claude-<uid>`); a
  per-session `TMPDIR` plus that one directory is enough.
- **Git config includes** (`~/.gitconfig.private`) must be readable:
  `git config --global --list --show-origin --includes`.
- **Claude Code defers MCP tool schemas**: the first use of an MCP tool costs a `ToolSearch`
  call. Relevant to the tool-call benchmark.
- Not covered: Linux (bubblewrap is the equivalent, untested) and Windows (no equivalent; there
  the per-agent policies below are the fallback).

The per-agent experiments below are kept for the record; they are the fallback where no OS
sandbox is available.

## Today, without a policy

The ACP `fs/*` handlers in `threads.ts` see almost nothing: Claude Code runs its own Read, Edit,
Write, Grep, Glob and Bash in its process, Codex its own shell and `apply_patch`. `RepoPaths`
never sees a normal file operation.

## Per-agent fallback: Claude Code settings

Policy, passed as `session/new` `_meta.claudeCode.options`. The adapter hands `settings` to the
SDK as flag settings, which rank above user and project settings, and it merges with the user's
own hooks rather than replacing them.

```jsonc
{
  "additionalDirectories": [],
  "settings": {
    "hooks": { "PreToolUse": [{ "matcher": "Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead|Glob|Grep|LS",
      "hooks": [{ "type": "command", "command": "\"<process.execPath>\" \"<scope-guard.mjs>\" \"<root>\" || exit 2" }] }] },
    "sandbox": {
      "enabled": true, "failIfUnavailable": true, "autoAllowBashIfSandboxed": true,
      "allowUnsandboxedCommands": false,
      "filesystem": { "denyRead": ["~"], "allowRead": ["<root>", "<toolchain dirs>", "<git config files>"] },
      "network": { "allowedDomains": ["*"] }
    }
  }
}
```

| Scenario | Result |
|---|---|
| Read, Grep, Write tools inside the repository | work |
| Read tool on a file in the temp dir / in `$HOME` | refused by the hook |
| Grep tool over a directory outside | refused by the hook |
| Write tool outside | refused by the hook |
| `cat ~/secret` in Bash | refused by the sandbox (`Operation not permitted`) |
| `echo x > /outside/file` in Bash | refused by the sandbox |
| `cat /tmp/.../secret` in Bash | **readable**, by choice (see below) |
| `node --version && git status` in Bash | works once the toolchain is allowed (see below) |
| `curl https://registry.npmjs.org/` in Bash | 200, no prompt |
| MCP tool over http | called, result returned |

Findings that shape M1:

1. **The hook must use an absolute interpreter.** With `node …` the hook ran through the user's
   `node` shim (vite-plus), which fails inside Claude's hook shell. A hook that fails is
   *non-blocking*: the first runs let every read through. The command is now
   `"<process.execPath>" guard.mjs <root> || exit 2`, so a crashing guard blocks (exit 2)
   instead of allowing.
2. **Sandbox reads: deny `~`, not the temp dirs.** Denying `/tmp` and `/private/var/folders`
   also blocked Claude's own state (`/tmp/claude-<uid>/cwd-*`) and broke every command. The
   system temp dirs stay readable to Bash; the file tools are still refused there by the hook.
3. **The toolchain lives under `~`.** `denyRead: ["~"]` needs `allowRead` for what the shell
   runs: every `PATH` entry under `$HOME` (its parent when it ends in `bin`), the package
   manager caches (`~/Library/pnpm`, `~/.npm`, `~/.cache`, `~/.bun`, …) and git's config files,
   including the ones it includes (`~/.gitconfig.private` broke `git status`). Computed at
   session start, not hard-coded.
4. **`node` from inside agent shells fails on this machine without any policy too** (`vp:
   Recursion detected but no 'node' found in PATH`). It is the vite-plus shim, not the sandbox:
   the absolute node binary runs fine under the sandbox. Worth a note in the README; not ours to
   fix.
5. User hooks keep running next to ours (the rtk hook printed in Bash output), as decided.

## Per-agent fallback: Codex config (and why codex-acp's modes defeat it)

`codex sandbox` (no model needed) with `sandbox_mode = "workspace-write"`:

| Probe | Result |
|---|---|
| read a file in the temp dir / in `$HOME` | readable (Seatbelt allows all reads; accepted, decision (i)) |
| write in the repository | works |
| write in `$HOME` | refused |
| write in `/tmp`, `$TMPDIR` | allowed by default; refused with `exclude_slash_tmp` and `exclude_tmpdir_env_var` |
| network | refused by default; works with `sandbox_workspace_write.network_access = true` |

**But codex-acp ignores that configuration for the sandbox.** Every `session/prompt` sends the
current mode's own `sandboxPolicy` to Codex (`runTurn({ sandboxPolicy: agentMode.sandboxPolicy
… })`), and the modes are hard-coded:

| Mode | Sandbox |
|---|---|
| `read-only` "Ask for approval" | workspace-write, network off, `/tmp` writable |
| `agent` "Approve for me" (default) | workspace-write, network off, `/tmp` writable |
| `agent-full-access` "Full access" | **none** |

So under codex-acp 1.12, through ACP:

- Writes stay in the repository plus the temp dirs, as long as the thread is not in Full access.
- Network is off in the sandbox. Codex asks to escalate (`network access to <host>`), and that
  reaches our permission UI; "remember" makes it once per thread, not "yes".
- Full access must be refused by our `setMode` and hidden in the editor.

**Run since, against the implementation** (`verify-scope.ts codex`, 2026-09-22): none of that
matters any more, because the OS sandbox is outside the agent. Codex reads inside the repository,
and outside it gets `Operation not permitted` from both its file tool and its shell — for the
home directory and for a temp directory alike. Writing outside fails the same way. Network works
without any escalation prompt, because the sandbox does not restrict it and `agent-full-access`
stops Codex starting a sandbox of its own. The toolchain runs inside the sandbox: `node
--version` and `git --version` both answer.

The options for Codex network are moot: the sandbox it would have escalated out of is not the
one confining it.

## MCP on Effect

`McpServer.layerHttp` mounted on an `HttpRouter` serves initialize, `tools/list` and
`tools/call` over Streamable HTTP, and Claude Code called the tool when handed the server as
`mcpServers: [{ type: "http", name, url, headers: [] }]` in `session/new`.

- A tool without parameters must omit `parameters`. `parameters: Schema.Struct({})` fails at
  startup with `SchemaError: Missing key at ["type"]`.
- Tools default to `destructiveHint: true, openWorldHint: true`; the read tools need their
  annotations set.
- `layerHttp` has no authentication and serves one path. The token that ties a request to a
  thread has to be checked in front of it (a header the agent sends from `mcpServers[].headers`,
  checked by middleware), and a tool that needs the calling thread reads it from there. That is
  the M4 design question, not a blocker.
- Codex is handed the same server the same way (http transport listed in codex-acp's features),
  and uses it: one `use-component` run on the mcp arm went `get_context`, `read_page`,
  `get_component`, `focus`, one edit, `read_page` — 8 calls, 33s, correct work. `focus` means its
  presence reaches the canvas like any other agent's.

## What the implementation then found

Three things the harness could not show, caught by `apps/server/spike/verify-scope.ts`, which
drives a real agent through the service and the launch configuration the server itself uses:

- **A `PATH` entry of `$HOME/bin` opened the whole home directory.** Allowing the parent of a
  `bin` directory (right for `~/.local/bin`) resolves to `~` for `~/bin`, and Claude Code's Read
  tool then read a file in the home directory. The home directory is never allowed as a toolchain
  path now.
- **`/tmp` is a symlink to `/private/tmp`.** A rule written for one name does not match the other,
  so every Bash command failed on its working directory. Each allowed path is resolved and listed
  under both names.
- **The Keychain is where the login is.** Without `~/Library/Keychains` the agent starts and then
  answers "Authentication required".

The caches and the temporary directories are writable: `npx` unpacks the agent into a cache and
shell commands expect a writable `/tmp`. Neither holds any work of the user's.

## What changes in the plan

- M1: the scope is an OS sandbox around every agent process, generated per session from the
  repository root, the agent's home directories (data in `AgentConfig`) and the machine's
  toolchain. macOS first, Linux (bubblewrap) next, per-agent fallback elsewhere.
- The Codex (i) compromise is no longer needed: its reads are confined like any other agent's.
- M4: MCP auth via a per-thread header checked in front of `layerHttp`.
