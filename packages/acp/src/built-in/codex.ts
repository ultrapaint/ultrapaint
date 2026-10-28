/** Codex, as the tool starts it, finds it and asks whether it is signed in. */
import type { BuiltInAgent, CommandOutput } from "../built-in.ts";

const LOGGED_IN_RE = /^Logged in using (.+)$/;

/** What `codex login status` says: signed in when it exits 0, and how, in its own words. */
export const codexSignIn = (output: CommandOutput) => {
  const line = `${output.stdout}\n${output.stderr}`
    .split("\n")
    .map((l) => LOGGED_IN_RE.exec(l.trim()))
    .find((match) => match !== null);
  return {
    how: output.exitCode === 0 && line?.[1] ? `with ${line[1]}` : undefined,
    signedIn: output.exitCode === 0,
  };
};

export const codex: BuiltInAgent<"codex"> = {
  adapter: {
    bundle: "codex-acp",
    entry: "dist/index.js",
    external: ["@openai/codex-*"],
    package: "@agentclientprotocol/codex-acp",
    // 1.1.14 is the first on a Codex that can speak MCP 2026-07-28.
    range: "^2.1.1",
  },
  executable: {
    /** codex-acp runs it in place of the `@openai/codex` it depends on. */
    env: "CODEX_PATH",
    install: "https://developers.openai.com/codex/cli",
    program: "codex",
  },
  id: "codex",
  launch: {
    authHint:
      "Uses your Codex login (`codex` CLI). Run `codex login` once to sign in.",
    // Merged into every session's configuration. MCP 2026-07-28 is behind a flag Codex has not
    // turned on yet; without it Codex asks the editor for 2025-06-18.
    env: {
      CODEX_CONFIG: JSON.stringify({ features: { mcp_2026_07_28: true } }),
    },
    // Same: Codex runs every turn in a sandbox of its own unless it is told not to.
    sandboxEnv: { INITIAL_AGENT_MODE: "agent-full-access" },
    stateDirs: ["~/.codex/"],
  },
  name: "Codex",
  signIn: {
    // The adapter opens the browser and answers once the sign-in is done there.
    adapter: { method: "chat-gpt", with: "ChatGPT" },
    parse: codexSignIn,
    status: ["login", "status"],
    yourself: "run `codex login` in a terminal",
  },
};
