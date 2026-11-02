import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { NewDesignUpdate } from "@ultrapaint/contracts/shell-bridge";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { Agents, makeRuntime } from "./agents.ts";
import { LoginShell } from "./login-shell.ts";
import { DESIGNS_HOME, folderNameOf, NewDesigns } from "./new-design.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectStore } from "./projects.ts";
import {
  fakeRemoteProjects,
  fakeServers,
  fakeShell,
  makeRecorded,
  type Recorded,
} from "./testing.ts";

const fakeNew = path.resolve(import.meta.dirname, "../testing/fake-new.mjs");

const decodeArgs = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.String))
);

/** The app around a fake `ultrapaint new`, in a home directory of its own. */
const withApp = <A, E>(
  body: (context: {
    readonly home: string;
    readonly recorded: Recorded;
    readonly record: string;
  }) => Effect.Effect<A, E, NewDesigns | ProjectStore | FileSystem.FileSystem>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const record = path.join(home, "record.json");
    const recorded = makeRecorded();
    const app = NewDesigns.layer({
      home,
      launch: {
        args: [fakeNew],
        command: process.execPath,
        webDist: "/app/web",
      },
    }).pipe(
      Layer.provideMerge(OpenProject.layer(path.join(home, "data"))),
      Layer.provideMerge(ProjectStore.layer(path.join(home, "data"))),
      Layer.provideMerge(
        LoginShell.layerTest({
          FAKE_NEW_RECORD: record,
          PATH: process.env.PATH ?? "",
        })
      ),
      Layer.provideMerge(
        Agents.layerTest(
          makeRuntime(
            { adaptersDir: "/app/adapters", node: "/app/electron" },
            {}
          )
        )
      ),
      Layer.provideMerge(fakeServers(recorded)),
      Layer.provideMerge(fakeRemoteProjects(recorded)),
      Layer.provideMerge(fakeShell(recorded))
    );
    return yield* body({ home, record, recorded }).pipe(Effect.provide(app));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Each update as `step:state`. */
const steps = (updates: readonly NewDesignUpdate[]) =>
  updates.map((u) => `${u.step}:${u.state}`);

describe("the folder a new design is proposed", () => {
  it("is named after the design, without what a folder cannot be called", () => {
    assert.strictEqual(folderNameOf("Acme Web"), "Acme Web");
    assert.strictEqual(folderNameOf("Q3/Q4 plans"), "Q3-Q4 plans");
    assert.strictEqual(folderNameOf("..hidden"), "hidden");
    assert.strictEqual(folderNameOf("   "), "Untitled");
  });

  it.effect("is in ~/Ultrapaint, numbered when one of that name is there", () =>
    withApp(({ home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const designs = yield* NewDesigns;
        const first = path.join(home, DESIGNS_HOME, "Acme");
        assert.strictEqual(yield* designs.folderFor("Acme"), first);
        yield* fs.makeDirectory(first, { recursive: true });
        assert.strictEqual(yield* designs.folderFor("Acme"), `${first} 2`);
        yield* fs.makeDirectory(`${first} 2`);
        assert.strictEqual(yield* designs.folderFor("Acme"), `${first} 3`);
      })
    )
  );
});

describe("a new design", () => {
  it.effect(
    "is written by ultrapaint new, step by step, then joins the list under its name and opens",
    () =>
      withApp(({ home, record, recorded }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const designs = yield* NewDesigns;
          const folder = path.join(home, DESIGNS_HOME, "acme");
          const updates: NewDesignUpdate[] = [];
          const outcome = yield* designs.create(
            {
              code: "root",
              folder,
              git: true,
              name: "Acme",
              template: "starter",
            },
            (update) => Effect.sync(() => updates.push(update))
          );
          assert.deepStrictEqual(outcome, {});
          assert.deepStrictEqual(steps(updates), [
            "folder:active",
            "folder:done",
            "write:active",
            "write:done",
            "install:active",
            "install:done",
            "git:active",
            "git:done",
            "open:active",
            "open:done",
          ]);
          assert.deepStrictEqual(
            yield* decodeArgs(yield* fs.readFileString(record)),
            [
              folder,
              "--name=Acme",
              "--template=starter",
              "--code=root",
              "--git",
              "--progress-json",
            ]
          );
          const listed = yield* (yield* ProjectStore).list;
          assert.deepStrictEqual(
            listed.map((p) => [p.name, p.path]),
            [["Acme", folder]]
          );
          assert.deepStrictEqual(recorded.events, ["start acme"]);
          // The editor is told it is new: it opens on Sync's define step.
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/acme?new-design=starter",
          });
        })
      ),
    30_000
  );

  it.effect(
    "stops at the step that failed, saying why, and opens nothing",
    () =>
      withApp(({ home, recorded }) =>
        Effect.gen(function* () {
          const designs = yield* NewDesigns;
          const updates: NewDesignUpdate[] = [];
          const outcome = yield* designs.create(
            {
              code: "app",
              folder: path.join(home, "unfinished"),
              git: false,
              name: "Unfinished",
              template: "blank",
            },
            (update) => Effect.sync(() => updates.push(update))
          );
          assert.deepStrictEqual(outcome.failed, {
            message: "pnpm install failed:\nERR_FAKE no registry",
            step: "install",
          });
          assert.strictEqual(steps(updates).at(-1), "install:failed");
          assert.deepStrictEqual(recorded.events, []);

          // Written as far as it got, it opens as it is when asked.
          assert.deepStrictEqual(
            yield* designs.open(
              path.join(home, "unfinished"),
              "Unfinished",
              "blank"
            ),
            {}
          );
          assert.deepStrictEqual(recorded.events, ["start unfinished"]);
        })
      ),
    30_000
  );

  it.effect(
    "says what the command said when it stopped before any step",
    () =>
      withApp(({ home }) =>
        Effect.gen(function* () {
          const designs = yield* NewDesigns;
          const updates: NewDesignUpdate[] = [];
          const outcome = yield* designs.create(
            {
              code: "app",
              folder: path.join(home, "crash"),
              git: false,
              name: "Crash",
              template: "blank",
            },
            (update) => Effect.sync(() => updates.push(update))
          );
          assert.strictEqual(outcome.failed?.step, "folder");
          assert.include(
            outcome.failed?.message ?? "",
            "something the command could not get past"
          );
          assert.deepStrictEqual(steps(updates), ["folder:failed"]);
        })
      ),
    30_000
  );

  it.effect("needs a folder's full path", () =>
    withApp(() =>
      Effect.gen(function* () {
        const designs = yield* NewDesigns;
        const outcome = yield* designs.create(
          {
            code: "app",
            folder: "Ultrapaint/Acme",
            git: false,
            name: "Acme",
            template: "blank",
          },
          () => Effect.void
        );
        assert.strictEqual(outcome.failed?.step, "folder");
      })
    )
  );
});
