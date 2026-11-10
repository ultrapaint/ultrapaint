import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Agents, makeRuntime } from "./agents.ts";
import { LoginShell } from "./login-shell.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectStore } from "./projects.ts";
import {
  fakeRemoteProjects,
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
      Layer.provideMerge(LoginShell.layerTest({ PATH: "/usr/bin" })),
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
    return yield* body(recorded).pipe(Effect.provide(app));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/**
 * A stop that should wait for nothing: it is given a second of the test clock, a tenth at a
 * time; none when it was still waiting then.
 */
const stopWithin = Effect.fnUntraced(function* (
  open: OpenProject["Service"],
  ask: boolean
) {
  const stopping = yield* Effect.forkChild(
    Effect.timeoutOption(open.stop({ ask }), "1 second"),
    { startImmediately: true }
  );
  for (let tenth = 0; tenth < 10; tenth += 1) {
    yield* TestClock.adjust("100 millis");
  }
  return yield* Fiber.join(stopping);
});

/** A signal's stop (SIGINT, SIGTERM), which waits for no answer. */
const signal = (open: OpenProject["Service"]) => stopWithin(open, false);

/** Lets the fibers forked run until a question is on screen (the store reads files first). */
const asked = Effect.fnUntraced(function* (recorded: Recorded) {
  while (recorded.questions.length === 0) {
    yield* Effect.promise(
      () => new Promise<void>((resolve) => setImmediate(resolve))
    );
  }
});

/** Lets the fibers forked run until a project's connection is on its way. */
const connected = Effect.fnUntraced(function* (recorded: Recorded) {
  while (!recorded.events.some((event) => event.startsWith("connect "))) {
    yield* Effect.promise(
      () => new Promise<void>((resolve) => setImmediate(resolve))
    );
  }
});

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
          { _tag: "Opening", detail: "/work/second", name: "second" },
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
        assert.isTrue(yield* open.stop({ ask: true }));
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
          { _tag: "Opening", detail: "/work/broken", name: "broken" },
          { _tag: "Welcome", problem: "it broke" },
        ]);
        assert.isTrue(Option.isNone(yield* open.current));
      })
    )
  );

  it.effect(
    "asks before it stops agents at work, and stays when the user says no",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const busy = yield* store.add("/work/busy");
          const other = yield* store.add("/work/other");
          yield* open.open(busy.id);
          recorded.working.busy = 2;
          recorded.answers.push(false);
          yield* open.open(other.id);
          assert.deepStrictEqual(recorded.questions, [
            "2 agents are working in busy",
          ]);
          assert.strictEqual(
            Option.getOrThrow(yield* open.current).id,
            busy.id
          );
          assert.deepStrictEqual(recorded.events, ["start busy"]);
          // Quitting asks the same; a signal then stops without asking.
          recorded.answers.push(false);
          assert.isFalse(yield* open.stop({ ask: true }));
          assert.deepStrictEqual(yield* signal(open), Option.some(true));
          assert.deepStrictEqual(recorded.events, ["start busy", "stop busy"]);
          assert.strictEqual(recorded.questions.length, 2);
        })
      )
  );

  it.effect(
    "a second close while the quit's question is on screen asks nothing more",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const busy = yield* store.add("/work/busy");
          yield* open.open(busy.id);
          recorded.working.busy = 1;
          const answer = yield* Deferred.make<boolean>();
          recorded.answers.push(Deferred.await(answer));
          const closing = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          const again = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          yield* Deferred.succeed(answer, false);
          assert.isFalse(yield* Fiber.join(closing));
          assert.isFalse(yield* Fiber.join(again));
          assert.deepStrictEqual(recorded.questions, [
            "An agent is working in busy",
          ]);
          assert.deepStrictEqual(recorded.events, ["start busy"]);
          // Asked again once that one is answered.
          recorded.answers.push(false);
          assert.isFalse(yield* open.stop({ ask: true }));
          assert.strictEqual(recorded.questions.length, 2);
        })
      )
  );

  it.effect(
    "a signal answers a quit's question on screen no and stops the server",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const busy = yield* store.add("/work/busy");
          yield* open.open(busy.id);
          recorded.working.busy = 1;
          // The window closed, then Cmd-Q, while the question is on screen: asked once.
          recorded.answers.push(Effect.never);
          const closing = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          const quitting = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          assert.deepStrictEqual(recorded.questions, [
            "An agent is working in busy",
          ]);
          assert.deepStrictEqual(yield* signal(open), Option.some(true));
          assert.isFalse(yield* Fiber.join(closing));
          assert.isFalse(yield* Fiber.join(quitting));
          assert.deepStrictEqual(recorded.events, ["start busy", "stop busy"]);
          assert.strictEqual(recorded.questions.length, 1);
          assert.isTrue(Option.isNone(yield* open.current));
        })
      )
  );

  it.effect(
    "a signal cuts a switch's question short: no switch, and the server stops",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const busy = yield* store.add("/work/busy");
          const other = yield* store.add("/work/other");
          yield* open.open(busy.id);
          recorded.working.busy = 2;
          recorded.answers.push(Effect.never);
          const switching = yield* Effect.forkChild(open.open(other.id));
          yield* asked(recorded);
          assert.deepStrictEqual(recorded.questions, [
            "2 agents are working in busy",
          ]);
          assert.deepStrictEqual(yield* signal(open), Option.some(true));
          yield* Fiber.join(switching);
          assert.deepStrictEqual(recorded.events, ["start busy", "stop busy"]);
          assert.isTrue(Option.isNone(yield* open.current));
          // Asked after the signal, nothing is put on screen.
          yield* open.open(other.id);
          assert.strictEqual(recorded.questions.length, 1);
        })
      )
  );

  it.effect(
    "leaves a server it attached to running, and asks nothing of it",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const attached = yield* store.add("/work/attached");
          const other = yield* store.add("/work/other");
          yield* open.open(attached.id);
          recorded.working.attached = 1;
          yield* open.open(other.id);
          yield* open.stop({ ask: true });
          assert.deepStrictEqual(recorded.questions, []);
          assert.deepStrictEqual(recorded.events, [
            "attach attached",
            "start other",
            "stop other",
          ]);
        })
      )
  );

  it.effect(
    "opens a folder on another machine in place of a local one, and stops its server on a switch",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const local = yield* store.add("/work/here");
          yield* open.open(local.id);
          const { opened, project } = yield* open.addRemote({
            host: "devbox",
            path: "~/code/shop",
          });
          assert.isTrue(opened);
          assert.strictEqual(project.kind, "ssh");
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/devbox/shop",
          });
          // The same folder again is the one open: nothing restarts.
          yield* open.addRemote({ host: "devbox", path: "~/code/shop/" });
          yield* open.open(local.id);
          assert.deepStrictEqual(recorded.events, [
            "start here",
            "stop here",
            "start devbox:shop",
            "stop devbox:shop",
            "start here",
          ]);
        })
      )
  );

  it.effect("says why a remote project could not be opened", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const open = yield* OpenProject;
        const { opened } = yield* Effect.orElseSucceed(
          open.addRemote({ host: "down", path: "/srv" }),
          () => ({ opened: false })
        );
        assert.isFalse(opened);
        assert.deepStrictEqual(recorded.views, [
          { _tag: "Opening", detail: "down:/srv", name: "srv" },
          { _tag: "Welcome", problem: "down could not be reached" },
        ]);
      })
    )
  );

  it.effect(
    "shows a project opening at once, and stops it for the list when asked",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const off = yield* store.addRemote({ host: "silent", path: "/srv" });
          yield* store.opened(off.id);
          const starting = yield* Effect.forkChild(open.start, {
            startImmediately: true,
          });
          yield* connected(recorded);
          // The machine has not answered, and the window already says what it is waiting for.
          assert.deepStrictEqual(recorded.views, [
            { _tag: "Opening", detail: "silent:/srv", name: "srv" },
          ]);
          yield* open.stopOpening;
          yield* Fiber.join(starting);
          assert.deepStrictEqual(recorded.views.at(-1), { _tag: "Welcome" });
          assert.deepStrictEqual(recorded.events, [
            "connect silent:srv",
            "give up silent:srv",
          ]);
          assert.isTrue(Option.isNone(yield* open.current));
        })
      )
  );

  it.effect("opening another project stops the one still opening", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProject;
        const off = yield* store.addRemote({ host: "silent", path: "/srv" });
        const here = yield* store.add("/work/here");
        const opening = yield* Effect.forkChild(open.open(off.id), {
          startImmediately: true,
        });
        yield* connected(recorded);
        // The one already opening, asked again, goes on opening.
        yield* open.open(off.id);
        yield* open.open(here.id);
        yield* Fiber.join(opening);
        assert.deepStrictEqual(recorded.events, [
          "connect silent:srv",
          "give up silent:srv",
          "start here",
        ]);
        assert.deepStrictEqual(recorded.views.at(-1), {
          _tag: "Editor",
          url: "http://127.0.0.1/here",
        });
        assert.strictEqual(Option.getOrThrow(yield* open.current).id, here.id);
      })
    )
  );

  for (const [quit, ask] of [
    ["a signal", false],
    ["closing the window", true],
  ] as const) {
    it.effect(
      `${quit} gives up the project still opening, and waits for it no longer`,
      () =>
        withApp((recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProject;
            const off = yield* store.addRemote({
              host: "silent",
              path: "/srv",
            });
            const opening = yield* Effect.forkChild(open.open(off.id), {
              startImmediately: true,
            });
            yield* connected(recorded);
            assert.deepStrictEqual(
              yield* stopWithin(open, ask),
              Option.some(true)
            );
            yield* Fiber.join(opening);
            assert.deepStrictEqual(recorded.events, [
              "connect silent:srv",
              "give up silent:srv",
            ]);
            // Nothing was open to ask about, and the window goes as it is.
            assert.deepStrictEqual(recorded.questions, []);
            assert.deepStrictEqual(recorded.views, [
              { _tag: "Opening", detail: "silent:/srv", name: "srv" },
            ]);
            assert.isTrue(Option.isNone(yield* open.current));
          })
        )
    );
  }

  it.effect(
    "a quit while a switch's question is on screen asks its own once that one is answered",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProject;
          const busy = yield* store.add("/work/busy");
          const off = yield* store.addRemote({ host: "silent", path: "/srv" });
          yield* open.open(busy.id);
          recorded.working.busy = 1;
          // The switch's question is on screen, and the window is closed: the quit has its own.
          const answer = yield* Deferred.make<boolean>();
          recorded.answers.push(Deferred.await(answer), false);
          const switching = yield* Effect.forkChild(open.open(off.id));
          yield* asked(recorded);
          const closing = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          yield* Deferred.succeed(answer, false);
          yield* Fiber.join(switching);
          assert.isFalse(yield* Fiber.join(closing));
          assert.deepStrictEqual(recorded.questions, [
            "An agent is working in busy",
            "An agent is working in busy",
          ]);
          assert.deepStrictEqual(recorded.events, ["start busy"]);
          assert.strictEqual(
            Option.getOrThrow(yield* open.current).id,
            busy.id
          );
        })
      )
  );
});
