import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const THEME = `@theme {
  --color-brand: #2563eb;
  --color-ink: #111111;
  --radius-card: 0.75rem;
}
`;

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "DESIGN.md (ADR 0027)",
  (it) => {
    it.effect(
      "is written at the root with the code's tokens, and follows the code without touching the prose",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "DESIGN.md");
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
          yield* client["designSystem.detect"]();

          const plan = yield* client["sync.plan"]();
          assert.deepStrictEqual(
            plan.steps.map((s) => [s.kind, s.title]),
            [
              ["design-md", "Write DESIGN.md"],
              ["describe", "Describe what changed"],
            ]
          );

          const placed = yield* client["designSystem.placeDocument"]();
          assert.strictEqual(placed.path, "DESIGN.md");
          const first = yield* fs.readFileString(file);
          assert.include(first, "version: alpha");
          assert.include(
            first,
            'colors:\n  brand: "#2563eb"\n  ink: "#111111"'
          );
          assert.include(first, "rounded:\n  card: 0.75rem");
          assert.include(first, "## Do's and Don'ts");
          const state = yield* client["designSystem.get"]();
          assert.strictEqual(state.document?.path, "DESIGN.md");
          assert.isFalse(state.document?.legacy);
          assert.deepStrictEqual(
            state.document?.findings.filter((f) => f.severity === "error"),
            []
          );
          assert.notInclude(
            (yield* client["sync.plan"]()).steps.map((s) => s.kind),
            "design-md"
          );

          // Someone writes the prose; the code then changes a colour.
          yield* fs.writeFileString(
            file,
            first.replace("## Overview\n", "## Overview\n\nCalm and dense.\n")
          );
          yield* client["designSystem.setToken"]({
            name: "color-brand",
            value: "#1d4ed8",
          });
          const second = yield* fs.readFileString(file);
          assert.include(second, 'brand: "#1d4ed8"');
          assert.include(second, "Calm and dense.");

          // A value changed in the document is held for Sync, while the code's own changes
          // still come in.
          yield* fs.writeFileString(
            file,
            second.replace('ink: "#111111"', 'ink: "#000000"')
          );
          const held = yield* client["designSystem.get"]();
          assert.deepStrictEqual(held.document?.held, [
            {
              code: "#111111",
              doc: "#000000",
              kind: "doc",
              path: "colors.ink",
            },
          ]);
          yield* client["designSystem.setToken"]({
            name: "radius-card",
            value: "1rem",
          });
          const third = yield* fs.readFileString(file);
          assert.include(third, 'ink: "#000000"');
          assert.include(third, "card: 1rem");
        }),
      30_000
    );

    it.effect(
      "is moved from the designs directory, keeping what it says",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.remove(path.join(repo, "DESIGN.md"));
          yield* fs.writeFileString(
            path.join(repo, "designs/DESIGN.md"),
            "# Acme\n\nOne primary action per screen.\n"
          );
          const legacy = yield* client["designSystem.get"]();
          assert.strictEqual(legacy.document?.path, "designs/DESIGN.md");
          assert.isTrue(legacy.document?.legacy);
          const [step] = (yield* client["sync.plan"]()).steps;
          assert.strictEqual(
            step?.title,
            "Move DESIGN.md to the repository root"
          );

          yield* client["designSystem.placeDocument"]();
          assert.isFalse(
            yield* fs.exists(path.join(repo, "designs/DESIGN.md"))
          );
          const moved = yield* fs.readFileString(path.join(repo, "DESIGN.md"));
          assert.isTrue(moved.startsWith("---\ncolors:\n"));
          assert.include(moved, "# Acme\n\nOne primary action per screen.\n");
          const state = yield* client["designSystem.get"]();
          assert.strictEqual(state.document?.path, "DESIGN.md");
          assert.include(state.document?.body ?? "", "One primary action");
        }),
      30_000
    );
  }
);

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "DESIGN.md from elsewhere (ADR 0027)",
  (it) => {
    it.effect(
      "has its tokens matched, taken into the code, and is rewritten in the code's names",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "DESIGN.md");
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
          yield* client["designSystem.detect"]();
          // A designer's DESIGN.md, in names of its own.
          yield* fs.writeFileString(
            file,
            [
              "---",
              "version: alpha",
              "name: Heritage",
              "colors:",
              '  primary: "#2563eb"',
              '  tertiary: "#b8422e"',
              "rounded:",
              "  card: 1rem",
              "---",
              "",
              "## Colors",
              "",
              "Boston Clay {colors.tertiary} is the sole accent, beside {colors.primary}.",
              "",
            ].join("\n")
          );

          const plan = yield* client["sync.plan"]();
          assert.strictEqual(plan.steps[0]?.kind, "design-tokens");
          const compared = yield* client["sync.tokens"]({ source: "design" });
          assert.deepStrictEqual(
            compared?.diffs.map((d) => [d.variable, d.name, d.outcome]),
            [
              ["colors.primary", "color-brand", "same"],
              ["colors.tertiary", "color-tertiary", "unmatched"],
              ["rounded.card", "radius-card", "conflict"],
            ]
          );

          const matched = yield* client["sync.match"]({
            entries: [{ to: "color-accent", variable: "colors.tertiary" }],
            source: "design",
          });
          assert.strictEqual(matched.unmatched, 0);
          // Matching writes nothing into the document yet.
          assert.include(yield* fs.readFileString(file), "tertiary:");

          const applied = yield* client["sync.apply"]({
            decisions: [{ name: "radius-card", take: "source" }],
            source: "design",
          });
          assert.strictEqual(applied.written, 2);
          const css = yield* fs.readFileString(
            path.join(repo, "styles/app.css")
          );
          assert.include(css, "--color-accent: #b8422e;");
          assert.include(css, "--radius-card: 1rem;");

          const doc = yield* fs.readFileString(file);
          assert.include(doc, "name: Heritage");
          assert.include(doc, 'accent: "#b8422e"');
          assert.include(doc, 'brand: "#2563eb"');
          assert.notInclude(doc, "tertiary:");
          assert.notInclude(doc, "primary:");
          assert.include(
            doc,
            "Boston Clay {colors.accent} is the sole accent, beside {colors.brand}."
          );
          const state = yield* client["designSystem.get"]();
          assert.deepStrictEqual(state.document?.held, []);
          assert.include(
            (state.designSystem?.colors ?? []).flatMap((g) =>
              g.tokens.map((t) => t.name)
            ),
            "color-accent"
          );
          assert.notInclude(
            (yield* client["sync.plan"]()).steps.map((s) => s.kind),
            "design-tokens"
          );
        }),
      30_000
    );
  }
);
