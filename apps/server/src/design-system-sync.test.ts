import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { TokenComparison } from "@ultrapaint/contracts/sync";
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
          const describe = (plan: typeof saved) =>
            plan.steps.find((s) => s.kind === "describe");
          assert.strictEqual(describe(saved)?.state, "done");

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
          assert.strictEqual(describe(drifted)?.state, "attention");
          assert.include(describe(drifted)?.detail ?? "", "color-accent");
        }),
      30_000
    );

    it.effect(
      "keeps the values in the design: an edit changes the design system, and the code follows on export",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const css = path.join(repo, "styles/app.css");
          const system = path.join(repo, "designs/design-system.json");
          const listed = yield* fs.readFileString(system);
          assert.include(listed, '"color-brand"');
          assert.include(listed, "#2563eb");
          // The Design Tokens format is written beside it.
          const dtcg = yield* fs.readFileString(
            path.join(repo, "designs/design.tokens.json")
          );
          assert.include(dtcg, '"color-brand"');

          const brand = (read: {
            readonly designSystem: {
              readonly colors: readonly {
                readonly tokens: readonly { name: string; value: string }[];
              }[];
            } | null;
          }) =>
            read.designSystem?.colors
              .flatMap((g) => g.tokens)
              .find((t) => t.name === "color-brand")?.value;

          const { files, previous } = yield* client["designSystem.setToken"]({
            name: "color-brand",
            value: "#1d4ed8",
          });
          assert.deepStrictEqual(files, [
            "designs/design-system.json",
            "designs/design.tokens.json",
          ]);
          assert.strictEqual(previous, "#2563eb");
          // The application is not touched: the design leads.
          assert.include(
            yield* fs.readFileString(css),
            "--color-brand: #2563eb;"
          );
          const state = yield* client["designSystem.get"]();
          assert.strictEqual(brand(state), "#1d4ed8");

          const compare = () => client["sync.tokens"]({ source: "code" });
          const outcome = (comparison: TokenComparison | null, name: string) =>
            comparison?.diffs.find(
              (d) => d.name === name && d.theme === undefined
            )?.outcome;
          const waiting = yield* compare();
          assert.strictEqual(outcome(waiting, "color-brand"), "source-behind");
          // The colour the code added alone is offered to the design system.
          assert.strictEqual(outcome(waiting, "color-accent"), "to-design");
          const plan = yield* client["sync.plan"]();
          assert.strictEqual(plan.facts.codeTokens?.toCode, 1);
          const step = plan.steps.find((s) => s.kind === "code-tokens");
          assert.strictEqual(step?.state, "attention");

          // The code changes a radius on its own.
          yield* fs.writeFileString(
            css,
            (yield* fs.readFileString(css)).replace(
              "--radius-card: 0.75rem;",
              "--radius-card: 1rem;"
            )
          );
          yield* client["designSystem.get"]();
          assert.strictEqual(
            outcome(yield* compare(), "radius-card"),
            "to-design"
          );

          // Sync both ways: the design's colour to the code, the code's radius to the design.
          const applied = yield* client["sync.apply"]({
            decisions: [],
            source: "code",
          });
          assert.include(applied.files, "styles/app.css");
          const after = yield* fs.readFileString(css);
          assert.include(after, "--color-brand: #1d4ed8;");
          const settled = yield* compare();
          assert.strictEqual(outcome(settled, "color-brand"), "same");
          assert.strictEqual(outcome(settled, "radius-card"), "same");
          assert.strictEqual(outcome(settled, "color-accent"), "same");
          const saved = JSON.parse(yield* fs.readFileString(system));
          assert.strictEqual(saved.codeSync.agreed["color-brand"], "#1d4ed8");

          // Changed on both sides: the user picks, and the design's is written to the code.
          yield* client["designSystem.setToken"]({
            name: "color-brand",
            value: "#1e40af",
          });
          yield* fs.writeFileString(
            css,
            (yield* fs.readFileString(css)).replace(
              "--color-brand: #1d4ed8;",
              "--color-brand: #0f172a;"
            )
          );
          yield* client["designSystem.get"]();
          assert.strictEqual(
            outcome(yield* compare(), "color-brand"),
            "conflict"
          );
          yield* client["sync.apply"]({
            decisions: [{ name: "color-brand", take: "design" }],
            source: "code",
          });
          assert.include(
            yield* fs.readFileString(css),
            "--color-brand: #1e40af;"
          );

          // With codeTokens auto, an edit reaches the code at once, as before ADR 0028.
          const current = (yield* client["settings.get"]()) ?? settings;
          yield* client["settings.set"]({ ...current, codeTokens: "auto" });
          const auto = yield* client["designSystem.setToken"]({
            name: "radius-card",
            value: "1.25rem",
          });
          assert.include(auto.files, "styles/app.css");
          assert.include(
            yield* fs.readFileString(css),
            "--radius-card: 1.25rem;"
          );
          assert.strictEqual(outcome(yield* compare(), "radius-card"), "same");
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

    it.effect(
      "starts a blank application: no settings to put right for it",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const made = yield* client["setup.scaffold"]({
            dir: "blank",
            install: false,
            name: "Blank",
            repoPath: repo,
            template: "blank",
          });
          assert.notInclude(made.created, "blank/src/components/ui/button.tsx");
          assert.isTrue(
            yield* fs.exists(path.join(repo, "blank/src/components"))
          );
          const current = (yield* client["settings.get"]()) ?? settings;
          const validation = yield* client["settings.set"]({
            ...current,
            ...made.settings,
          });
          assert.isTrue(validation.ok);
          const plan = yield* client["sync.plan"]();
          assert.notInclude(
            plan.steps.map((s) => s.kind),
            "settings"
          );
        }),
      30_000
    );
  }
);
