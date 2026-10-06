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
        }),
      30_000
    );

    it.effect(
      "keeps the values in the code: the file leaves them out, and an edit writes the stylesheet",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = JSON.parse(
            yield* fs.readFileString(
              path.join(repo, "designs/design-system.json")
            )
          );
          const listed = JSON.stringify(file);
          assert.include(listed, '"color-brand"');
          assert.notInclude(listed, "#2563eb");

          const brand = (state: {
            readonly designSystem: {
              readonly colors: readonly {
                readonly tokens: readonly { name: string; value: string }[];
              }[];
            } | null;
          }) =>
            state.designSystem?.colors
              .flatMap((g) => g.tokens)
              .find((t) => t.name === "color-brand")?.value;
          assert.strictEqual(
            brand(yield* client["designSystem.get"]()),
            "#2563eb"
          );

          const { files, previous } = yield* client["designSystem.setToken"]({
            name: "color-brand",
            value: "#1d4ed8",
          });
          assert.deepStrictEqual(files, ["styles/app.css"]);
          assert.strictEqual(previous, "#2563eb");
          assert.include(
            yield* fs.readFileString(path.join(repo, "styles/app.css")),
            "--color-brand: #1d4ed8;"
          );
          assert.strictEqual(
            brand(yield* client["designSystem.get"]()),
            "#1d4ed8"
          );

          // Two edits at once to the same stylesheet: each is written, neither over the other.
          yield* Effect.all(
            [
              client["designSystem.setToken"]({
                name: "color-brand",
                value: "#1e40af",
              }),
              client["designSystem.setToken"]({
                name: "radius-card",
                value: "1rem",
              }),
            ],
            { concurrency: "unbounded" }
          );
          const both = yield* fs.readFileString(
            path.join(repo, "styles/app.css")
          );
          assert.include(both, "--color-brand: #1e40af;");
          assert.include(both, "--radius-card: 1rem;");
        }),
      30_000
    );

    it.effect(
      "starts an application where there is none, with settings that point at it",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const made = yield* client["setup.scaffold"]({
            dir: "app",
            install: false,
            name: "Acme",
            repoPath: repo,
          });
          assert.include(made.created, "app/src/components/ui/button.tsx");
          assert.isFalse(made.installed);
          assert.deepStrictEqual(made.settings, {
            designsDir: "docs/designs",
            hostCss: ["../../../app/src/index.css"],
            libraryDirs: ["app/src/components"],
            resolveFrom: "app",
          });
          assert.isTrue(yield* fs.exists(path.join(repo, "docs/designs")));
          const validation = yield* client["settings.set"]({
            ...settings,
            ...made.settings,
          });
          assert.isTrue(validation.ok);
          const refused = yield* Effect.flip(
            client["setup.scaffold"]({
              dir: "app",
              install: false,
              name: "Acme",
              repoPath: repo,
            })
          );
          assert.include(refused.message, "already has a package.json");
        }),
      30_000
    );
  }
);
