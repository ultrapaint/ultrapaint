import { assert, describe } from "@effect/vitest";
import {
  defaultSettings,
  type SavedOnChange,
} from "@ultrapaint/contracts/settings";
import { Effect, Fiber, FileSystem, Path, PlatformError, Stream } from "effect";
import { EventBus } from "./events.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { SettingsService } from "./services/settings.ts";
import { eachTest } from "./testing/each-test.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** A package detection recognises as the designs: it depends on React. */
const DETECTED_PACKAGE = `${JSON.stringify({
  dependencies: { react: "^19.0.0" },
  name: "designs",
})}\n`;

/** An edit of the person's, through the editor's journal. */
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

const projectScope = Effect.flatMap(OpenProject, (project) => project.scope);

/** A folder of its own, empty, as the server sees it (temporary directories may be links). */
const emptyFolder = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
});

/** What the folder's refusal of the file says. */
const REFUSED =
  /^Couldn’t write .*ultrapaint\.config\.json: .*PermissionDenied/;

/** What no save says: published last, every save told before it has been taken by then. */
const MARKER: SavedOnChange = { problems: ["the test's marker"] };

/**
 * The first-change saves the editor is told of from now on. `told` publishes a marker after
 * them and answers with every one told before it.
 */
const savesTold = Effect.gen(function* () {
  const events = yield* EventBus;
  const listening = yield* Effect.forkScoped(
    events.subscribe("settings.savedOnChange").pipe(
      Stream.takeUntil((saved) => saved === MARKER),
      Stream.runCollect
    ),
    { startImmediately: true }
  );
  return {
    /** The first save told, once it is. */
    first: events.subscribe("settings.savedOnChange").pipe(Stream.runHead),
    told: Effect.gen(function* () {
      yield* events.publish("settings.savedOnChange", MARKER);
      const all = yield* Fiber.join(listening);
      return all.filter((saved) => saved !== MARKER);
    }),
  };
});

describe("a first run", () => {
  eachTest(ProjectTest({ storage: "saveOnChange" }))((it) => {
    it.effect(
      "opens a folder with nothing in it and writes nothing there until the first change, which makes its designs directory",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const fs = yield* FileSystem.FileSystem;
          const folder = yield* emptyFolder;
          yield* project.adoptDetected(folder);
          const info = yield* project.info;
          assert.isTrue(info.configured);
          assert.strictEqual(info.repoPath, folder);
          assert.strictEqual(info.setup, "detected");
          assert.strictEqual(info.designsDir, "docs/designs");
          assert.isTrue(info.storage.saveOnChange);
          assert.deepStrictEqual(yield* fs.readDirectory(folder), []);

          const saves = yield* savesTold;
          yield* project.changed;
          assert.deepStrictEqual(yield* saves.told, [
            { configPath: `${folder}/ultrapaint.config.json`, problems: [] },
          ]);
          assert.deepStrictEqual(
            yield* fs.readDirectory(`${folder}/docs/designs`),
            []
          );
          assert.strictEqual((yield* project.info).storage.mode, "file");
        })
    );

    it.effect(
      "leaves the home directory and the root unopened, and writes nothing there",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const settings = yield* SettingsService;
          const fs = yield* FileSystem.FileSystem;
          const { home } = yield* ProjectFixture;
          const before = yield* fs.readDirectory(home);
          yield* project.adoptDetected(home);
          yield* project.adoptDetected("/");
          assert.isNull(yield* settings.get);
          assert.deepStrictEqual(yield* fs.readDirectory(home), before);
        })
    );

    it.effect(
      "takes a folder with no package.json, and refuses an application that is no package",
      () =>
        Effect.gen(function* () {
          const settings = yield* SettingsService;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* emptyFolder;
          yield* fs.makeDirectory(path.join(folder, "docs/designs"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(folder, "app"));
          const bare = defaultSettings(folder);
          assert.deepStrictEqual(yield* settings.validate(bare), {
            ok: true,
            problems: [],
          });
          assert.deepStrictEqual(
            yield* settings.validate({ ...bare, resolveFrom: "app" }),
            { ok: false, problems: ["Application has no package.json: app"] }
          );
        })
    );
  });

  eachTest(
    ProjectTest({
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "saveOnChange",
    })
  )((it) => {
    it.effect(
      "saves the detected settings into the folder on the first edit, once, and keeps the project open",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const fs = yield* FileSystem.FileSystem;
          const { repo } = yield* ProjectFixture;
          yield* project.adoptDetected(repo);
          const configPath = `${repo}/ultrapaint.config.json`;
          assert.isFalse(yield* fs.exists(configPath));
          const scope = yield* projectScope;
          const saves = yield* savesTold;
          const first = yield* Effect.forkScoped(saves.first, {
            startImmediately: true,
          });

          yield* nameTheTitle;
          yield* Fiber.join(first);
          assert.isTrue(yield* fs.exists(configPath));
          const info = yield* project.info;
          assert.strictEqual(info.storage.mode, "file");
          assert.strictEqual(info.storage.configPath, configPath);
          assert.strictEqual(info.setup, "saved");
          assert.strictEqual(yield* projectScope, scope);
          assert.strictEqual(yield* undoLabel, "Name the title");

          // Another edit, and a prompt, save nothing more.
          yield* nameTheTitle;
          yield* project.changed;
          assert.deepStrictEqual(yield* saves.told, [
            { configPath, problems: [] },
          ]);
        })
    );

    it.effect("saves them when a prompt is the first change", () =>
      Effect.gen(function* () {
        const project = yield* ProjectManager;
        const { repo } = yield* ProjectFixture;
        yield* project.adoptDetected(repo);
        const saves = yield* savesTold;
        yield* project.changed;
        assert.deepStrictEqual(yield* saves.told, [
          { configPath: `${repo}/ultrapaint.config.json`, problems: [] },
        ]);
      })
    );
  });

  eachTest(
    ProjectTest({
      fileSystem: (fs) => ({
        ...fs,
        rename: (from, to) =>
          to.endsWith("/ultrapaint.config.json")
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  method: "rename",
                  module: "FileSystem",
                  pathOrDescriptor: to,
                })
              )
            : fs.rename(from, to),
      }),
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "saveOnChange",
    })
  )((it) => {
    it.effect(
      "keeps the edit when the folder refuses the settings, and says why once",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const { repo } = yield* ProjectFixture;
          yield* project.adoptDetected(repo);
          const saves = yield* savesTold;
          const first = yield* Effect.forkScoped(saves.first, {
            startImmediately: true,
          });
          yield* nameTheTitle;
          yield* Fiber.join(first);
          assert.strictEqual(yield* undoLabel, "Name the title");
          assert.strictEqual((yield* project.info).storage.mode, "ephemeral");
          yield* project.changed;
          const told = yield* saves.told;
          assert.strictEqual(told.length, 1);
          assert.isUndefined(told[0]?.configPath);
          assert.match(told[0]?.problems.join(" ") ?? "", REFUSED);
        })
    );
  });

  eachTest(
    ProjectTest({
      files: { "designs/package.json": DETECTED_PACKAGE },
      storage: "ephemeral",
    })
  )((it) => {
    it.effect("never saves a run started with --ephemeral", () =>
      Effect.gen(function* () {
        const project = yield* ProjectManager;
        const fs = yield* FileSystem.FileSystem;
        const { repo } = yield* ProjectFixture;
        yield* project.adoptDetected(repo);
        const saves = yield* savesTold;
        yield* nameTheTitle;
        yield* project.changed;
        assert.deepStrictEqual(yield* saves.told, []);
        assert.isFalse(yield* fs.exists(`${repo}/ultrapaint.config.json`));
        assert.strictEqual((yield* project.info).storage.mode, "ephemeral");
      })
    );
  });
});
