import type { AgentConfig } from "@ultrapaint/contracts/threads";

/**
 * Launch configurations are data. Adding an agent means adding an entry here or a JSON file
 * under `~/.ultrapaint/agents/`; nothing else in the tool knows which agent runs.
 */
export const builtInAgents: AgentConfig[] = [
  {
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    authHint:
      "Uses your Claude Code login (`claude` CLI). Run `claude` once to sign in.",
    builtIn: true,
    command: "npx",
    env: {},
    id: "claude-code",
    name: "Claude Code",
    package: "@agentclientprotocol/claude-agent-acp",
    // Claude Code sandboxes its own shell commands; one sandbox cannot start inside another.
    sandboxMeta: {
      claudeCode: { options: { settings: { sandbox: { enabled: false } } } },
    },
    stateDirs: ["~/.claude", "~/.claude.json", "~/.config/claude"],
  },
  {
    args: ["-y", "@agentclientprotocol/codex-acp"],
    authHint:
      "Uses your Codex login (`codex` CLI). Run `codex login` once to sign in.",
    builtIn: true,
    command: "npx",
    env: {},
    id: "codex",
    name: "Codex",
    package: "@agentclientprotocol/codex-acp",
    // Same: Codex runs every turn in a sandbox of its own unless it is told not to.
    sandboxEnv: { INITIAL_AGENT_MODE: "agent-full-access" },
    stateDirs: ["~/.codex"],
  },
];
