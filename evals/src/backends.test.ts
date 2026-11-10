import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { askClaude } from "./claude.ts";
import { askCodex } from "./codex.ts";
import { scriptedProcesses } from "./test-processes.ts";

// Past 128K characters one argument is more than Linux passes on (E2BIG).
const LONG = "a finding. ".repeat(20_000);

describe("a model's command", () => {
  it.effect(
    "gets its prompt on stdin, never as an argument, however long",
    () => {
      const processes = scriptedProcesses(({ command }) =>
        command === "claude"
          ? JSON.stringify({ is_error: false, result: "ok" })
          : `${JSON.stringify({ item: { text: "{}", type: "agent_message" }, type: "item.completed" })}\n`
      );
      return Effect.gen(function* () {
        yield* askClaude({ cwd: "/tmp", model: "opus", prompt: LONG });
        yield* askCodex({
          cwd: "/tmp",
          model: "gpt-6.1-sol",
          prompt: LONG,
          schema: {},
        });
        assert.deepStrictEqual(
          processes.ran.map((r) => r.command),
          ["claude", "codex"]
        );
        for (const ran of processes.ran) {
          assert.isTrue(ran.args.every((arg) => arg.length < 10_000));
        }
        assert.strictEqual(processes.ran[1]?.args[1], "-");
        // The scripted spawner after Node's, so it is the one used: no real command runs here.
      }).pipe(Effect.provide(Layer.merge(NodeServices.layer, processes.layer)));
    }
  );
});
