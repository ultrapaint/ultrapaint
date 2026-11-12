import path from "node:path";
import { assert, describe } from "@effect/vitest";
import type { History as HistoryList } from "@ultrapaint/contracts/snapshots";
import { Effect, FileSystem } from "effect";
import { TestClock } from "effect/testing";
import { OpenProject, type ProjectServices } from "./project.ts";
import { DesignFiles } from "./services/design-files.ts";
import { EditService } from "./services/edit.ts";
import { History } from "./services/history.ts";
import { eachTest } from "./testing/each-test.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

const HOME_FILE = "designs/home.page.json";
const ABOUT_FILE = "designs/about.page.json";
const NOTES_FILE = "designs/notes.md";
const PULLED_FILE = "designs/pulled.page.json";

/** An effect of the open project's services, run in it. */
const inProject = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(OpenProject, (project) => project.use(effect));

const history = <A, E>(use: (h: History["Service"]) => Effect.Effect<A, E>) =>
  inProject(Effect.flatMap(History, use));

const listed = history((h) => h.get);

/** A file written in the editor: one step of the journal, for the person. */
const edit = (file: string, content: string) =>
  inProject(
    Effect.flatMap(EditService, (journal) =>
      journal.transaction(`Write ${file}`, (tx) => tx.write(file, content))
    )
  );

const undo = inProject(Effect.flatMap(EditService, (journal) => journal.undo));

/** A file written past the editor, as a pull or another editor does, and the watcher sees. */
const fromOutside = (file: string, content: string) =>
  Effect.gen(function* () {
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path.join(repo, file), content);
    yield* inProject(
      Effect.flatMap(DesignFiles, (files) => files.report(file, content))
    );
  });

/** A file written by a thread's agent through the editor. */
const byAgent = (file: string, content: string) =>
  Effect.gen(function* () {
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path.join(repo, file), content);
    yield* inProject(
      Effect.flatMap(DesignFiles, (files) =>
        files.report(file, content, { _tag: "Thread", threadId: "t-1" })
      )
    );
  });

const read = (file: string) =>
  Effect.gen(function* () {
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    const abs = path.join(repo, file);
    return (yield* fs.exists(abs)) ? yield* fs.readFileString(abs) : null;
  });

/**
 * The history once it says what `done` waits for: the changes are heard on a fiber of their
 * own, which runs as this one yields.
 */
const once = (done: (list: HistoryList) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const list = yield* listed;
      if (done(list)) {
        return list;
      }
      yield* Effect.yieldNow;
    }
    return assert.fail("the history never said so");
  });

const kinds = (list: HistoryList) => list.points.map((p) => p.kind);

describe("the designs' history", () => {
  eachTest(ProjectTest())((it) => {
    it.effect("begins with the designs as they were found", () =>
      Effect.gen(function* () {
        const list = yield* listed;
        assert.deepStrictEqual(kinds(list), ["start"]);
        assert.include(list.points[0]?.files ?? [], HOME_FILE);
        assert.isNull(list.pending);
      })
    );

    it.effect("closes the person's edits two minutes after the last one", () =>
      Effect.gen(function* () {
        yield* edit(ABOUT_FILE, "{}\n");
        const pending = yield* once((l) => l.pending !== null);
        assert.strictEqual(pending.pending?.edits, 1);
        yield* TestClock.adjust("1 minute");
        assert.deepStrictEqual(kinds(yield* listed), ["start"]);
        yield* TestClock.adjust("1 minute");
        const list = yield* once((l) => l.points.length === 2);
        assert.deepStrictEqual(kinds(list), ["edits", "start"]);
        assert.deepStrictEqual(list.points[0]?.files, [ABOUT_FILE]);
        assert.strictEqual(list.points[0]?.edits, 1);
        assert.isNull(list.pending);
      })
    );

    it.effect("closes them every ten minutes while they go on", () =>
      Effect.gen(function* () {
        // Seven edits a minute and a half apart: the tenth minute closes them, two before the last.
        for (let i = 0; i < 7; i += 1) {
          yield* edit(ABOUT_FILE, `{ "step": ${i} }\n`);
          yield* once((l) => l.pending?.edits === i + 1);
          yield* TestClock.adjust("90 seconds");
        }
        const list = yield* once((l) => l.points.length === 2);
        assert.strictEqual(list.points[0]?.edits, 7);
      })
    );

    it.effect(
      "closes them before a turn, whose changes are its own point with its prompt and model",
      () =>
        Effect.gen(function* () {
          yield* edit(ABOUT_FILE, "{}\n");
          yield* once((l) => l.pending !== null);
          yield* history((h) =>
            h.turnStarted("t-1", {
              agentId: "claude-code",
              label: "Tighten the header",
              model: "Opus 5.5",
            })
          );
          yield* byAgent(HOME_FILE, '{ "agent": true }\n');
          // What another writer does meanwhile is the turn's too.
          yield* fromOutside(NOTES_FILE, "# Notes\n");
          yield* history((h) => h.turnEnded("t-1"));
          const list = yield* listed;
          assert.deepStrictEqual(kinds(list), ["turn", "edits", "start"]);
          const [turn, edits] = list.points;
          assert.deepStrictEqual(edits?.files, [ABOUT_FILE]);
          assert.deepStrictEqual(turn?.files, [HOME_FILE, NOTES_FILE]);
          assert.strictEqual(turn?.label, "Tighten the header");
          assert.strictEqual(turn?.model, "Opus 5.5");
          assert.strictEqual(turn?.threadId, "t-1");
          assert.deepStrictEqual(turn?.canvases, [""]);
        })
    );

    it.effect("makes no point of a turn that changed nothing", () =>
      Effect.gen(function* () {
        yield* history((h) =>
          h.turnStarted("t-2", { agentId: "codex", label: "Only look" })
        );
        yield* history((h) => h.turnEnded("t-2"));
        assert.deepStrictEqual(kinds(yield* listed), ["start"]);
      })
    );

    it.effect(
      "makes a change from outside a point of its own, the person's edits apart",
      () =>
        Effect.gen(function* () {
          yield* edit(ABOUT_FILE, "{}\n");
          yield* once((l) => l.pending !== null);
          yield* fromOutside(PULLED_FILE, "{}\n");
          for (let i = 0; i < 20; i += 1) {
            yield* Effect.yieldNow;
          }
          yield* TestClock.adjust("1 second");
          const list = yield* once((l) => l.points.length === 3);
          assert.deepStrictEqual(kinds(list), ["outside", "edits", "start"]);
          assert.deepStrictEqual(list.points[0]?.files, [PULLED_FILE]);
          assert.deepStrictEqual(list.points[1]?.files, [ABOUT_FILE]);
          assert.isNull(list.pending);
        })
    );

    it.effect(
      "restores a point in one undo step, the edits not in a point kept first",
      () =>
        Effect.gen(function* () {
          const home = yield* read(HOME_FILE);
          const [start] = (yield* listed).points;
          yield* edit(HOME_FILE, '{ "edited": true }\n');
          yield* once((l) => l.pending !== null);
          yield* history((h) => h.restore(start?.id ?? ""));
          assert.strictEqual(yield* read(HOME_FILE), home);
          const list = yield* listed;
          assert.deepStrictEqual(kinds(list), ["restore", "edits", "start"]);
          assert.strictEqual(list.points[0]?.label, "The designs");
          // Its own writes are no edit of the person's.
          yield* Effect.yieldNow;
          assert.isNull((yield* listed).pending);

          assert.isNotNull(yield* undo);
          assert.strictEqual(yield* read(HOME_FILE), '{ "edited": true }\n');
        })
    );

    it.effect("names a point a version, and takes the name away", () =>
      Effect.gen(function* () {
        yield* edit(ABOUT_FILE, "{}\n");
        yield* once((l) => l.pending !== null);
        const saved = yield* history((h) => h.save("Shown to the client"));
        assert.strictEqual(saved.kind, "edits");
        assert.strictEqual(saved.name, "Shown to the client");
        const list = yield* listed;
        assert.deepStrictEqual(kinds(list), ["edits", "start"]);
        assert.isNull(list.pending);

        yield* history((h) => h.rename(saved.id, null));
        assert.isUndefined((yield* listed).points[0]?.name);
      })
    );

    it.effect("says what a point did to a page, before and after", () =>
      Effect.gen(function* () {
        const page = (text: string) =>
          JSON.stringify({
            root: {
              children: [
                { id: "heading", role: "heading", text, type: "text" },
              ],
              id: "root",
              type: "page",
            },
            version: 1,
          });
        yield* edit(ABOUT_FILE, page("Before"));
        yield* once((l) => l.pending !== null);
        yield* TestClock.adjust("2 minutes");
        yield* once((l) => l.points.length === 2);
        yield* edit(ABOUT_FILE, page("After"));
        yield* once((l) => l.pending !== null);
        yield* TestClock.adjust("2 minutes");
        const [point] = (yield* once((l) => l.points.length === 3)).points;
        const [change] = yield* history((h) => h.compare(point?.id ?? ""));
        assert.strictEqual(change?.file, ABOUT_FILE);
        assert.notDeepEqual(change?.before, change?.after);
      })
    );
  });
});
