import { assert } from "@effect/vitest";
import {
  dialsLine,
  LOOK_PRESETS,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { Effect } from "effect";
import { eachTest } from "./testing/each-test.ts";
import { TestEnv } from "./testing/harness.ts";
import { ProjectRpc } from "./testing/project.ts";

eachTest(ProjectRpc())("a look chosen on the look page", (it) => {
  it.effect(
    "is saved whole as the project's design system, with DESIGN.md's overview",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const [preset] = LOOK_PRESETS;
        assert.isDefined(preset);
        if (!preset) {
          return;
        }
        const { findings } = yield* client["designSystem.write"]({
          designSystem: lookSystem(preset.dials),
          document: `## Overview\n\n${preset.name}: ${dialsLine(preset.dials)}.\n`,
        });
        assert.isFalse(findings.some((f) => f.severity === "error"));
        const state = yield* client["designSystem.get"]();
        assert.strictEqual(
          state.designSystem?.typography.fonts[0]?.source,
          lookSystem(preset.dials).typography.fonts[0]?.source
        );
        assert.include(state.document?.text ?? "", "Calm");
      })
  );
});
