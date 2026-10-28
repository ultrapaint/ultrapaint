import path from "node:path";
import { assert, describe, layer, it as plain } from "@effect/vitest";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { allTokens } from "@ultrapaint/contracts/token-table";
import { makeFixture as makeFigmaFile } from "@ultrapaint/figma-import/testing/fixture";
import { Effect, FileSystem, PlatformError } from "effect";
import { ProjectManager, type ProjectServices } from "./project.ts";
import { CodeSide } from "./services/code-side.ts";
import { DesignMd, documentBaseline } from "./services/design-md.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { FigmaBaseline } from "./services/figma-baseline.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { figmaBaselineOf } from "./services/sync-sides.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** An effect of the open project's services, run in it. */
const inProject = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(ProjectManager, (project) => project.use(effect));

const designSystem = Effect.map(
  inProject(Effect.flatMap(DesignSystemService, (d) => d.get)),
  (state) => state.designSystem
);

const tokenValue = (ds: DesignSystem | null, name: string) =>
  ds ? allTokens(ds).find((t) => t.name === name)?.value : undefined;

const readJson = (file: string) =>
  Effect.flatMap(ProjectFixture, ({ repo }) =>
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      Effect.map(
        fs.readFileString(path.join(repo, file)),
        (text) => JSON.parse(text) as Record<string, unknown>
      )
    )
  );

/** Every rename of a stylesheet counted; the one numbered `failing` fails, as a full disk would. */
const renames = { css: 0, failing: 0 };
const failingRenames = (fs: FileSystem.FileSystem): FileSystem.FileSystem => ({
  ...fs,
  rename: (from, to) => {
    if (to.endsWith(".css")) {
      renames.css += 1;
      if (renames.css === renames.failing) {
        return Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            method: "rename",
            module: "FileSystem",
            pathOrDescriptor: to,
          })
        );
      }
    }
    return fs.rename(from, to);
  },
});

const BRAND = "@theme {\n  --color-brand: #2563eb;\n}\n";
const INK = "@theme {\n  --color-ink: #111827;\n}\n";

describe("the code's side", () => {
  layer(
    ProjectTest({
      fileSystem: failingRenames,
      files: { "styles/brand.css": BRAND, "styles/ink.css": INK },
      settings: { hostCss: ["../../styles/brand.css", "../../styles/ink.css"] },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "writes every stylesheet or none: the first goes back when the second cannot be written",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const code = inProject(Effect.map(CodeSide, (c) => c));
          const changes = [
            { name: "color-brand", value: "#1d4ed8" },
            { name: "color-ink", value: "#000000" },
          ];
          renames.css = 0;
          renames.failing = 2;
          const refused = yield* Effect.flip(
            Effect.flatMap(code, (c) => c.write(changes, null))
          );
          assert.include(
            refused.message,
            "the stylesheets could not be written"
          );
          assert.strictEqual(renames.css, 3, "two written, one put back");
          assert.strictEqual(
            yield* fs.readFileString(path.join(repo, "styles/brand.css")),
            BRAND
          );
          assert.strictEqual(
            yield* fs.readFileString(path.join(repo, "styles/ink.css")),
            INK
          );
          const { byName } = yield* Effect.flatMap(code, (c) => c.tokens);
          assert.strictEqual(byName.get("color-brand")?.value, "#2563eb");

          // Both written, and every reader sees them.
          renames.failing = 0;
          const { files } = yield* Effect.flatMap(code, (c) =>
            c.write(changes, null)
          );
          assert.deepStrictEqual([...files].sort(), [
            "styles/brand.css",
            "styles/ink.css",
          ]);
          const after = yield* Effect.flatMap(code, (c) => c.tokens);
          assert.strictEqual(after.byName.get("color-brand")?.value, "#1d4ed8");
          assert.strictEqual(after.byName.get("color-ink")?.value, "#000000");
        })
    );
  });

  layer(
    ProjectTest({
      files: { "styles/app.css": INK },
      settings: { hostCss: ["../../styles/app.css"] },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "reads the code once for every caller, and again once a stylesheet changes",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const sync = yield* DesignSystemSyncService;
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) => d.detect)
          );
          const code = inProject(Effect.flatMap(CodeSide, (c) => c.tokens));
          const first = yield* code;
          assert.strictEqual(yield* code, first, "kept while nothing changed");
          assert.strictEqual(first.byName.get("color-ink")?.value, "#111827");

          // Someone changes the code by hand.
          yield* fs.writeFileString(
            path.join(repo, "styles/app.css"),
            INK.replace("#111827", "#222222")
          );
          const second = yield* code;
          assert.notStrictEqual(second, first);
          assert.strictEqual(second.byName.get("color-ink")?.value, "#222222");
          // Sync, its plan and the preview read the same.
          const compared = yield* sync.tokens("code");
          assert.deepStrictEqual(
            compared?.diffs.map((d) => [d.name, d.outcome, d.source]),
            [["color-ink", "to-design", "#222222"]]
          );
          assert.strictEqual((yield* sync.plan).facts.codeTokens?.toDesign, 1);
          const state = inProject(
            Effect.flatMap(DesignSystemService, (d) => d.get)
          );
          assert.include((yield* state).previewCss ?? "", "#111827");

          // The design takes the code's value, then changes, and the export writes it: the
          // agreement moves with each.
          yield* sync.apply("code", [], "import");
          assert.strictEqual(
            tokenValue(yield* designSystem, "color-ink"),
            "#222222"
          );
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) =>
              d.setToken({ name: "color-ink", value: "#444444" })
            )
          );
          assert.deepStrictEqual(
            (yield* sync.tokens("code"))?.diffs.map((d) => d.outcome),
            ["source-behind"]
          );
          yield* sync.apply("code", [], "export");
          assert.strictEqual(
            (yield* code).byName.get("color-ink")?.value,
            "#444444"
          );
          const system = yield* readJson("designs/design-system.json");
          assert.deepStrictEqual(
            (system.codeSync as { agreed: unknown }).agreed,
            { "color-ink": "#444444" }
          );
          // The preview no longer draws the design's ink over the code's.
          assert.notInclude((yield* state).previewCss ?? "", "--color-ink");
        })
    );
  });
});

/** A Figma file with one colour variable, Color/Brand, #2563eb. */
const brandFile = () => {
  const f = makeFigmaFile();
  const guid = (localID: number) => ({ localID, sessionID: 9 });
  const set = f.add(f.internal, {
    guid: guid(1),
    name: "Tokens",
    type: "VARIABLE_SET",
    variableSetModes: [{ id: guid(2), name: "Light", sortPosition: "a" }],
  } as never);
  f.add(f.internal, {
    guid: guid(10),
    name: "Color/Brand",
    type: "VARIABLE",
    variableDataValues: {
      entries: [
        {
          modeID: guid(2),
          variableData: {
            dataType: "COLOR",
            resolvedDataType: "COLOR",
            value: {
              colorValue: { a: 1, b: 235 / 255, g: 99 / 255, r: 37 / 255 },
            },
          },
        },
      ],
    },
    variableResolvedType: "COLOR",
    variableSetID: { guid: set },
  } as never);
  return f.build();
};

describe("Figma's side", () => {
  layer(
    ProjectTest({
      files: {
        "node_modules/tailwindcss/package.json": '{ "name": "tailwindcss" }\n',
        "node_modules/tailwindcss/theme.css":
          "@theme default {\n  --color-red-500: #ef4444;\n}\n",
        "styles/app.css": `@import "tailwindcss";\n${INK}`,
      },
      settings: { hostCss: ["../../styles/app.css"] },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "is matched to the code's own tokens while there is no design system, in Sync as in its task",
      () =>
        Effect.gen(function* () {
          const code = yield* inProject(
            Effect.flatMap(CodeSide, (c) => c.tokens)
          );
          // The style system's default is read, and is the code's but not its own.
          assert.isFalse(code.byName.get("color-red-500")?.own ?? true);
          yield* inProject(
            Effect.flatMap(FigmaImportService, (f) =>
              f.create("brand.fig", brandFile())
            )
          );
          const compared = yield* (yield* DesignSystemSyncService).tokens(
            "figma"
          );
          assert.deepStrictEqual(
            compared?.targets.map((t) => t.name),
            ["color-ink"]
          );
          const { text } = yield* (yield* AgentTasks).task({
            _tag: "Sync",
            source: "figma",
          });
          const listed = text
            .split("The tokens to match to:\n")[1]
            ?.split("\n\n")[0];
          assert.strictEqual(listed, "- color-ink: #111827");
        })
    );
  });

  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "keeps its baseline until there is a design system, and says nothing of another file",
      () =>
        Effect.gen(function* () {
          const baseline = {
            at: 5,
            code: { "color-ink": "#111827" },
            figma: { "color-ink": "#111827" },
            file: "brand.fig",
          };
          yield* inProject(
            Effect.flatMap(FigmaBaseline, (f) => f.wait(baseline))
          );
          assert.deepStrictEqual(
            yield* inProject(figmaBaselineOf("brand.fig")),
            baseline
          );
          assert.isNull(yield* inProject(figmaBaselineOf("other.fig")));

          // A design system written meanwhile takes it in.
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) => d.detect)
          );
          assert.deepStrictEqual((yield* designSystem)?.sync, baseline);
          assert.deepStrictEqual(
            (yield* readJson("designs/design-system.json")).sync,
            baseline
          );
        })
    );
  });
});

describe("DESIGN.md's side", () => {
  layer(
    ProjectTest({
      files: { "styles/app.css": INK },
      settings: { codeTokens: "auto", hostCss: ["../../styles/app.css"] },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "moves its baseline with the design system, placed then mirrored, before a token set returns",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) => d.detect)
          );
          const ds = yield* designSystem;
          const placed = yield* inProject(
            Effect.flatMap(DesignMd, (m) => m.place(ds))
          );
          assert.strictEqual(placed.path, "DESIGN.md");
          const agreed = Effect.map(
            readJson("designs/design-system.json"),
            (system) =>
              (system.designMd as { agreed: Record<string, string> }).agreed
          );
          assert.strictEqual((yield* agreed)["colors.ink"], "#111827");

          // Read as soon as the call returns, while the editor has not been told yet: DESIGN.md
          // and, with `codeTokens: auto`, the code are written already.
          const { files } = yield* inProject(
            Effect.flatMap(DesignSystemService, (d) =>
              d.setToken({ name: "color-ink", value: "#333333" })
            )
          );
          assert.include(files, "styles/app.css");
          assert.include(
            yield* fs.readFileString(path.join(repo, "DESIGN.md")),
            'ink: "#333333"'
          );
          assert.include(
            yield* fs.readFileString(path.join(repo, "styles/app.css")),
            "--color-ink: #333333"
          );
          assert.strictEqual((yield* agreed)["colors.ink"], "#333333");
          assert.strictEqual(
            tokenValue(yield* designSystem, "color-ink"),
            "#333333"
          );
        })
    );
  });

  plain(
    "keeps a baseline's matches, or forgets them once the document has the design's names",
    () => {
      const previous = {
        agreed: { "colors.ink": "#111" },
        at: 3,
        matches: {
          "colors.tertiary": { by: "user" as const, to: "color-accent" },
        },
      };
      assert.deepStrictEqual(
        documentBaseline(previous, { agreed: {}, at: 9 }),
        {
          ...previous,
          agreed: {},
          at: 9,
        }
      );
      assert.deepStrictEqual(
        documentBaseline(previous, { agreed: {}, at: 9, matches: null }),
        { agreed: {}, at: 9 }
      );
      // Matches saved before anything is taken are no agreement yet.
      assert.deepStrictEqual(
        documentBaseline(null, { matches: previous.matches }),
        { agreed: {}, at: 0, matches: previous.matches }
      );
    }
  );
});
