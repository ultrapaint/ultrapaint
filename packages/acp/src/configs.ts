import type { AgentConfig } from "@ultrapaint/contracts/threads";

/**
 * Launch configurations are data. Adding an agent means adding an entry here or a JSON file
 * under `~/.ultrapaint/agents/`; nothing else in the tool knows which agent runs.
 */
export const builtInAgents: AgentConfig[] = [
  {
    // 0.79 is the first to speak MCP 2026-07-28 by default; npx fetches it when the cache is older.
    args: ["-y", "@agentclientprotocol/claude-agent-acp@^0.85.0"],
    authHint:
      "Uses your Claude Code login (`claude` CLI). Run `claude` once to sign in.",
    builtIn: true,
    command: "npx",
    // Its shell goes back to the repository after every command, so it never has to `cd` there.
    env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" },
    id: "claude-code",
    name: "Claude Code",
    package: "@agentclientprotocol/claude-agent-acp",
    // Claude Code sandboxes its own shell commands; one sandbox cannot start inside another.
    sandboxMeta: {
      claudeCode: { options: { settings: { sandbox: { enabled: false } } } },
    },
    stateDirs: ["~/.claude/", "~/.claude.json", "~/.config/claude/"],
  },
  {
    // 1.1.14 is the first on a Codex that can speak MCP 2026-07-28.
    args: ["-y", "@agentclientprotocol/codex-acp@^2.1.1"],
    authHint:
      "Uses your Codex login (`codex` CLI). Run `codex login` once to sign in.",
    builtIn: true,
    command: "npx",
    // Merged into every session's configuration. MCP 2026-07-28 is behind a flag Codex has not
    // turned on yet; without it Codex asks the editor for 2025-06-18.
    env: {
      CODEX_CONFIG: JSON.stringify({ features: { mcp_2026_07_28: true } }),
    },
    id: "codex",
    name: "Codex",
    package: "@agentclientprotocol/codex-acp",
    // Same: Codex runs every turn in a sandbox of its own unless it is told not to.
    sandboxEnv: { INITIAL_AGENT_MODE: "agent-full-access" },
    stateDirs: ["~/.codex/"],
  },
];
