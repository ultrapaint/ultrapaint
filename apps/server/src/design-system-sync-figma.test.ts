import path from "node:path";
import { assert } from "@effect/vitest";
import { makeFixture } from "@ultrapaint/figma-import/testing/fixture";
import { Effect, FileSystem } from "effect";
import { TestClock } from "effect/testing";
import { OpenProject } from "./project.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { eachTest } from "./testing/each-test.ts";
import { TestEnv } from "./testing/harness.ts";
import { ProjectRpc } from "./testing/project.ts";

const THEME = `@theme {
  --color-brand: #2563eb;
  --color-muted: #e5e7eb;
  --radius-card: 0.5rem;
}
`;

const guid = (localID: number) => ({ localID, sessionID: 9 });

/** A Figma file whose variables are a brand colour, a muted colour, a card radius and a new accent. */
const tokensFile = (brand: readonly [number, number, number]) => {
  const f = makeFixture();
  const set = f.add(f.internal, {
    guid: guid(1),
    name: "Tokens",
    type: "VARIABLE_SET",
    variableSetModes: [{ id: guid(2), name: "Light", sortPosition: "a" }],
  } as never);
  const variable = (
    localID: number,
    name: string,
    type: "COLOR" | "FLOAT",
    value: unknown
  ) =>
    f.add(f.internal, {
      guid: guid(localID),
      name,
      type: "VARIABLE",
      variableDataValues: {
        entries: [
          {
            modeID: guid(2),
            variableData: { dataType: type, resolvedDataType: type, value },
          },
        ],
      },
      variableResolvedType: type,
      variableSetID: { guid: set },
    } as never);
  const [r, g, b] = brand;
  variable(10, "Color/Brand", "COLOR", { colorValue: { a: 1, b, g, r } });
  // #d1d5db: not the code's muted.
  variable(11, "Color/Muted", "COLOR", {
    colorValue: { a: 1, b: 219 / 255, g: 213 / 255, r: 209 / 255 },
  });
  variable(12, "Radius/Card", "FLOAT", { floatValue: 12 });
  variable(13, "Color/Accent", "COLOR", {
    colorValue: { a: 1, b: 11 / 255, g: 158 / 255, r: 245 / 255 },
  });
  return f.build();
};

/** A Figma file imported, as its upload is (the upload's route is `server.test.ts`'s). */
const importFig = (name: string, bytes: Uint8Array) =>
  Effect.flatMap(OpenProject, (project) =>
    project.service(FigmaImportService)((figma) => figma.create(name, bytes))
  );

/** The code's brand, #2563eb. */
const CODE_BRAND = [37 / 255, 99 / 255, 235 / 255] as const;

/**
 * A project of each test's own whose code has a theme (docs/TESTING.md rule 3), its requests
 * in-process.
 */
const Themed = ProjectRpc({
  files: {
    "designs/package.json":
      '{ "name": "designs", "dependencies": { "react": "19" } }\n',
    "styles/app.css": THEME,
  },
  settings: { hostCss: ["../../styles/app.css"], libraryDirs: ["ui"] },
});

eachTest(Themed)("Figma's tokens in the sync", (it) => {
  it.effect(
    "compares Figma's tokens with the code's, writes what the user takes, and remembers where they agreed",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const css = path.join(repo, "styles/app.css");

        // #2563eb, the code's brand: the same in both.
        yield* importFig("tokens.fig", tokensFile(CODE_BRAND));
        const comparison = yield* client["sync.tokens"]({ source: "figma" });
        assert.isFalse(comparison?.baseline ?? true);
        const outcomes = Object.fromEntries(
          (comparison?.diffs ?? []).map((d) => [d.name, d.outcome])
        );
        // The accent is nothing the code has: it waits to be matched, and is not written.
        assert.deepStrictEqual(outcomes, {
          "color-accent": "unmatched",
          "color-brand": "same",
          "color-muted": "conflict",
          "radius-card": "conflict",
        });
        const plan = yield* client["sync.plan"]();
        assert.strictEqual(plan.case, "figma-code");
        assert.strictEqual(plan.steps[0]?.kind, "figma-tokens");

        // The user names it the code's way; a name of another kind is refused.
        const matched = yield* client["sync.match"]({
          entries: [
            { to: "color-highlight", variable: "Tokens/Color/Accent" },
            { to: "color-card", variable: "Tokens/Radius/Card" },
          ],
          source: "figma",
        });
        assert.strictEqual(matched.saved, 1);
        assert.strictEqual(matched.unmatched, 0);
        assert.lengthOf(matched.problems, 1);
        const named = yield* client["sync.tokens"]({ source: "figma" });
        assert.deepInclude(
          (named?.diffs ?? []).map((d) => [d.variable, d.name, d.outcome]),
          ["Tokens/Color/Accent", "color-highlight", "to-design"]
        );

        // The user keeps the code's muted and takes Figma's radius.
        const applied = yield* client["sync.apply"]({
          decisions: [
            { name: "color-muted", take: "design" },
            { name: "radius-card", take: "source" },
          ],
          source: "figma",
        });
        assert.strictEqual(applied.written, 2);
        const text = yield* fs.readFileString(css);
        assert.include(text, "--color-highlight: #f59e0b;");
        assert.notInclude(text, "--color-accent");
        // Written in the unit the code uses.
        assert.include(text, "--radius-card: 0.75rem;");
        assert.include(text, "--color-muted: #e5e7eb;");
        const synced = yield* client["sync.plan"]();
        assert.strictEqual(
          synced.steps.find((s) => s.kind === "figma-tokens")?.state,
          "done"
        );

        // Later, the designer changes the brand in Figma and someone changes muted in the code.
        yield* fs.writeFileString(
          css,
          (yield* fs.readFileString(css)).replace("#e5e7eb", "#f3f4f6")
        );
        // Imported later: the newest import is the one compared.
        yield* TestClock.adjust("1 minute");
        yield* importFig("tokens.fig", tokensFile([1, 0, 0]));
        const again = yield* client["sync.tokens"]({ source: "figma" });
        assert.isTrue(again?.baseline ?? false);
        const next = Object.fromEntries(
          (again?.diffs ?? []).map((d) => [d.name, d.outcome])
        );
        assert.deepStrictEqual(next, {
          "color-brand": "to-design",
          "color-highlight": "same",
          "color-muted": "source-behind",
          "radius-card": "same",
        });
      })
  );

  it.effect("keeps every match saved at the same time", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* importFig("tokens.fig", tokensFile(CODE_BRAND));
      const matches = [
        ["Tokens/Color/Accent", "color-one"],
        ["Tokens/Color/Brand", "color-two"],
        ["Tokens/Color/Muted", "color-three"],
      ] as const;
      yield* Effect.forEach(
        matches,
        ([variable, to]) =>
          client["sync.match"]({
            entries: [{ to, variable }],
            source: "figma",
          }),
        { concurrency: "unbounded" }
      );
      const named = yield* client["sync.tokens"]({ source: "figma" });
      const names = new Map(
        (named?.diffs ?? []).map((d) => [d.variable, d.name])
      );
      assert.deepStrictEqual(
        matches.map(([variable]) => [variable, names.get(variable)]),
        matches.map(([variable, to]) => [variable, to])
      );
    })
  );
});
