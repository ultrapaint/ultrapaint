import type { AgentConfig } from "@ultrapaint/contracts";

/**
 * Launch configurations are data. Adding an agent means adding an entry here or a JSON file
 * under `~/.ultrapaint/agents/`; nothing else in the tool knows which agent runs.
 */
export const builtInAgents: AgentConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    env: {},
    package: "@agentclientprotocol/claude-agent-acp",
    authHint: "Uses your Claude Code login (`claude` CLI). Run `claude` once to sign in.",
    builtIn: true,
  },
  {
    id: "codex",
    name: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
    env: {},
    package: "@agentclientprotocol/codex-acp",
    authHint: "Uses your Codex login (`codex` CLI). Run `codex login` once to sign in.",
    builtIn: true,
  },
];
