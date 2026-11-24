import { assert, describe, it } from "@effect/vitest";
import type { AgentRuntime } from "@ultrapaint/acp/runtime";
import { Effect, Layer } from "effect";
import { ServerConfig } from "./config.ts";
import type { CommandResult } from "./process.ts";
import {
  type FakeMachine,
  OutsideAgents,
  type Ran,
} from "./services/outside-agents.ts";

const HOME = "/home/u";
const ok: CommandResult = { exitCode: 0, stderr: "", stdout: "" };
/** What both agents answer `mcp get` for a server they do not list. */
const none: CommandResult = {
  exitCode: 1,
  stderr: 'No MCP server named "ultrapaint" found.',
  stdout: "",
};
const both = { claude: "/usr/bin/claude", codex: "/usr/bin/codex" };

const on = (machine: FakeMachine, agentRuntime?: AgentRuntime) =>
  OutsideAgents.layerTest(machine).pipe(
    Layer.provide(
      ServerConfig.layerTest({ agentRuntime, machine: { home: HOME } })
    )
  );

/** The desktop app's runtime, as it hands the server the agents it found. */
const runtimeWith = (agents: AgentRuntime["agents"]): AgentRuntime => ({
  agents,
  node: "/app/electron",
  reads: [],
  wrapper: "/app/run.mjs",
});

/** The desktop app's runtime: Claude Code found off the PATH, Codex the app's own download. */
const desktopRuntime = runtimeWith({
  "claude-code": {
    adapter: "/app/claude-agent-acp.mjs",
    env: { CLAUDE_CODE_EXECUTABLE: "/opt/claude/bin/claude" },
  },
  codex: {
    adapter: "/app/codex-acp.mjs",
    downloaded: true,
    env: { CODEX_PATH: "/app-data/agents/codex/0.171.0/codex" },
  },
});

/** That runtime on a machine with no Codex of the person's own on the server's PATH. */
const desktop = on(
  { answer: () => ok, programs: { claude: both.claude } },
  desktopRuntime
);

/** A machine on which `add` makes `get` answer that the agent lists Ultrapaint. */
const registering = (programs: FakeMachine["programs"]): FakeMachine => {
  const added = new Set<string>();
  return {
    answer: ({ args, command }) => {
      if (args[1] === "add") {
        added.add(command);
        return ok;
      }
      return added.has(command) ? ok : none;
    },
    programs,
  };
};

/** A machine whose Claude Code lists Ultrapaint and whose Codex does not. */
const claudeListsIt: FakeMachine = {
  answer: ({ command }) => (command === both.claude ? ok : none),
  programs: { ...both, ultrapaint: "/usr/bin/ultrapaint" },
};

describe("the outside agents' connection (ADR 0144)", () => {
  it.effect(
    "says an agent is connected when its `mcp get` exits 0, and not connected when it exits 1",
    () =>
      Effect.gen(function* () {
        const state = yield* (yield* OutsideAgents).state;
        assert.deepStrictEqual(state.agents, [
          { id: "claude-code", status: "connected" },
          { id: "codex", status: "not-connected" },
        ]);
      }).pipe(Effect.provide(on(claudeListsIt)))
  );

  it.effect(
    "asks each agent itself, in the home folder, every time it is asked",
    () =>
      Effect.gen(function* () {
        const agents = yield* OutsideAgents;
        yield* agents.state;
        yield* agents.state;
        const gets = (yield* agents.ran).filter((r) => r.args[1] === "get");
        const once = [
          {
            args: ["mcp", "get", "ultrapaint"],
            command: "/usr/bin/claude",
            cwd: HOME,
          },
          {
            args: ["mcp", "get", "ultrapaint"],
            command: "/usr/bin/codex",
            cwd: HOME,
          },
        ];
        // Asked again, never remembered.
        assert.deepStrictEqual(gets, [...once, ...once]);
      }).pipe(Effect.provide(on(claudeListsIt)))
  );

  it.effect(
    "says an agent with no program is not installed, with where to install it from",
    () =>
      Effect.gen(function* () {
        const state = yield* (yield* OutsideAgents).state;
        assert.deepStrictEqual(state.agents[1], {
          id: "codex",
          install: "https://developers.openai.com/codex/cli",
          status: "not-installed",
        });
        assert.isFalse(state.commandOnPath);
      }).pipe(Effect.provide(on({ programs: { claude: both.claude } })))
  );

  it.effect("says an agent that does not answer in time didn't, with why", () =>
    Effect.gen(function* () {
      const state = yield* (yield* OutsideAgents).state;
      assert.strictEqual(state.agents[0]?.status, "unanswered");
      assert.include(state.agents[0]?.message ?? "", "didn’t answer");
    }).pipe(Effect.provide(on({ answer: () => undefined, programs: both })))
  );

  it.effect(
    "says an agent that can't read its configuration didn't answer, in its own words, though it exits 1",
    () =>
      Effect.gen(function* () {
        const state = yield* (yield* OutsideAgents).state;
        assert.deepStrictEqual(state.agents[1], {
          id: "codex",
          message: "Error: failed to load bootstrap configuration",
          status: "unanswered",
        });
      }).pipe(
        Effect.provide(
          on({
            answer: () => ({
              exitCode: 1,
              stderr: "Error: failed to load bootstrap configuration\n",
              stdout: "",
            }),
            programs: both,
          })
        )
      )
  );

  it.effect(
    "says an agent that fails to answer `mcp get` didn't, in its own words",
    () =>
      Effect.gen(function* () {
        const state = yield* (yield* OutsideAgents).state;
        assert.deepStrictEqual(state.agents[0], {
          id: "claude-code",
          message: "Error: ~/.claude.json is not valid JSON",
          status: "unanswered",
        });
      }).pipe(
        Effect.provide(
          on({
            answer: () => ({
              exitCode: 2,
              stderr: "Error: ~/.claude.json is not valid JSON\n",
              stdout: "",
            }),
            programs: both,
          })
        )
      )
  );

  it.effect(
    "connects an agent by running its own line in the home folder, then asking it again",
    () =>
      Effect.gen(function* () {
        const agents = yield* OutsideAgents;
        const connected = yield* agents.connect("claude-code");
        assert.deepStrictEqual(connected, {
          agent: { id: "claude-code", status: "connected" },
          commandOnPath: true,
        });
        const ran: readonly Ran[] = yield* agents.ran;
        assert.deepStrictEqual(ran[0], {
          args: [
            "mcp",
            "add",
            "ultrapaint",
            "-s",
            "user",
            "--",
            "ultrapaint",
            "mcp",
          ],
          command: "/usr/bin/claude",
          cwd: HOME,
        });
        assert.deepStrictEqual(ran[1]?.args, ["mcp", "get", "ultrapaint"]);
      }).pipe(
        Effect.provide(
          on(registering({ ...both, ultrapaint: "/usr/bin/ultrapaint" }))
        )
      )
  );

  it.effect(
    "connects an agent whose `ultrapaint` command is not on the PATH, and says so",
    () =>
      Effect.gen(function* () {
        const connected = yield* (yield* OutsideAgents).connect("codex");
        assert.strictEqual(connected.agent.status, "connected");
        assert.isFalse(connected.commandOnPath);
      }).pipe(Effect.provide(on(registering(both))))
  );

  it.effect(
    "fails with the command's own message, its errors else what it printed",
    () =>
      Effect.gen(function* () {
        const agents = yield* OutsideAgents;
        const claude = yield* Effect.flip(agents.connect("claude-code"));
        assert.strictEqual(claude._tag, "CommandFailed");
        assert.strictEqual(
          claude.message,
          "MCP server ultrapaint already exists in user config"
        );
        const codex = yield* Effect.flip(agents.connect("codex"));
        assert.strictEqual(codex.message, "Error: config.toml is not writable");
      }).pipe(
        Effect.provide(
          on({
            answer: ({ args, command }) => {
              if (args[1] !== "add") {
                return none;
              }
              return command === both.claude
                ? {
                    exitCode: 1,
                    stderr:
                      "MCP server ultrapaint already exists in user config\n",
                    stdout: "",
                  }
                : {
                    exitCode: 1,
                    stderr: "",
                    stdout: "Error: config.toml is not writable\n",
                  };
            },
            programs: both,
          })
        )
      )
  );

  it.effect("runs the program the desktop app found for an agent", () =>
    Effect.gen(function* () {
      const agents = yield* OutsideAgents;
      const state = yield* agents.state;
      assert.strictEqual(state.agents[0]?.status, "connected");
      const commands = (yield* agents.ran).map((r) => r.command);
      assert.deepStrictEqual(commands, ["/opt/claude/bin/claude"]);
    }).pipe(Effect.provide(desktop))
  );

  it.effect(
    "reads the copy the desktop app downloaded as no agent of the person's, and runs nothing of it",
    () =>
      Effect.gen(function* () {
        const agents = yield* OutsideAgents;
        const state = yield* agents.state;
        assert.deepStrictEqual(state.agents[1], {
          id: "codex",
          install: "https://developers.openai.com/codex/cli",
          status: "not-installed",
        });
        const refused = yield* Effect.flip(agents.connect("codex"));
        assert.include(refused.message, "Codex isn’t installed");
        const ran = (yield* agents.ran).map((r) => r.command);
        assert.notInclude(ran.join(" "), "codex");
      }).pipe(Effect.provide(desktop))
  );

  it.effect(
    "runs the person's own copy on the server's PATH where the desktop app runs its download",
    () =>
      Effect.gen(function* () {
        const agents = yield* OutsideAgents;
        const state = yield* agents.state;
        assert.strictEqual(state.agents[1]?.status, "connected");
        const commands = (yield* agents.ran).map((r) => r.command);
        assert.include(commands, "/usr/bin/codex");
      }).pipe(
        Effect.provide(on({ answer: () => ok, programs: both }, desktopRuntime))
      )
  );
});
