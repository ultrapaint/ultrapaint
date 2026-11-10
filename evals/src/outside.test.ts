import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { Browser } from "./browser.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  agentCommand,
  generateOutside,
  type OutsideHost,
  type OutsideOptions,
  readClaudeEvents,
  readCodexEvents,
} from "./outside.ts";
import { skillReads } from "./pairwise.ts";
import type { LoadedReference } from "./reference.ts";
import { readData, TestData, writeData } from "./test-data.ts";
import { scriptedProcesses } from "./test-processes.ts";

const APP = "/work/app";

const codexLines = [
  "a line of its log",
  JSON.stringify({
    item: {
      command: `cat ${APP}/.agents/skills/ultrapaint/SKILL.md`,
      exit_code: 0,
      type: "command_execution",
    },
    type: "item.completed",
  }),
  JSON.stringify({
    item: {
      command: "ls nowhere <<'EOF'\nthe lines of a file it writes\nEOF",
      exit_code: 2,
      type: "command_execution",
    },
    type: "item.completed",
  }),
  JSON.stringify({
    item: {
      changes: [{ kind: "update", path: `${APP}/src/App.tsx` }],
      type: "file_change",
    },
    type: "item.completed",
  }),
  JSON.stringify({
    item: { text: "The page is built.", type: "agent_message" },
    type: "item.completed",
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 900, output_tokens: 100 },
  }),
];

const claudeLines = [
  JSON.stringify({
    message: {
      content: [
        {
          id: "t1",
          input: { skill: "ultrapaint" },
          name: "Skill",
          type: "tool_use",
        },
        {
          id: "t2",
          input: {
            file_path: `${APP}/.claude/skills/ultrapaint/references/kinds/dialog.md`,
          },
          name: "Read",
          type: "tool_use",
        },
        {
          id: "t3",
          input: { command: "pnpm build" },
          name: "Bash",
          type: "tool_use",
        },
        {
          id: "t4",
          input: { file_path: `${APP}/src/App.tsx` },
          name: "Write",
          type: "tool_use",
        },
      ],
      model: "claude-opus-5-5",
    },
    type: "assistant",
  }),
  JSON.stringify({
    message: {
      content: [{ is_error: true, tool_use_id: "t3", type: "tool_result" }],
    },
    type: "user",
  }),
  JSON.stringify({
    message: { content: [{ text: "Built the dialog.", type: "text" }] },
    type: "assistant",
  }),
  JSON.stringify({
    type: "result",
    usage: {
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 500,
      input_tokens: 40,
      output_tokens: 50,
    },
  }),
];

describe("a run outside the editor", () => {
  it("runs the agent's own command in the app, with the person's own settings left out of Claude's", () => {
    const input = { cwd: APP, model: "gpt-6.1-sol", prompt: "Build it." };
    assert.deepStrictEqual(agentCommand("codex", input), {
      args: [
        "exec",
        "Build it.",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        APP,
        "--model",
        "gpt-6.1-sol",
      ],
      command: "codex",
    });
    const claude = agentCommand("claude-code", { ...input, model: undefined });
    assert.strictEqual(claude.command, "claude");
    assert.includeMembers(
      [...claude.args],
      [
        "-p",
        "Build it.",
        "stream-json",
        "bypassPermissions",
        "--setting-sources",
        "project",
      ]
    );
    assert.notInclude(claude.args, "--model");
  });

  it("reads Codex's events as a trace, what it said and what it used", () => {
    const run = readCodexEvents(codexLines, APP);
    assert.deepStrictEqual(run.trace, [
      `- · cat ${APP}/.agents/skills/ultrapaint/SKILL.md`,
      "- ✗ ls nowhere <<'EOF' …",
      "- · edit update src/App.tsx",
    ]);
    assert.strictEqual(run.said, "The page is built.");
    assert.strictEqual(run.tokens, 1000);
    assert.strictEqual(run.toolCalls, 2);
  });

  it("reads Claude Code's events the same way: a loaded skill, a failed call, the model it names", () => {
    const run = readClaudeEvents(claudeLines, APP);
    assert.deepStrictEqual(run.trace, [
      "- · Skill ultrapaint (.claude/skills/ultrapaint/SKILL.md)",
      "- · Read .claude/skills/ultrapaint/references/kinds/dialog.md",
      "- ✗ pnpm build",
      "- · edit src/App.tsx",
    ]);
    assert.strictEqual(run.said, "Built the dialog.");
    assert.strictEqual(run.tokens, 600);
    assert.strictEqual(run.toolCalls, 4);
    assert.strictEqual(run.model, "claude-opus-5-5");
  });

  it("counts the skill's files read where a project installs it, for either agent", () => {
    assert.deepStrictEqual(
      skillReads(readCodexEvents(codexLines, APP).trace.join("\n")),
      ["SKILL.md"]
    );
    assert.deepStrictEqual(
      skillReads(readClaudeEvents(claudeLines, APP).trace.join("\n")),
      ["SKILL.md", "references/kinds/dialog.md"]
    );
  });

  const reference: LoadedReference = {
    id: "home",
    kind: "landing",
    name: "Home",
    viewports: ["desktop"],
    why: "a test",
  };
  const host: OutsideHost = {
    entry: "src/App.tsx",
    kind: "outside",
    modules: "../blank/app/node_modules",
  };
  const options: OutsideOptions = {
    agent: "codex",
    host: "plain",
    minutes: 1,
    model: "gpt-6.1-sol",
    round: "r",
    runs: 1,
    skill: "built-in",
  };
  const noBrowser = new EvalsError({ message: "no browser in this test" });
  const pictures = Layer.succeed(
    Browser,
    Browser.of({
      audit: () => noBrowser,
      capture: () =>
        Effect.succeed({
          fold: new Uint8Array([1]),
          tiles: [new Uint8Array([2]), new Uint8Array([3])],
        }),
      compare: () => noBrowser,
      crop: () => noBrowser,
      cut: () => noBrowser,
      hold: () => noBrowser,
      layout: () => noBrowser,
      locate: () => noBrowser,
      trim: () => noBrowser,
      zoom: () => noBrowser,
    })
  );
  const files = {
    "hosts/plain/host.json": host,
    "hosts/plain/src/App.tsx": "export default () => null;\n",
    "references/home/brief.md": "A home page.\n",
  };

  it.effect(
    "installs the skill as a project does, runs the agent in a copy of the app and writes the run where a round's is",
    () => {
      const processes = scriptedProcesses(({ command }) => {
        if (command === "codex") {
          return codexLines.join("\n");
        }
        return command.endsWith("vite")
          ? "  Local:   http://127.0.0.1:5173/\n"
          : "abc1234\n";
      });
      return Effect.gen(function* () {
        const { data } = yield* EvalsConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* writeData(files);
        yield* generateOutside([reference], host, options);

        const app = `${data.work}/outside/r/home/run-1`;
        for (const dir of [".agents", ".claude"]) {
          assert.isTrue(
            yield* fs.exists(`${app}/${dir}/skills/ultrapaint/SKILL.md`)
          );
          assert.isFalse(
            yield* fs.exists(`${app}/${dir}/skills/ultrapaint/README.md`)
          );
        }
        assert.isFalse(yield* fs.exists(`${app}/host.json`));
        assert.strictEqual(
          yield* fs.readLink(`${app}/node_modules`),
          `${data.hostDir("blank")}/app/node_modules`
        );

        const codex = processes.ran.find((r) => r.command === "codex");
        assert.include(
          codex?.args[1] ?? "",
          "(`src/App.tsx`, styled with Tailwind)"
        );
        assert.include(codex?.args[1] ?? "", "a desktop window 1440 wide");
        assert.include(codex?.args[1] ?? "", "A home page.");
        assert.notInclude(codex?.args[1] ?? "", "ultrapaint");

        const run = JSON.parse(yield* readData("runs/r/home/run-1/run.json"));
        assert.deepStrictEqual(run.models, { "gpt-6.1-sol": 1000 });
        assert.deepStrictEqual(run.problems, []);
        assert.strictEqual(run.toolCalls, 2);
        assert.include(
          yield* readData("runs/r/home/run-1/trace.md"),
          "- ✗ ls nowhere"
        );
        assert.strictEqual(
          yield* readData("runs/r/home/run-1/pages/App.tsx"),
          "export default () => null;\n"
        );
        for (const shot of [
          "desktop-fold.jpg",
          "desktop-01.jpg",
          "desktop-02.jpg",
        ]) {
          assert.isTrue(
            yield* fs.exists(`${data.runs}/r/home/run-1/shots/${shot}`)
          );
        }
        const round = JSON.parse(yield* readData("runs/r/round.json"));
        assert.strictEqual(round.host, "plain");
        assert.strictEqual(round.skills, "built-in");

        // Run again, the round goes on from what it has: nothing is asked twice.
        const asked = processes.ran.filter((r) => r.command === "codex").length;
        yield* generateOutside([reference], host, options);
        assert.strictEqual(
          processes.ran.filter((r) => r.command === "codex").length,
          asked
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(pictures, processes.layer).pipe(
            Layer.provideMerge(TestData)
          )
        )
      );
    }
  );

  it.effect(
    "installs nothing for the baseline, and refuses another skill for a round already started",
    () => {
      const processes = scriptedProcesses(({ command }) =>
        command.endsWith("vite") ? "http://127.0.0.1:5173/\n" : "{}\n"
      );
      return Effect.gen(function* () {
        const { data } = yield* EvalsConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* writeData(files);
        yield* generateOutside([reference], host, {
          ...options,
          skill: "none",
        });
        assert.isFalse(
          yield* fs.exists(`${data.work}/outside/r/home/run-1/.agents`)
        );
        const refused = yield* Effect.flip(
          generateOutside([reference], host, options)
        );
        assert.include(
          refused.message,
          "round r was started with host plain and skill none"
        );
        const unknown = yield* Effect.flip(
          generateOutside([reference], host, { ...options, agent: "cursor" })
        );
        assert.include(unknown.message, "one of claude-code, codex");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(pictures, processes.layer).pipe(
            Layer.provideMerge(TestData)
          )
        )
      );
    }
  );
});
