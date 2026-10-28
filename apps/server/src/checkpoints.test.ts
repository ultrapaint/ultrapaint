import path from "node:path";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { EventBus } from "./events.ts";
import { ProjectManager, type ProjectServices } from "./project.ts";
import { EditService } from "./services/edit.ts";
import { COLLECT_EVERY, SnapshotStore } from "./services/snapshot-store.ts";
import { Snapshots } from "./services/snapshots.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { ThreadService } from "./services/threads/threads.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";

const HOME_FILE = "designs/home.page.json";
const ABOUT_FILE = "designs/about.page.json";
const COMMENTS = "designs/comments.json";
// A file of each test's own: the tests share one project. A component the agent wrote is no
// page, which the designs' watcher would tell of by itself.
const NEW_FILE = "designs/agent.tsx";
const SECOND_FILE = "designs/second.page.json";
const KEPT_FILE = "designs/kept.page.json";
const ONLY_FILE = "designs/only.md";

/** An effect of the open project's services, run in it. */
const inProject = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(ProjectManager, (project) => project.use(effect));

const undo = inProject(Effect.flatMap(EditService, (edit) => edit.undo));

/** Writes a file of the fixture as an agent does: on disk, past the editor. */
const write = (file: string, content: string) =>
  Effect.gen(function* () {
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path.join(repo, file), content);
  });

const read = (file: string) =>
  Effect.gen(function* () {
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    const abs = path.join(repo, file);
    return (yield* fs.exists(abs)) ? yield* fs.readFileString(abs) : null;
  });

/** The checkpoint a turn takes before it starts, newest first in the list. */
const checkpoint = (label: string) =>
  Effect.gen(function* () {
    const checkpoints = yield* Checkpoints;
    yield* checkpoints.create("t-1", label);
    const made = (yield* checkpoints.list).find((c) => c.label === label);
    assert.isDefined(made);
    return made?.id ?? "";
  });

const revert = (id: string) =>
  Effect.flatMap(Checkpoints, (checkpoints) => checkpoints.revert(id));

describe("agent turn checkpoints", () => {
  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "compares with now, and reverts as one step that undo takes back",
      () =>
        Effect.gen(function* () {
          const home = yield* read(HOME_FILE);
          const id = yield* checkpoint("Before: one step");
          yield* write(HOME_FILE, "{}\n");
          yield* write(ABOUT_FILE, "{}\n");

          const diffs = yield* Effect.flatMap(Checkpoints, (c) => c.diff(id));
          assert.sameMembers(
            diffs.map((d) => d.path),
            [ABOUT_FILE, HOME_FILE]
          );
          assert.include(
            diffs.find((d) => d.path === ABOUT_FILE)?.diff ?? "",
            "+{}"
          );

          yield* revert(id);
          assert.strictEqual(yield* read(HOME_FILE), home);
          assert.isNull(yield* read(ABOUT_FILE));

          const undone = yield* undo;
          assert.isNotNull(undone);
          assert.strictEqual(yield* read(HOME_FILE), "{}\n");
          assert.strictEqual(yield* read(ABOUT_FILE), "{}\n");
        })
    );

    it.effect("tells the editor of a file the revert removes", () =>
      Effect.gen(function* () {
        const events = yield* EventBus;
        const id = yield* checkpoint("Before: a new page");
        yield* write(NEW_FILE, "export default function Agent() {}\n");
        // Started at once, the fiber has subscribed by the time the fork returns.
        const removed = yield* Effect.forkScoped(
          events.subscribe("file.changed").pipe(
            Stream.filter((e) => e.file === NEW_FILE),
            Stream.runHead
          ),
          { startImmediately: true }
        );
        yield* revert(id);
        const event = yield* Fiber.join(removed).pipe(
          Effect.timeout("5 seconds")
        );
        assert.deepStrictEqual(Option.getOrNull(event), {
          file: NEW_FILE,
          hash: "",
        });
      })
    );

    it.effect("leaves the comments written since as they are", () =>
      Effect.gen(function* () {
        const id = yield* checkpoint("Before: comments");
        const comments = '{ "comments": [], "version": 1 }\n';
        yield* write(COMMENTS, comments);
        assert.notInclude(
          (yield* Effect.flatMap(Checkpoints, (c) => c.diff(id))).map(
            (d) => d.path
          ),
          COMMENTS
        );
        yield* revert(id);
        assert.strictEqual(yield* read(COMMENTS), comments);
      })
    );

    it.effect(
      "keeps a file's content once for the turns that found it unchanged",
      () =>
        Effect.gen(function* () {
          const store = yield* SnapshotStore;
          const first = yield* checkpoint("Before: the first turn");
          yield* write(SECOND_FILE, "{}\n");
          const second = yield* checkpoint("Before: the second turn");
          const refs = yield* store.named("checkpoints");
          const manifest = (id: string) => {
            const ref = refs.find((r) => r.name === id);
            assert.isDefined(ref);
            return store.read(ref?.id ?? "");
          };
          const a = yield* manifest(first);
          const b = yield* manifest(second);
          assert.isUndefined(a.files[SECOND_FILE]);
          assert.isDefined(b.files[SECOND_FILE]);
          assert.isDefined(a.files[HOME_FILE]);
          assert.strictEqual(a.files[HOME_FILE], b.files[HOME_FILE]);
        })
    );

    it.effect("is kept as a snapshot under a name of the same files", () =>
      Effect.gen(function* () {
        const store = yield* SnapshotStore;
        const id = yield* checkpoint("Before: kept");
        yield* write(KEPT_FILE, "{}\n");
        const snapshot = yield* Effect.flatMap(Snapshots, (s) =>
          s.create("Shown to the client", id)
        );
        const tree = (namespace: string, name: string) =>
          Effect.map(
            store.named(namespace),
            (refs) => refs.find((r) => r.name === name)?.id
          );
        const kept = yield* tree("checkpoints", id);
        assert.isDefined(kept);
        assert.strictEqual(yield* tree("designs", snapshot.id), kept);
        const diffs = yield* Effect.flatMap(Snapshots, (s) =>
          s.diff(snapshot.id)
        );
        assert.deepStrictEqual(
          diffs.map((d) => d.path),
          [KEPT_FILE]
        );
      })
    );

    it.effect("keeps the last 30", () =>
      Effect.gen(function* () {
        const checkpoints = yield* Checkpoints;
        const store = yield* SnapshotStore;
        for (let i = 0; i < 31; i += 1) {
          yield* checkpoints.create("t-2", `Before: turn ${i}`);
        }
        assert.lengthOf(yield* checkpoints.list, 30);
        assert.lengthOf(yield* store.named("checkpoints"), 30);
      })
    );

    it.effect(
      "lets go of a checkpoint's own content in time, and keeps what a snapshot shares",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const checkpoints = yield* Checkpoints;
          const store = yield* SnapshotStore;
          yield* write(ONLY_FILE, "only one turn had this\n");
          const first = yield* checkpoint("Before: the turn with a file");
          yield* write(ONLY_FILE, "a snapshot has this\n");
          const second = yield* checkpoint("Before: the turn kept");
          const snapshot = yield* Effect.flatMap(Snapshots, (s) =>
            s.create("Kept by the user", second)
          );
          yield* fs.remove(path.join(repo, ONLY_FILE));
          const hashOf = (id: string) =>
            Effect.gen(function* () {
              const ref = (yield* store.named("checkpoints")).find(
                (r) => r.name === id
              );
              return (yield* store.read(ref?.id ?? "")).files[ONLY_FILE] ?? "";
            });
          const only = yield* hashOf(first);
          const shared = yield* hashOf(second);
          // Enough turns that both are let go of, and the store collected since.
          for (let i = 0; i < 30 + COLLECT_EVERY; i += 1) {
            yield* checkpoints.create("t-3", `Before: later turn ${i}`);
          }
          const ids = (yield* checkpoints.list).map((c) => c.id);
          assert.notInclude(ids, first);
          assert.notInclude(ids, second);
          assert.isTrue(yield* Effect.isFailure(store.readFile(only)));
          assert.strictEqual(
            new TextDecoder().decode(yield* store.readFile(shared)),
            "a snapshot has this\n"
          );
          const diffs = yield* Effect.flatMap(Snapshots, (s) =>
            s.diff(snapshot.id)
          );
          assert.include(
            diffs.map((d) => d.path),
            ONLY_FILE
          );
        })
    );
  });

  /** A checkpoint as it was kept before the snapshot store: one JSON file with every design file. */
  const old = (
    id: string,
    at: number,
    files: Readonly<Record<string, string>>
  ) =>
    JSON.stringify({
      checkpoint: {
        at,
        files: Object.keys(files),
        id,
        label: `Before: ${id}`,
        threadId: "t-old",
      },
      files,
    });

  layer(
    ProjectTest({
      state: {
        "checkpoints/cp_old_1.json": old("cp_old_1", 1000, {
          [COMMENTS]: '{ "comments": [], "version": 1 }\n',
          "designs/package.json": '{ "name": "designs" }\n',
        }),
        "checkpoints/cp_old_2.json": "{ not json",
      },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "moves the checkpoints kept in the old format into the store",
      () =>
        Effect.gen(function* () {
          const { home } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const checkpoints = yield* Checkpoints;
          const [moved, ...rest] = yield* checkpoints.list;
          assert.deepStrictEqual(rest, []);
          // The comments were never the designs: the checkpoint no longer keeps them.
          assert.deepStrictEqual(moved, {
            at: 1000,
            files: ["designs/package.json"],
            id: "cp_old_1",
            label: "Before: cp_old_1",
            threadId: "t-old",
          });
          // The file moved is gone; the one that does not read stays, for someone to look at.
          assert.deepStrictEqual(
            yield* fs.readDirectory(path.join(home, "checkpoints")),
            ["cp_old_2.json"]
          );
          const diffs = yield* checkpoints.diff("cp_old_1");
          assert.deepStrictEqual(
            diffs.map((d) => d.path),
            [HOME_FILE]
          );
          const comments = '{ "comments": [{ "id": "c1" }], "version": 1 }\n';
          yield* write(COMMENTS, comments);
          yield* checkpoints.revert("cp_old_1");
          assert.isNull(yield* read(HOME_FILE));
          assert.strictEqual(yield* read(COMMENTS), comments);
        })
    );
  });

  /** An agent the test plays, configured as a user's is in the state directory. */
  const scripted = JSON.stringify({
    args: [],
    command: "scripted",
    id: "scripted",
    name: "Scripted",
  });

  layer(ProjectTest({ state: { "agents/scripted.json": scripted } }), {
    excludeTestServices: true,
  })((it) => {
    it.effect(
      "publishes the checkpoints with a turn's, though the turn writes no design file",
      () =>
        Effect.gen(function* () {
          const events = yield* EventBus;
          const threads = yield* ThreadService;
          const agents = yield* ScriptedAgents;
          // Started at once, the fiber has subscribed by the time the fork returns.
          const published = yield* Effect.forkScoped(
            Stream.runHead(events.subscribe("checkpoints")),
            { startImmediately: true }
          );
          const { id } = yield* threads.create("scripted");
          yield* threads.prompt({
            attachments: [],
            text: "Only look",
            threadId: id,
          });
          const turn = yield* (yield* agents.next).nextTurn;
          yield* turn.end();
          const list = Option.getOrNull(
            yield* Fiber.join(published).pipe(Effect.timeout("2 seconds"))
          );
          assert.deepStrictEqual(
            list?.map((c) => [c.label, c.threadId]),
            [["Before: Only look", id]]
          );
          assert.deepStrictEqual(
            list,
            yield* Effect.flatMap(Checkpoints, (c) => c.list)
          );
        })
    );

    it.effect(
      "publishes the snapshots when one is made and when it is deleted",
      () =>
        Effect.gen(function* () {
          const events = yield* EventBus;
          const snapshots = yield* Snapshots;
          const published = yield* Effect.forkScoped(
            Stream.runCollect(Stream.take(events.subscribe("snapshots"), 2)),
            { startImmediately: true }
          );
          const made = yield* snapshots.create("Shown to the client");
          yield* snapshots.delete(made.id);
          const lists = yield* Fiber.join(published).pipe(
            Effect.timeout("2 seconds")
          );
          assert.deepStrictEqual(
            lists.map((list) => list.map((s) => s.id)),
            [[made.id], []]
          );
        })
    );
  });
});
