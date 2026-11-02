import { assert, describe, it } from "@effect/vitest";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { Effect, FileSystem, Path } from "effect";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

const NO_TAILWIND_RE = /^No Tailwind setup was found/;

/** Each test on a fixture of its own: one of them takes the fixture's manifest away. */
const inAFixture = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(ProjectTest()), Effect.scoped);

describe("first-run setup", () => {
  it.effect("looks at a repository before anything is configured", () =>
    inAFixture(
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const setup = yield* SetupService;
        const path = yield* Path.Path;
        const found = yield* setup.detect(repo);
        assert.strictEqual(found.repoName, path.basename(repo));
        // Nothing in the fixture depends on React, so nothing is proposed.
        assert.deepStrictEqual(found.anchors, []);
        // Nor any stylesheet the style system reads, which it says in its own words.
        assert.isUndefined(found.styleSystem);
        assert.match(found.stylesNote ?? "", NO_TAILWIND_RE);
        const missing = yield* Effect.flip(setup.detect(`${repo}/nowhere`));
        assert.strictEqual(missing._tag, "BadRequest");
      })
    )
  );

  it.effect("creates a designs directory, and nothing else", () =>
    inAFixture(
      Effect.gen(function* () {
        const { repo, settings } = yield* ProjectFixture;
        const setup = yield* SetupService;
        const fs = yield* FileSystem.FileSystem;
        const result = yield* setup.createDesigns({
          designsDir: "docs/screens",
          repoPath: repo,
        });
        assert.deepStrictEqual(result.created, ["docs/screens"]);
        assert.deepStrictEqual(
          yield* fs.readDirectory(`${repo}/docs/screens`),
          []
        );

        // The settings validate without a package in the designs directory.
        const validation = yield* (yield* SettingsService).validate({
          ...settings,
          designsDir: "docs/screens",
          resolveFrom: "designs",
        });
        assert.deepStrictEqual(validation.problems, []);

        const again = yield* setup.createDesigns({
          designsDir: "docs/screens",
          repoPath: repo,
        });
        assert.deepStrictEqual(again.created, []);
      })
    )
  );

  it.effect("refuses settings whose application is not a package", () =>
    inAFixture(
      Effect.gen(function* () {
        const { settings } = yield* ProjectFixture;
        const validation = yield* (yield* SettingsService).validate({
          ...settings,
          resolveFrom: "ui",
        });
        assert.isFalse(validation.ok);
      })
    )
  );

  it.effect(
    "sets up an app in front/ when the repository's root has no package.json",
    () =>
      inAFixture(
        Effect.gen(function* () {
          const { repo, settings } = yield* ProjectFixture;
          const setup = yield* SetupService;
          const { validate } = yield* SettingsService;
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

          const found = yield* setup.detect(repo);
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
          const ok = yield* validate(front);
          assert.deepStrictEqual(ok.problems, []);

          // Without saying where the pages import from, there is nothing to resolve them in.
          const { resolveFrom: _gone, ...unanchored } = front;
          const missing = yield* validate(unanchored);
          assert.isFalse(missing.ok);
          assert.include(missing.problems.join(" "), "Resolve imports from");
        })
      )
  );

  it.effect(
    "starts an application with the theme it is given, or the template's own when there is none to read",
    () =>
      inAFixture(
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const setup = yield* SetupService;
          const fs = yield* FileSystem.FileSystem;
          const start = (
            dir: string,
            theme: Effect.Effect<Readonly<Record<string, string>>, BadRequest>
          ) =>
            Effect.andThen(
              setup.scaffold(
                { dir, install: false, name: "Acme", repoPath: repo },
                theme
              ),
              fs.readFileString(`${repo}/${dir}/src/index.css`)
            );
          // A Figma file's tokens, as the open project's latest import gives them.
          const figma = yield* start(
            "figma",
            Effect.succeed({ "color-primary": "#ff0000" })
          );
          assert.include(figma, "--color-primary: #ff0000;");
          assert.notInclude(figma, ".dark {");
          // No project open, or an import that does not read: the template's theme.
          const own = yield* start(
            "own",
            Effect.fail(new BadRequest({ message: "no import" }))
          );
          assert.notInclude(own, "#ff0000");
          assert.include(own, ".dark {");
        })
      )
  );
});
