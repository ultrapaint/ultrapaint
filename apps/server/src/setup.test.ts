import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "first-run setup",
  (it) => {
    it.effect("looks at a repository before anything is configured", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const path = yield* Path.Path;
        const found = yield* client["setup.detect"]({ repoPath: repo });
        assert.strictEqual(found.repoName, path.basename(repo));
        assert.strictEqual(found.framework, "react-vite");
        // Nothing in the fixture depends on React, so nothing is proposed.
        assert.deepStrictEqual(found.anchors, []);
        const missing = yield* Effect.flip(
          client["setup.detect"]({ repoPath: `${repo}/nowhere` })
        );
        assert.strictEqual(missing._tag, "BadRequest");
      })
    );

    it.effect("creates a designs directory that needs no package", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        // What an installed package would have: the anchor's dependencies.
        yield* fs.makeDirectory(`${repo}/designs/node_modules/react`, {
          recursive: true,
        });
        yield* fs.writeFileString(`${repo}/designs/tsconfig.json`, "{}");

        const result = yield* client["setup.createDesigns"]({
          designsDir: "docs/screens",
          linkDependencies: true,
          repoPath: repo,
          resolveFrom: "designs",
        });
        assert.deepStrictEqual(result.created, [
          "docs/screens",
          "docs/screens/tsconfig.json",
          "docs/screens/node_modules",
          "docs/screens/.gitignore",
        ]);
        const config = JSON.parse(
          yield* fs.readFileString(`${repo}/docs/screens/tsconfig.json`)
        );
        assert.strictEqual(config.extends, "../../designs/tsconfig.json");
        // Editors resolve what the screens import through the anchor's dependencies.
        assert.isTrue(
          yield* fs.exists(`${repo}/docs/screens/node_modules/react`)
        );
        assert.strictEqual(
          yield* fs.readLink(`${repo}/docs/screens/node_modules`),
          "../../designs/node_modules"
        );
        assert.strictEqual(
          yield* fs.readFileString(`${repo}/docs/screens/.gitignore`),
          "node_modules\n"
        );

        // The settings validate without a package in the designs directory.
        const { settings } = yield* TestEnv;
        const validation = yield* client["settings.validate"]({
          ...settings,
          designsDir: "docs/screens",
          resolveFrom: "designs",
        });
        assert.deepStrictEqual(validation.problems, []);

        const again = yield* client["setup.createDesigns"]({
          designsDir: "docs/screens",
          linkDependencies: true,
          repoPath: repo,
          resolveFrom: "designs",
        });
        assert.deepStrictEqual(again.created, []);
      })
    );

    it.effect("refuses an anchor that is not a package", () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["setup.createDesigns"]({
            designsDir: "docs/other",
            linkDependencies: false,
            repoPath: repo,
            resolveFrom: "ui",
          })
        );
        assert.strictEqual(error._tag, "BadRequest");
        const validation = yield* client["settings.validate"]({
          ...settings,
          resolveFrom: "ui",
        });
        assert.isFalse(validation.ok);
      })
    );
  }
);
