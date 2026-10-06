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
        assert.strictEqual(found.tailwind, "none");
        const missing = yield* Effect.flip(
          client["setup.detect"]({ repoPath: `${repo}/nowhere` })
        );
        assert.strictEqual(missing._tag, "BadRequest");
      })
    );

    it.effect("creates a designs directory, and nothing else", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const result = yield* client["setup.createDesigns"]({
          designsDir: "docs/screens",
          repoPath: repo,
          resolveFrom: "designs",
        });
        assert.deepStrictEqual(result.created, ["docs/screens"]);
        assert.deepStrictEqual(
          yield* fs.readDirectory(`${repo}/docs/screens`),
          []
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

    it.effect(
      "sets up an app in front/ when the repository's root has no package.json",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          // The fixture's root manifest goes; the app is a package of its own in front/.
          yield* fs.remove(`${repo}/package.json`);
          yield* fs.makeDirectory(`${repo}/front/src/components`, {
            recursive: true,
          });
          yield* fs.writeFileString(
            `${repo}/front/package.json`,
            '{ "name": "front", "dependencies": { "react": "19" } }\n'
          );
          yield* fs.writeFileString(
            `${repo}/front/src/components/header.tsx`,
            "export const Header = () => null;\n"
          );
          yield* fs.makeDirectory(`${repo}/docs/designs`, { recursive: true });

          const found = yield* client["setup.detect"]({ repoPath: repo });
          assert.isFalse(found.rootManifest ?? true);
          assert.strictEqual(found.anchors[0]?.dir, "front");
          assert.strictEqual(
            found.libraries[0]?.sourceDir,
            "front/src/components"
          );

          const front = {
            ...settings,
            designsDir: "docs/designs",
            libraryDirs: ["front/src/components"],
            resolveFrom: "front",
          };
          const ok = yield* client["settings.validate"](front);
          assert.deepStrictEqual(ok.problems, []);

          // Without saying where the pages import from, there is nothing to resolve them in.
          const { resolveFrom: _gone, ...unanchored } = front;
          const missing = yield* client["settings.validate"](unanchored);
          assert.isFalse(missing.ok);
          assert.include(missing.problems.join(" "), "Resolve imports from");
        })
    );
  }
);
