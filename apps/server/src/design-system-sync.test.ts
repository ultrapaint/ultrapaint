import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const THEME = `@theme {
  --color-brand: #2563eb;
  --radius-card: 0.75rem;
}
`;

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the design-system sync",
  (it) => {
    it.effect(
      "reads the case from the project, then the drift once a design system is saved",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          // The designs package renders with React: there is an application to speak of.
          yield* fs.writeFileString(
            path.join(repo, "designs/package.json"),
            '{ "name": "designs", "dependencies": { "react": "19" } }\n'
          );
          yield* fs.makeDirectory(path.join(repo, "styles"));
          yield* fs.writeFileString(path.join(repo, "styles/app.css"), THEME);
          yield* client["settings.set"]({
            ...settings,
            hostCss: ["../../styles/app.css"],
            libraryDirs: ["ui"],
          });

          const first = yield* client["sync.plan"]();
          assert.strictEqual(first.case, "code");
          assert.isTrue(first.facts.app);
          assert.strictEqual(first.facts.tokens, 2);
          assert.deepStrictEqual(
            first.steps.map((s) => s.kind),
            ["inventory", "define", "map", "migrate", "verify"]
          );
          assert.include(first.summary, "Next: read what the code uses");

          // The fixed-rule scan saves a design system that lists what the theme has.
          yield* client["designSystem.detect"]();
          const saved = yield* client["sync.plan"]();
          assert.strictEqual(saved.case, "maintain");
          assert.deepStrictEqual(saved.drift.tokensUndescribed, []);
          assert.strictEqual(saved.steps[0]?.state, "done");

          // Someone adds a colour to the code and nobody tells the design system.
          yield* fs.writeFileString(
            path.join(repo, "styles/app.css"),
            THEME.replace(
              "--radius-card",
              "--color-accent: #f59e0b;\n  --radius-card"
            )
          );
          const drifted = yield* client["sync.plan"]();
          assert.deepStrictEqual(drifted.drift.tokensUndescribed, [
            "color-accent",
          ]);
          assert.strictEqual(drifted.steps[0]?.state, "attention");
          assert.include(drifted.steps[0]?.detail ?? "", "color-accent");
        })
    );
  }
);
