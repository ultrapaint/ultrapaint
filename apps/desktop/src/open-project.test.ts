import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option } from "effect";
import { OpenProject } from "./open-project.ts";
import { ProjectStore } from "./projects.ts";
import {
  fakeServers,
  fakeShell,
  makeRecorded,
  type Recorded,
} from "./testing.ts";

const withApp = <A, E>(
  body: (recorded: Recorded) => Effect.Effect<A, E, OpenProject | ProjectStore>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const recorded = makeRecorded();
    const app = OpenProject.layer(dir).pipe(
      Layer.provideMerge(ProjectStore.layer(dir)),
      Layer.provideMerge(fakeServers(recorded)),
      Layer.provideMerge(fakeShell(recorded))
    );
    return yield* body(recorded).pipe(Effect.provide(app));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("OpenProject", () => {
  it.effect("asks for a first project when there is none", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const open = yield* OpenProject;
        yield* open.start;
        assert.deepStrictEqual(recorded.views, [{ _tag: "Welcome" }]);
        assert.isTrue(Option.isNone(yield* open.current));
      })
    )
  );

  it.effect("opens the project opened last when the app starts", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProject;
        yield* store.add("/work/first");
        const second = yield* store.add("/work/second");
        yield* store.opened(second.id);
        yield* open.start;
        assert.deepStrictEqual(recorded.events, ["start second"]);
        assert.deepStrictEqual(recorded.views, [
          { _tag: "Editor", url: "http://127.0.0.1/second" },
        ]);
        assert.strictEqual(
          Option.getOrThrow(yield* open.current).id,
          second.id
        );
      })
    )
  );

  it.effect("stops one project's server before it starts the next one's", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProject;
        const a = yield* store.add("/work/a");
        const b = yield* store.add("/work/b");
        yield* open.open(a.id);
        yield* open.open(b.id);
        // Opening the one open already does nothing.
        yield* open.open(b.id);
        yield* open.stop;
        assert.deepStrictEqual(recorded.events, [
          "start a",
          "stop a",
          "start b",
          "stop b",
        ]);
        assert.isTrue(Option.isNone(yield* open.current));
      })
    )
  );

  it.effect(
    "adds a picked folder and opens it; a cancelled picker adds nothing",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          assert.isTrue(Option.isNone(yield* open.add));
          recorded.picks.push("/work/picked");
          const added = Option.getOrThrow(yield* open.add);
          assert.strictEqual(added.name, "picked");
          assert.deepStrictEqual(
            (yield* store.list).map((p) => p.path),
            ["/work/picked"]
          );
          assert.deepStrictEqual(recorded.events, ["start picked"]);
        })
      )
  );

  it.effect("says why a project could not be opened, on the welcome page", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProject;
        const broken = yield* store.add("/work/broken");
        const error = yield* Effect.flip(open.open(broken.id));
        assert.strictEqual(error._tag, "ServerStartError");
        assert.deepStrictEqual(recorded.views, [
          { _tag: "Welcome", problem: "it broke" },
        ]);
        assert.isTrue(Option.isNone(yield* open.current));
      })
    )
  );
});
