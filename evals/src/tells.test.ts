import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { type Asked, Models } from "./models.ts";
import { TELLS, type Tells, tells, tellsReport } from "./tells.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const none = () =>
  Object.fromEntries(TELLS.map((t) => [t, [] as string[]])) as unknown as Tells;

describe("tells", () => {
  it("says per round the marks per page and the pages that have one", () => {
    const report = tellsReport("t", [
      {
        round: "with",
        runs: [{ ...none(), eyebrow: ["A", "B"] }, none()],
      },
    ]);
    assert.include(report, "| with | 2 | 1.0 · 1/2 | 0.0 · 0/2 |");
  });

  it.effect(
    "asks once per run with its pictures and source, and keeps what it counted",
    () => {
      const asked: Asked[] = [];
      const model = (question: Asked) => {
        asked.push(question);
        return { ...none(), gradientText: ["the headline"] };
      };
      return Effect.gen(function* () {
        yield* writeData({
          "runs/r/home/run-1/pages/App.tsx": "export const App = () => null;\n",
          "runs/r/home/run-1/shots/desktop-01.jpg": "jpg",
          "runs/r/proposals/01-a-proposal.md": "A proposal.\n",
          "runs/r/round.json": { name: "r" },
        });
        const options = {
          concurrency: 1,
          effort: "medium",
          model: "opus",
          name: "t",
          rounds: ["r"],
        };
        yield* tells(options);
        assert.strictEqual(asked.length, 1);
        assert.include(asked[0]?.prompt ?? "", "- `shots/desktop-01.jpg`");
        assert.include(asked[0]?.prompt ?? "", "- `pages/App.tsx`");
        assert.include(yield* readData("runs/t/tells.md"), "| r | 1 |");
        yield* tells(options);
        assert.strictEqual(asked.length, 1);
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(model))));
    }
  );
});
