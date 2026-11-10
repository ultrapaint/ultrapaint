/** Claude Code, as the tool starts it, finds it and asks whether it is signed in. */
import { Option, Schema } from "effect";
import type { BuiltInAgent, CommandOutput } from "../built-in.ts";

const ClaudeAuth = Schema.fromJsonString(
  Schema.Struct({
    authMethod: Schema.optional(Schema.String),
    loggedIn: Schema.Boolean,
  })
);
const decodeClaudeAuth = Schema.decodeUnknownOption(ClaudeAuth);

/** How it says it signed in, in the app's words; another method is said as it names it. */
const HOW: Readonly<Record<string, string>> = {
  api_key: "with an API key",
  "claude.ai": "with claude.ai",
};

/** What `claude auth status` says, as a sign-in: its JSON, or failing that its exit code. */
export const claudeSignIn = (output: CommandOutput) =>
  Option.match(decodeClaudeAuth(output.stdout.trim()), {
    onNone: () => ({ how: undefined, signedIn: output.exitCode === 0 }),
    onSome: (auth) => ({
      how:
        auth.authMethod === undefined || auth.authMethod === "none"
          ? undefined
          : (HOW[auth.authMethod] ?? auth.authMethod),
      signedIn: auth.loggedIn,
    }),
  });

export const claudeCode: BuiltInAgent<"claude-code"> = {
  adapter: {
    bundle: "claude-agent-acp",
    entry: "dist/index.js",
    external: ["@anthropic-ai/claude-agent-sdk-*"],
    package: "@agentclientprotocol/claude-agent-acp",
    // Every version in the range speaks MCP 2026-07-28 by default, as 0.79 and later do
    // (ADR 0022); npx fetches one when the cache is older.
    range: "^0.85.0",
  },
  apiKeyEnv: "ANTHROPIC_API_KEY",
  env: {
    // The release the app downloaded stays the one it checked: Claude Code updating itself
    // would also put a launcher in the user's ~/.local/bin.
    download: { DISABLE_AUTOUPDATER: "1" },
  },
  executable: {
    /** claude-agent-acp's `claudeCliPath()` takes it before its own SDK's binary. */
    env: "CLAUDE_CODE_EXECUTABLE",
    install: "https://code.claude.com/docs/en/setup",
    program: "claude",
  },
  id: "claude-code",
  launch: {
    authHint:
      "Uses your Claude Code login (`claude` CLI). Run `claude` once to sign in.",
    // Its shell goes back to the repository after every command, so it never has to `cd` there.
    env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" },
    // Claude Code sandboxes its own shell commands; one sandbox cannot start inside another.
    sandboxMeta: {
      claudeCode: { options: { settings: { sandbox: { enabled: false } } } },
    },
    stateDirs: ["~/.claude/", "~/.claude.json", "~/.config/claude/"],
  },
  name: "Claude Code",
  /**
   * No sign-in through the adapter: a third-party product may not offer claude.ai sign-in
   * without Anthropic's approval. The user signs in with Claude Code itself, or gives a key.
   */
  signIn: {
    parse: claudeSignIn,
    status: ["auth", "status"],
    yourself: "run `claude` once in a terminal",
  },
};
