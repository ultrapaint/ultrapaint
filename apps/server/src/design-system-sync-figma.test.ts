import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { makeFixture } from "@ultrapaint/figma-import/testing/fixture";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

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

const upload = (port: number, name: string, bytes: Uint8Array) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}/api/figma/import`, {
      body: bytes,
      headers: {
        "content-type": "application/octet-stream",
        origin: `http://127.0.0.1:${port}`,
        "x-file-name": encodeURIComponent(name),
      },
      method: "POST",
    })
  );

layer(TestServer, { excludeTestServices: true, timeout: "120 seconds" })(
  "Figma's tokens in the sync",
  (it) => {
    it.effect(
      "compares Figma's tokens with the code's, writes what the user takes, and remembers where they agreed",
      () =>
        Effect.gen(function* () {
          const { client, port, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const css = path.join(repo, "styles/app.css");
          yield* fs.writeFileString(
            path.join(repo, "designs/package.json"),
            '{ "name": "designs", "dependencies": { "react": "19" } }\n'
          );
          yield* fs.makeDirectory(path.join(repo, "styles"));
          yield* fs.writeFileString(css, THEME);
          yield* client["settings.set"]({
            ...settings,
            hostCss: ["../../styles/app.css"],
            libraryDirs: ["ui"],
          });

          // #2563eb, the code's brand: the same in both.
          const first = yield* upload(
            port,
            "tokens.fig",
            tokensFile([37 / 255, 99 / 255, 235 / 255])
          );
          assert.strictEqual(first.status, 200);
          const comparison = yield* client["sync.figmaTokens"]();
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
          const matched = yield* client["sync.matchFigma"]({
            entries: [
              { to: "color-highlight", variable: "Tokens/Color/Accent" },
              { to: "color-card", variable: "Tokens/Radius/Card" },
            ],
          });
          assert.strictEqual(matched.saved, 1);
          assert.strictEqual(matched.unmatched, 0);
          assert.lengthOf(matched.problems, 1);
          const named = yield* client["sync.figmaTokens"]();
          assert.deepInclude(
            (named?.diffs ?? []).map((d) => [d.variable, d.name, d.outcome]),
            ["Tokens/Color/Accent", "color-highlight", "to-code"]
          );

          // The user keeps the code's muted and takes Figma's radius.
          const applied = yield* client["sync.applyFigma"]({
            decisions: [
              { name: "color-muted", take: "code" },
              { name: "radius-card", take: "figma" },
            ],
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
          yield* upload(port, "tokens.fig", tokensFile([1, 0, 0]));
          const again = yield* client["sync.figmaTokens"]();
          assert.isTrue(again?.baseline ?? false);
          const next = Object.fromEntries(
            (again?.diffs ?? []).map((d) => [d.name, d.outcome])
          );
          assert.deepStrictEqual(next, {
            "color-brand": "to-code",
            "color-highlight": "same",
            "color-muted": "figma-behind",
            "radius-card": "same",
          });
        }),
      30_000
    );

    it.effect(
      "keeps every match saved at the same time",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const matches = [
            ["Tokens/Color/Accent", "color-one"],
            ["Tokens/Color/Brand", "color-two"],
            ["Tokens/Color/Muted", "color-three"],
          ] as const;
          yield* Effect.forEach(
            matches,
            ([variable, to]) =>
              client["sync.matchFigma"]({ entries: [{ to, variable }] }),
            { concurrency: "unbounded" }
          );
          const named = yield* client["sync.figmaTokens"]();
          const names = new Map(
            (named?.diffs ?? []).map((d) => [d.variable, d.name])
          );
          assert.deepStrictEqual(
            matches.map(([variable]) => [variable, names.get(variable)]),
            matches.map(([variable, to]) => [variable, to])
          );
        }),
      30_000
    );
  }
);
