import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { mapTokens, tokenOf } from "@ultrapaint/contracts/token-table";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  type PlatformError,
} from "effect";
import { OpenProject, type ProjectServices } from "./project.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { EditService } from "./services/edit.ts";
import {
  ProjectFixture,
  ProjectTest,
  type ProjectTestOptions,
} from "./testing/project.ts";

/** An effect of the open project's services, run in it. */
const inProject = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(OpenProject, (project) => project.use(effect));

/** A test's own project: each test builds its world. */
const withProject =
  (options: ProjectTestOptions) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(ProjectTest(options)), Effect.scoped);

const designSystem = inProject(
  Effect.flatMap(DesignSystemService, (d) => d.get)
).pipe(Effect.map((state) => state.designSystem as DesignSystem));

const withValue = (ds: DesignSystem, name: string, value: string) =>
  mapTokens(ds, (t) => (t.name === name ? { ...t, value } : t));

const readRepo = (file: string) =>
  Effect.flatMap(ProjectFixture, ({ repo }) =>
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.readFileString(path.join(repo, file))
    )
  );

const THEME =
  "@theme {\n  --color-ink: #111827;\n  --color-line: #e5e5e5;\n}\n";

describe("the design system written", () => {
  it.effect(
    "a whole design system an agent writes follows into the code with codeTokens auto, as an edit does (D11)",
    () =>
      withProject({
        files: { "styles/app.css": THEME },
        settings: { codeTokens: "auto", hostCss: ["../../styles/app.css"] },
      })(
        Effect.gen(function* () {
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) => d.detect)
          );
          const ds = yield* designSystem;
          yield* inProject(
            Effect.flatMap(DesignSystemService, (d) =>
              d.write(withValue(ds, "color-ink", "#333333"))
            )
          );
          assert.include(
            yield* readRepo("styles/app.css"),
            "--color-ink: #333333"
          );
        })
      )
  );

  it.effect(
    "an undo that comes while an edit reads the design system lands before it or after it, never between (D12)",
    () =>
      withProject({
        fileSystem: gatedFileSystem,
        files: { "styles/app.css": THEME },
        settings: { hostCss: ["../../styles/app.css"] },
      })(
        Effect.gen(function* () {
          const service = inProject(Effect.map(DesignSystemService, (d) => d));
          const journal = inProject(Effect.map(EditService, (e) => e));
          yield* Effect.flatMap(service, (d) => d.detect);
          yield* Effect.flatMap(service, (d) =>
            d.edit([{ name: "color-ink", op: "setValue", value: "#333333" }])
          );

          // The next edit is held as it first looks at design-system.json.
          const reached = yield* Deferred.make<void>();
          const go = yield* Deferred.make<void>();
          const edit = yield* Effect.forkChild(
            Effect.flatMap(service, (d) =>
              d.edit([{ name: "color-line", op: "setValue", value: "#000000" }])
            ).pipe(
              Effect.provideService(Gate, {
                held: false,
                hold: Effect.andThen(
                  Deferred.succeed(reached, undefined),
                  Deferred.await(go)
                ),
              })
            )
          );
          yield* Deferred.await(reached);
          // An undo asked for meanwhile.
          const undo = yield* Effect.forkChild(
            Effect.flatMap(journal, (e) => e.undo)
          );
          yield* Effect.yieldNow;
          yield* Deferred.succeed(go, undefined);
          yield* Fiber.join(edit);
          const undone = yield* Fiber.join(undo);

          // The undo took back the step made last, the edit: nothing was lost between them.
          assert.strictEqual(undone?.label, "Change color-line");
          const after = yield* designSystem;
          assert.strictEqual(tokenOf(after, "color-ink")?.value, "#333333");
          assert.strictEqual(tokenOf(after, "color-line")?.value, "#e5e5e5");
          const redone = yield* Effect.flatMap(journal, (e) => e.redo);
          assert.strictEqual(redone?.label, "Change color-line");
          assert.strictEqual(
            tokenOf(yield* designSystem, "color-line")?.value,
            "#000000"
          );
        })
      )
  );
});

/**
 * A fiber's hold on design-system.json: the first time the fiber that carries it looks at the
 * file (a stat or a read), it is held until the test lets it go. Every other fiber passes.
 */
const Gate = Context.Reference<{
  held: boolean;
  readonly hold: Effect.Effect<void>;
} | null>("ultrapaint/server/test/DesignSystemGate", {
  defaultValue: () => null,
});

const gated = <A>(
  file: string,
  effect: Effect.Effect<A, PlatformError.PlatformError>
) =>
  Effect.gen(function* () {
    const gate = yield* Gate;
    if (!(gate === null || gate.held) && file.endsWith("design-system.json")) {
      gate.held = true;
      yield* gate.hold;
    }
    return yield* effect;
  });

const gatedFileSystem = (fs: FileSystem.FileSystem): FileSystem.FileSystem => ({
  ...fs,
  readFileString: (file, encoding) =>
    gated(file, fs.readFileString(file, encoding)),
  stat: (file) => gated(file, fs.stat(file)),
});
