import { describe, expect, it } from "@effect/vitest";
import { BuiltInAgentId } from "@ultrapaint/contracts/threads";
import { claudeSignIn } from "./built-in/claude-code.ts";
import { codexSignIn } from "./built-in/codex.ts";
import { BUILT_IN_AGENTS, builtInLaunches } from "./built-in.ts";

/** What the CLIs printed (Claude Code 2.1.311, codex-cli 0.164.0), the account's own details changed. */
const recorded = {
  claudeApiKey: `{
  "loggedIn": true,
  "authMethod": "api_key",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/home/me/.claude/projects",
  "configDirectory": "/home/me/.claude",
  "apiKeySource": "ANTHROPIC_API_KEY"
}
`,
  claudeSignedIn: `{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/home/me/.claude/projects",
  "configDirectory": "/home/me/.claude",
  "email": "me@example.com",
  "orgId": "00000000-0000-0000-0000-000000000000",
  "orgName": "me@example.com's Organization",
  "subscriptionType": "max"
}
`,
  claudeSignedOut: `{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/home/me/.claude/projects",
  "configDirectory": "/home/me/.claude"
}
`,
  codexSignedIn: "Logged in using ChatGPT\n",
  codexSignedOut: `WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp" (codex_home: AbsolutePathBuf("/tmp/home/.codex"))
Not logged in
`,
};

describe("claude auth status", () => {
  it("reads the JSON it prints: signed in with claude.ai, with a key, or not", () => {
    expect(
      claudeSignIn({
        exitCode: 0,
        stderr: "",
        stdout: recorded.claudeSignedIn,
      })
    ).toEqual({ how: "with claude.ai", signedIn: true });
    expect(
      claudeSignIn({ exitCode: 0, stderr: "", stdout: recorded.claudeApiKey })
    ).toEqual({ how: "with an API key", signedIn: true });
    expect(
      claudeSignIn({
        exitCode: 1,
        stderr: "",
        stdout: recorded.claudeSignedOut,
      })
    ).toEqual({ how: undefined, signedIn: false });
  });

  it("falls back to the exit code when a Claude Code without the command prints no JSON", () => {
    expect(
      claudeSignIn({
        exitCode: 1,
        stderr: "error: unknown command 'auth'\n",
        stdout: "",
      })
    ).toEqual({ how: undefined, signedIn: false });
    expect(
      claudeSignIn({ exitCode: 0, stderr: "", stdout: "Logged in\n" })
    ).toEqual({ how: undefined, signedIn: true });
  });
});

describe("codex login status", () => {
  it("is signed in when it exits 0, and says how on stderr", () => {
    expect(
      codexSignIn({ exitCode: 0, stderr: recorded.codexSignedIn, stdout: "" })
    ).toEqual({ how: "with ChatGPT", signedIn: true });
    expect(
      codexSignIn({ exitCode: 1, stderr: recorded.codexSignedOut, stdout: "" })
    ).toEqual({ how: undefined, signedIn: false });
  });
});

describe("the built-in agents", () => {
  it("are one descriptor for each id the shell bridge names, under its own id", () => {
    expect(Object.keys(BUILT_IN_AGENTS)).toEqual(BuiltInAgentId.literals);
    for (const [id, agent] of Object.entries(BUILT_IN_AGENTS)) {
      expect(agent.id).toBe(id);
    }
  });

  it("are launched through npx by the command, as they were before the descriptors", () => {
    const [claude, codex] = builtInLaunches;
    expect(claude).toMatchObject({
      args: ["-y", "@agentclientprotocol/claude-agent-acp@^0.85.0"],
      builtIn: true,
      command: "npx",
      env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" },
      id: "claude-code",
      name: "Claude Code",
      package: "@agentclientprotocol/claude-agent-acp",
      stateDirs: ["~/.claude/", "~/.claude.json", "~/.config/claude/"],
    });
    expect(claude?.sandboxEnv).toBeUndefined();
    expect(codex).toMatchObject({
      args: ["-y", "@agentclientprotocol/codex-acp@^2.1.1"],
      builtIn: true,
      command: "npx",
      id: "codex",
      name: "Codex",
      package: "@agentclientprotocol/codex-acp",
      sandboxEnv: { INITIAL_AGENT_MODE: "agent-full-access" },
      stateDirs: ["~/.codex/"],
    });
    expect(codex?.sandboxMeta).toBeUndefined();
  });
});
