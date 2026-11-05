import { assert, describe } from "@effect/vitest";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { EventBus } from "./events.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { GitService } from "./services/git.ts";
import { ProfileService } from "./services/profile.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { SettingsService } from "./services/settings.ts";
import { eachTest } from "./testing/each-test.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** A package detection recognises as the designs: it depends on React. */
const DETECTED_PACKAGE = `${JSON.stringify({
  dependencies: { react: "^19.0.0" },
  name: "designs",
})}\n`;

/** An edit the undo history keeps, so a project opened again shows by its empty history. */
const nameTheTitle = Effect.flatMap(OpenProject, (project) =>
  project.use(
    Effect.flatMap(DocumentService, (documents) =>
      documents.apply({
        edits: [
          {
            doc: "home.page.json",
            ops: [{ id: "heading", op: "update", set: { name: "Title" } }],
          },
        ],
        label: "Name the title",
      })
    )
  )
);

const undoLabel = Effect.flatMap(OpenProject, (project) =>
  project.use(
    Effect.map(
      Effect.flatMap(EditService, (edit) => edit.state),
      (state) => state.undoLabel
    )
  )
);

/** The settings the open project runs. */
const running = Effect.flatMap(OpenProject, (project) =>
  project.use(Effect.map(RepoPaths, (paths) => paths.settings))
);

const projectScope = Effect.flatMap(OpenProject, (project) => project.scope);

/**
 * The first project info the editor is told of that `holds`, once `trigger` has run. Started
 * at once, the subscription is in place before the trigger runs.
 */
const toldOf = <A, E, R>(
  holds: (info: ProjectInfo) => boolean,
  trigger: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const events = yield* EventBus;
    const told = yield* Effect.forkScoped(
      Stream.runHead(Stream.filter(events.subscribe("project"), holds)).pipe(
        Effect.timeout("10 seconds")
      ),
      { startImmediately: true }
    );
    const result = yield* trigger;
    return { result, told: Option.getOrUndefined(yield* Fiber.join(told)) };
  });

describe("the settings in force", () => {
  eachTest(ProjectTest())((it) => {
    it.effect(
      "leaves the project open when it is given the settings it runs",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const { settings } = yield* ProjectFixture;
          const scope = yield* projectScope;
          yield* nameTheTitle;
          // The same settings with their keys in another order, and a field set to nothing.
          const reordered: Settings = {
            designsDir: settings.designsDir,
            hostCss: settings.hostCss,
            libraryDirs: settings.libraryDirs,
            repoPath: settings.repoPath,
            resolveFrom: undefined,
          };
          assert.isTrue((yield* project.set(reordered)).ok);
          assert.strictEqual(yield* projectScope, scope);
          assert.strictEqual(yield* undoLabel, "Name the title");

          // Other settings open it again.
          assert.isTrue(
            (yield* project.set({ ...settings, codeTokens: "auto" })).ok
          );
          assert.notStrictEqual(yield* projectScope, scope);
          assert.strictEqual((yield* running).codeTokens, "auto");
          assert.isUndefined(yield* undoLabel);
        })
    );
  });

  eachTest(
    ProjectTest({
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "ephemeral",
    })
  )((it) => {
    it.effect(
      "tells the editor when detected settings are saved, and keeps the project open",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const settings = yield* SettingsService;
          const { repo } = yield* ProjectFixture;
          yield* project.adoptDetected(repo);
          assert.strictEqual((yield* project.info).setup, "detected");
          const detected = yield* settings.get;
          assert.isNotNull(detected);
          const scope = yield* projectScope;
          yield* nameTheTitle;

          if (detected) {
            const { told } = yield* toldOf(
              (info) => info.setup === "saved",
              project.set(detected)
            );
            assert.isDefined(told);
          }
          assert.strictEqual(yield* projectScope, scope);
          assert.strictEqual(yield* undoLabel, "Name the title");

          // Saved to a file, the session keeps its project and the editor is told where.
          const configPath = `${repo}/ultrapaint.config.json`;
          const { result, told } = yield* toldOf(
            (info) => info.storage.mode === "file",
            project.persist({ configPath, settings: yield* running })
          );
          assert.isTrue(result.validation.ok);
          assert.strictEqual(told?.storage.configPath, configPath);
          assert.strictEqual(yield* projectScope, scope);
          assert.strictEqual(yield* undoLabel, "Name the title");
        })
    );
  });

  eachTest(
    ProjectTest({
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "ephemeral",
    })
  )((it) => {
    it.effect("puts a user's settings in force over detection", () =>
      Effect.gen(function* () {
        const project = yield* ProjectManager;
        const { repo, settings } = yield* ProjectFixture;
        // Detection reads the repository while the user saves: whichever lands first, the
        // user's settings are the ones in force.
        const detecting = yield* Effect.forkScoped(
          project.adoptDetected(repo),
          {
            startImmediately: true,
          }
        );
        assert.isTrue(
          (yield* project.set({ ...settings, codeTokens: "auto" })).ok
        );
        yield* Fiber.join(detecting);
        assert.strictEqual((yield* running).codeTokens, "auto");
        const info = yield* project.info;
        assert.strictEqual(info.setup, "saved");

        // Detected later, nothing replaces them either.
        const scope = yield* projectScope;
        yield* project.adoptDetected(repo);
        assert.strictEqual(yield* projectScope, scope);
        assert.strictEqual((yield* running).codeTokens, "auto");
      })
    );
  });

  eachTest(
    ProjectTest({
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "ephemeral",
    })
  )((it) => {
    it.effect(
      "saves a folder's setup beside its code, the designs directory made, as the agent changed it",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const fs = yield* FileSystem.FileSystem;
          const { repo } = yield* ProjectFixture;
          yield* project.adoptDetected(repo);
          const { result, told } = yield* toldOf(
            (info) => info.setup === "saved",
            project.saveSetup({ designsDir: "ui-designs", stylesheet: "" })
          );
          assert.deepStrictEqual(result, {
            configPath: `${repo}/ultrapaint.config.json`,
            problems: [],
          });
          assert.strictEqual(told?.storage.mode, "file");
          assert.isTrue(yield* fs.exists(`${repo}/ui-designs`));
          const saved = yield* running;
          assert.strictEqual(saved.designsDir, "ui-designs");
          assert.deepStrictEqual(saved.hostCss, []);

          // Saved again, it goes where the settings are kept now.
          const again = yield* project.saveSetup({});
          assert.deepStrictEqual(again.problems, []);
          assert.strictEqual((yield* running).designsDir, "ui-designs");
        })
    );
  });

  eachTest(ProjectTest({ storage: "ephemeral" }), {
    realClock:
      "the configuration file written by hand is heard by a real watch of its directory",
  })((it) => {
    it.effect(
      "tells the editor of settings someone else changed in the file, whatever field",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const settings = yield* SettingsService;
          const fs = yield* FileSystem.FileSystem;
          const { repo } = yield* ProjectFixture;
          const configPath = `${repo}/ultrapaint.config.json`;
          yield* project.persist({ configPath, settings: yield* running });
          // Only the components' directories change: nothing else the info carries.
          yield* fs.makeDirectory(`${repo}/src/ui`, { recursive: true });
          const written = JSON.parse(yield* fs.readFileString(configPath));
          const { told } = yield* toldOf(
            (info) => info.settings?.libraryDirs[0] === "src/ui",
            fs.writeFileString(
              configPath,
              JSON.stringify({ ...written, libraryDirs: ["src/ui"] })
            )
          );
          assert.deepStrictEqual(told?.settings, yield* settings.get);
          assert.deepStrictEqual((yield* running).libraryDirs, ["src/ui"]);
        })
    );
  });

  eachTest(ProjectTest({ git: false, settings: { git: "on" } }))((it) => {
    it.effect(
      "tells the editor of the user's name and of a repository made",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const profile = yield* ProfileService;
          const named = yield* toldOf(
            (info) => info.displayName === "Ada",
            profile.set({ displayName: "Ada" })
          );
          assert.isDefined(named.told);

          assert.isFalse((yield* project.info).gitRepository);
          const made = yield* toldOf(
            (info) => info.gitRepository === true,
            Effect.flatMap(OpenProject, (open) =>
              open.use(Effect.flatMap(GitService, (git) => git.init))
            )
          );
          assert.isDefined(made.told);
        })
    );
  });
});
