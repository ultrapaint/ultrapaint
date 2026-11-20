import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Agents, makeRuntime } from "./agents.ts";
import { APP_EDITOR_URL, type AppEditor } from "./app-editor.ts";
import { Folders } from "./folders.ts";
import { LoginShell } from "./login-shell.ts";
import { MAX_PAGES, OpenProjects } from "./open-projects.ts";
import { PROJECTS_FILE, ProjectStore } from "./projects.ts";
import {
  FAKE_VERSION,
  fakeRemoteProjects,
  fakeServers,
  fakeShell,
  makeRecorded,
  type Recorded,
  until,
} from "./testing.ts";

const withApp = <A, E>(
  body: (
    recorded: Recorded,
    /** The app's data directory. */
    dir: string
  ) => Effect.Effect<A, E, OpenProjects | ProjectStore | FileSystem.FileSystem>,
  /** The app's own editor (ADR 0100); without, every server serves its own. */
  appEditor?: AppEditor
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const recorded = makeRecorded();
    const app = OpenProjects.layer(dir, appEditor).pipe(
      Layer.provideMerge(ProjectStore.layer(dir)),
      Layer.provideMerge(Folders.layer({ dataDir: dir, home: "/home/u" })),
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
    return yield* body(recorded, dir).pipe(Effect.provide(app));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/**
 * The app started again on the same data directory: a fresh `OpenProjects` and fakes, the
 * projects and tabs as the last run left them.
 */
const startedAgain = <A, E>(
  dir: string,
  body: (recorded: Recorded) => Effect.Effect<A, E, OpenProjects | ProjectStore>
) =>
  Effect.gen(function* () {
    const recorded = makeRecorded();
    const app = OpenProjects.layer(dir).pipe(
      Layer.provideMerge(ProjectStore.layer(dir)),
      Layer.provideMerge(Folders.layer({ dataDir: dir, home: "/home/u" })),
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
    return yield* body(recorded).pipe(Effect.provide(app), Effect.scoped);
  });

/** Waits until a question is on screen. */
const asked = (recorded: Recorded) =>
  until(recorded, ({ questions }) => questions.length > 0);

/** Waits until a server that does not answer is being waited for. */
const connected = (recorded: Recorded) =>
  until(recorded, ({ events }) =>
    events.some((event) => event.startsWith("connect "))
  );

/** The tabs as the strip was last told them: each one's name and state, the shown one marked. */
const tabsTold = (recorded: Recorded) =>
  (recorded.tabs.at(-1) ?? []).map(
    (t) => `${t.shown ? "*" : ""}${t.name} ${t.state}`
  );

describe("OpenProjects", () => {
  const APP: AppEditor = { url: APP_EDITOR_URL, version: FAKE_VERSION };

  it.effect(
    "opens a project whose server runs the app's version in the app's own editor, telling it the server (ADR 0100)",
    () =>
      withApp(
        (recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const shop = yield* store.add("/work/shop");
            yield* open.open(shop.id);
            assert.deepStrictEqual(recorded.views.at(-1), {
              _tag: "Editor",
              server: "http://127.0.0.1/shop",
              url: "ultrapaint://app/",
            });
            // Over SSH too, at the same version, in a page of its own.
            const site = yield* store.addRemote({
              host: "devbox",
              path: "~/site",
            });
            yield* open.open(site.id);
            assert.deepStrictEqual(recorded.views.at(-1), {
              _tag: "Editor",
              server: "http://127.0.0.1/devbox/site",
              url: "ultrapaint://app/",
            });
            assert.strictEqual(recorded.viewsIn.at(-1), site.id);
          }),
        APP
      )
  );

  it.effect(
    "opens a server the app only attached to, or one of another version, in the editor it serves",
    () =>
      withApp(
        (recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const attached = yield* store.add("/work/attached");
            yield* open.open(attached.id);
            assert.deepStrictEqual(recorded.views.at(-1), {
              _tag: "Editor",
              url: "http://127.0.0.1/attached",
            });
            const site = yield* store.addRemote({
              host: "older",
              path: "~/site",
            });
            yield* open.open(site.id);
            assert.deepStrictEqual(recorded.views.at(-1), {
              _tag: "Editor",
              url: "http://127.0.0.1/older/site",
            });
          }),
        APP
      )
  );

  it.effect(
    "opens a second project in a tab of its own while the first one's server keeps running",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          yield* open.open(a.id);
          recorded.working.a = 1;
          yield* open.open(b.id);
          assert.deepStrictEqual(recorded.events, ["start a", "start b"]);
          assert.deepStrictEqual(recorded.questions, []);
          // In the order opened, b shown and still opening until its editor is ready.
          assert.deepStrictEqual(tabsTold(recorded), [
            "a opening",
            "*b opening",
          ]);
          assert.deepStrictEqual(recorded.viewsIn, [a.id, a.id, b.id, b.id]);
          assert.strictEqual(Option.getOrThrow(yield* open.current).id, b.id);
        })
      )
  );

  it.effect(
    "switching tabs stops nothing and loads nothing for a page kept",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          yield* open.open(a.id);
          yield* open.open(b.id);
          const loaded = recorded.views.length;
          yield* open.show(a.id);
          yield* open.showAt(2);
          yield* open.showAt(1);
          assert.strictEqual(recorded.views.length, loaded);
          assert.deepStrictEqual(recorded.shown.slice(-3), [a.id, b.id, a.id]);
          assert.deepStrictEqual(recorded.events, ["start a", "start b"]);
          // Home, then back: the editor as it was.
          yield* open.show(null);
          assert.isNull(recorded.shown.at(-1));
          assert.isTrue(Option.isNone(yield* open.current));
          assert.deepStrictEqual(tabsTold(recorded), [
            "a opening",
            "b opening",
          ]);
        })
      )
  );

  it.effect(
    "shows the tab of a project open already rather than opening a second one",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          yield* open.open(a.id);
          yield* open.open(b.id);
          yield* open.openFolder("/work/a");
          assert.deepStrictEqual(recorded.events, ["start a", "start b"]);
          assert.strictEqual(recorded.shown.at(-1), a.id);
          assert.deepStrictEqual(
            (recorded.tabs.at(-1) ?? []).map((t) => t.name),
            ["a", "b"]
          );
        })
      )
  );

  it.effect(
    "lets the page seen least recently go past five, its server running, and loads it again when shown",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const ids: string[] = [];
          for (const name of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
            const project = yield* store.add(`/work/${name}`);
            ids.push(project.id);
            yield* open.open(project.id);
          }
          assert.strictEqual(MAX_PAGES, 5);
          // p1 was seen least recently: its page goes, not its server.
          assert.deepStrictEqual(recorded.drops, [ids[0]]);
          assert.isFalse(recorded.events.some((e) => e.startsWith("stop")));
          const loaded = recorded.views.length;
          yield* open.show(ids[0] ?? "");
          assert.strictEqual(recorded.views.length, loaded + 1);
          assert.strictEqual(recorded.viewsIn.at(-1), ids[0]);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/p1",
          });
          // Now p2 is the one seen least recently.
          assert.deepStrictEqual(recorded.drops, [ids[0], ids[1]]);
          assert.strictEqual(
            recorded.events.filter((e) => e.startsWith("start")).length,
            6
          );
        })
      )
  );

  it.effect(
    "closing a tab stops its server, asking first when an agent works there, and shows the tab seen before",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const docs = yield* store.add("/work/docs-site");
          yield* open.open(a.id);
          yield* open.open(docs.id);
          recorded.working["docs-site"] = 1;
          recorded.answers.push(false);
          assert.isFalse(yield* open.close(docs.id));
          assert.deepStrictEqual(recorded.questions, ["Close docs-site?"]);
          assert.deepStrictEqual(recorded.details, [
            "An agent is working there. Closing the project stops it.",
          ]);
          assert.deepStrictEqual(recorded.events, [
            "start a",
            "start docs-site",
          ]);
          // Agreed, it goes, and a is shown again.
          assert.isTrue(yield* open.close(docs.id));
          assert.deepStrictEqual(recorded.events, [
            "start a",
            "start docs-site",
            "stop docs-site",
          ]);
          assert.strictEqual(recorded.shown.at(-1), a.id);
          assert.deepStrictEqual(recorded.drops, [docs.id]);
          assert.deepStrictEqual(tabsTold(recorded), ["*a opening"]);
          // Nothing at work: closed with no question, Home shown.
          assert.isTrue(yield* open.close(a.id));
          assert.strictEqual(recorded.questions.length, 2);
          assert.isNull(recorded.shown.at(-1));
          assert.deepStrictEqual(recorded.tabs.at(-1), []);
        })
      )
  );

  it.effect(
    "quitting asks once, naming every project with agents at work, and stops nothing when declined",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          for (const name of ["docs-site", "quiet", "ultrapaint", "attached"]) {
            yield* open.open((yield* store.add(`/work/${name}`)).id);
          }
          recorded.working["docs-site"] = 1;
          recorded.working.ultrapaint = 2;
          // A server only attached to is never asked about, nor stopped.
          recorded.working.attached = 3;
          recorded.answers.push(false);
          assert.isFalse(yield* open.stop({ ask: true }));
          assert.deepStrictEqual(recorded.questions, ["Quit Ultrapaint?"]);
          assert.deepStrictEqual(recorded.details, [
            "Agents are working in docs-site and ultrapaint. Quitting stops them.",
          ]);
          assert.isFalse(recorded.events.some((e) => e.startsWith("stop")));
          assert.isTrue(yield* open.stop({ ask: true }));
          assert.deepStrictEqual(
            recorded.events.filter((e) => e.startsWith("stop")).sort(),
            ["stop docs-site", "stop quiet", "stop ultrapaint"]
          );
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
          const open = yield* OpenProjects;
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
          yield* asked(recorded);
          yield* Deferred.succeed(answer, false);
          assert.isFalse(yield* Fiber.join(closing));
          assert.isFalse(yield* Fiber.join(again));
          assert.deepStrictEqual(recorded.details, [
            "An agent is working in busy. Quitting stops it.",
          ]);
          assert.deepStrictEqual(recorded.events, ["start busy"]);
        })
      )
  );

  it.effect(
    "a signal answers a quit's question on screen no and stops every server",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const busy = yield* store.add("/work/busy");
          const other = yield* store.add("/work/other");
          yield* open.open(busy.id);
          yield* open.open(other.id);
          recorded.working.busy = 1;
          recorded.answers.push(Effect.never);
          const closing = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          yield* asked(recorded);
          assert.isTrue(yield* open.stop({ ask: false }));
          assert.isFalse(yield* Fiber.join(closing));
          assert.deepStrictEqual(
            recorded.events.filter((e) => e.startsWith("stop")).sort(),
            ["stop busy", "stop other"]
          );
          assert.strictEqual(recorded.questions.length, 1);
        })
      )
  );

  for (const [quit, ask] of [
    ["a signal", false],
    ["closing the window", true],
  ] as const) {
    it.effect(
      `${quit} gives up a project still opening, and waits for it no longer`,
      () =>
        withApp((recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const here = yield* store.add("/work/here");
            const off = yield* store.addRemote({
              host: "silent",
              path: "/srv",
            });
            yield* open.open(here.id);
            const opening = yield* Effect.forkChild(open.open(off.id), {
              startImmediately: true,
            });
            yield* connected(recorded);
            assert.isTrue(yield* open.stop({ ask }));
            yield* Fiber.join(opening);
            assert.deepStrictEqual(recorded.events, [
              "start here",
              "connect silent:srv",
              "stop here",
              "give up silent:srv",
            ]);
          })
        )
    );
  }

  it.effect(
    "brings every tab back at the next start, starting only the one shown, and each other the first time it is shown",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const ids = yield* startedAgain(dir, () =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const a = yield* store.add("/work/a");
            const b = yield* store.add("/work/b");
            const c = yield* store.add("/work/c");
            yield* open.open(a.id);
            yield* open.open(b.id);
            yield* open.open(c.id);
            yield* open.show(b.id);
            yield* open.stop({ ask: true });
            return [a.id, b.id, c.id] as const;
          })
        );
        yield* startedAgain(dir, (recorded) =>
          Effect.gen(function* () {
            const open = yield* OpenProjects;
            yield* open.start();
            assert.deepStrictEqual(recorded.events, ["start b"]);
            assert.deepStrictEqual(tabsTold(recorded), [
              "a idle",
              "*b opening",
              "c idle",
            ]);
            assert.deepStrictEqual(recorded.shown, [ids[1]]);
            yield* open.show(ids[0]);
            assert.deepStrictEqual(recorded.events, ["start b", "start a"]);
          })
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "opens the project open before the tabs as the one tab, the rest staying in the list",
    () =>
      withApp((recorded, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          // A list as the app wrote it before the tabs: no `open`, `shop` opened last.
          yield* fs.writeFileString(
            path.join(dir, PROJECTS_FILE),
            JSON.stringify({
              projects: [
                {
                  id: "p1",
                  kind: "local",
                  lastOpened: 10,
                  name: "old",
                  path: "/work/old",
                },
                {
                  id: "p2",
                  kind: "local",
                  lastOpened: 20,
                  name: "shop",
                  path: "/work/shop",
                },
              ],
              version: 1,
            })
          );
          const open = yield* OpenProjects;
          yield* open.start();
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          assert.deepStrictEqual(tabsTold(recorded), ["*shop opening"]);
          assert.deepStrictEqual(
            (yield* (yield* ProjectStore).list).map((p) => p.name),
            ["old", "shop"]
          );
        })
      )
  );

  it.effect("shows Home at the first start, with no tab", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const open = yield* OpenProjects;
        yield* open.start();
        assert.deepStrictEqual(recorded.shown, [null]);
        assert.deepStrictEqual(recorded.events, []);
        assert.isTrue(Option.isNone(yield* open.current));
      })
    )
  );

  it.effect(
    "opens a folder named on the command line in a tab beside the ones brought back",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* startedAgain(dir, () =>
          Effect.flatMap(OpenProjects, (open) =>
            Effect.andThen(
              open.openFolder("/work/a"),
              open.stop({ ask: false })
            )
          )
        );
        yield* startedAgain(dir, (recorded) =>
          Effect.gen(function* () {
            yield* (yield* OpenProjects).start("/work/b");
            assert.deepStrictEqual(recorded.events, ["start b"]);
            assert.deepStrictEqual(tabsTold(recorded), [
              "a idle",
              "*b opening",
            ]);
          })
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "a tab shows its name and icon as its page says, kept in the list",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/shop");
          yield* open.open(shop.id);
          const icon = { color: "blue", kind: "icon", name: "boxes" } as const;
          yield* open.describe(shop.id, { icon, name: "shop-admin" });
          const told = recorded.tabs.at(-1)?.[0];
          assert.strictEqual(told?.name, "shop-admin");
          assert.deepStrictEqual(told?.icon, icon);
          assert.strictEqual(told?.server, "http://127.0.0.1/shop");
          const kept = yield* store.get(shop.id);
          assert.strictEqual(kept.name, "shop-admin");
          assert.deepStrictEqual(kept.icon, icon);
        })
      )
  );

  it.effect("a tab spins while an agent works there, as its server says", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProjects;
        const shop = yield* store.add("/work/shop");
        yield* open.open(shop.id);
        yield* open.openingDone(shop.id, {});
        assert.deepStrictEqual(tabsTold(recorded), ["*shop idle"]);
        recorded.working.shop = 1;
        yield* TestClock.adjust("2 seconds");
        assert.deepStrictEqual(tabsTold(recorded), ["*shop working"]);
        recorded.working.shop = 0;
        yield* TestClock.adjust("2 seconds");
        assert.deepStrictEqual(tabsTold(recorded), ["*shop idle"]);
      })
    )
  );

  it.effect(
    "an agent's change starts every running server again, asking once naming those at work",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          const attached = yield* store.add("/work/attached");
          yield* open.open(a.id);
          yield* open.open(b.id);
          yield* open.open(attached.id);
          recorded.working.a = 1;
          recorded.working.b = 1;
          recorded.answers.push(false);
          yield* open.restart;
          assert.deepStrictEqual(recorded.questions, ["Apply the change?"]);
          assert.deepStrictEqual(recorded.details, [
            "Agents are working in a and b. Applying the change starts their servers again, which stops them. What they wrote so far stays.",
          ]);
          assert.strictEqual(recorded.events.length, 3);
          const loaded = recorded.views.length;
          yield* open.restart;
          assert.deepStrictEqual(recorded.events.slice(3).sort(), [
            "start a",
            "start b",
            "stop a",
            "stop b",
          ]);
          // Each editor back where it was.
          assert.deepStrictEqual(
            recorded.views
              .slice(loaded)
              .map((v) => v._tag === "Editor" && v.keepLocation),
            [true, true]
          );
        })
      )
  );

  it.effect(
    "moving the person's folder stops this machine's servers while it copies, then starts them again",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          yield* open.open((yield* store.add("/work/a")).id);
          yield* open.addRemote({ host: "devbox", path: "~/site" });
          yield* open.open((yield* store.add("/work/b")).id);
          const moved = yield* open.whileStopped(
            Effect.sync(() => {
              recorded.events.push("copy");
              return "moved";
            })
          );
          assert.deepStrictEqual(moved, Option.some("moved"));
          const after = recorded.events.slice(3);
          assert.strictEqual(after.indexOf("copy"), 2);
          assert.deepStrictEqual(after.slice(0, 2).sort(), [
            "stop a",
            "stop b",
          ]);
          assert.deepStrictEqual(after.slice(3).sort(), ["start a", "start b"]);
        })
      )
  );

  it.effect(
    "a project over SSH sits in a tab beside a local one, each with its own server",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const here = yield* store.add("/work/here");
          yield* open.open(here.id);
          const { project: site } = yield* open.addRemote({
            host: "devbox",
            path: "~/site",
          });
          assert.deepStrictEqual(recorded.events, [
            "start here",
            "start devbox:site",
          ]);
          assert.isTrue(yield* open.isRemote(site.id));
          assert.isFalse(yield* open.isRemote(here.id));
          yield* open.close(site.id);
          assert.deepStrictEqual(recorded.events.at(-1), "stop devbox:site");
        })
      )
  );

  it.effect(
    "says why a project could not be opened on its splash, and Cancel closes its tab",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const broken = yield* store.add("/work/broken");
          yield* open.open(a.id);
          const error = yield* Effect.flip(open.open(broken.id));
          assert.strictEqual(error._tag, "ServerStartError");
          assert.deepStrictEqual(recorded.views.at(-1), { _tag: "Opening" });
          const told = recorded.openings.at(-1);
          assert.deepStrictEqual(told?.problem, { reason: "it broke." });
          assert.deepStrictEqual(tabsTold(recorded), [
            "a opening",
            "*broken idle",
          ]);
          // Shown again, it stays on its splash: it does not start by itself.
          yield* open.show(a.id);
          yield* open.show(broken.id);
          assert.deepStrictEqual(recorded.events, ["start a"]);
          yield* open.stopOpening(broken.id);
          assert.deepStrictEqual(tabsTold(recorded), ["*a opening"]);
          assert.strictEqual(recorded.shown.at(-1), a.id);
        })
      )
  );

  it.effect("Try again runs the open that failed again", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProjects;
        const broken = yield* store.add("/work/broken");
        yield* Effect.ignore(open.open(broken.id));
        const failedAt = recorded.openings.length;
        yield* open.retryOpening(broken.id);
        // Begun again from its first step, and failed there again: still on the splash.
        const again = recorded.openings.slice(failedAt);
        assert.strictEqual(again[0]?.problem, undefined);
        assert.strictEqual(again[0]?.steps[0]?.state, "now");
        assert.isDefined(again.at(-1)?.problem);
      })
    )
  );

  it.effect(
    "Cancel while a project's machine does not answer gives it up and closes its tab",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const off = yield* store.addRemote({ host: "silent", path: "/srv" });
          const opening = yield* Effect.forkChild(open.open(off.id), {
            startImmediately: true,
          });
          yield* connected(recorded);
          // The page already says what it is waiting for.
          assert.deepStrictEqual(recorded.views, [{ _tag: "Opening" }]);
          assert.strictEqual(recorded.openings.at(-1)?.where, "silent:/srv");
          yield* open.stopOpening(off.id);
          yield* Fiber.join(opening);
          assert.deepStrictEqual(recorded.events, [
            "connect silent:srv",
            "give up silent:srv",
          ]);
          assert.deepStrictEqual(recorded.tabs.at(-1), []);
          assert.isNull(recorded.shown.at(-1));
        })
      )
  );

  it.effect(
    "keeps each step's time for the next opening's estimate, the editor's with the shell's",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/slow");
          const opening = yield* Effect.forkChild(open.open(shop.id), {
            startImmediately: true,
          });
          // The server takes 1.2 s to say where it listens.
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          assert.isUndefined(recorded.openings.at(-1)?.estimate);
          yield* open.openingDone(shop.id, { canvas: 300, project: 200 });
          assert.isNull(recorded.openings.at(-1));
          const kept = yield* store.get(shop.id);
          assert.deepStrictEqual(kept.lastOpening, {
            canvas: 300,
            project: 200,
            server: 1200,
          });
          // Opened again, it has an estimate: their sum.
          yield* open.close(shop.id);
          yield* Effect.forkChild(open.open(shop.id), {
            startImmediately: true,
          });
          // Waiting on its server again, the tabs written: nothing is left in flight.
          yield* until(
            recorded,
            ({ events }) => events.filter((e) => e === "wait slow").length === 2
          );
          assert.strictEqual(recorded.openings.at(-1)?.estimate, 1700);
        })
      )
  );

  it.effect("shows the last line the server printed as it starts", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProjects;
        const shop = yield* store.add("/work/chatty");
        yield* open.open(shop.id);
        assert.deepStrictEqual(recorded.openings.at(-1)?.log, [
          "pnpm install · 214 packages",
        ]);
      })
    )
  );

  it.effect(
    "gives the start screen's prompt to the editor of the project it opened, once",
    () =>
      withApp(() =>
        Effect.gen(function* () {
          const open = yield* OpenProjects;
          const start = { look: "agent", prompt: "A shop" } as const;
          const { project } = yield* open.openFolder(
            "/work/shop",
            "Shop",
            start
          );
          const other = yield* open.openFolder("/work/other");
          assert.isNull(yield* open.takeFirstPrompt(other.project.id));
          assert.deepStrictEqual(
            yield* open.takeFirstPrompt(project.id),
            start
          );
          assert.isNull(yield* open.takeFirstPrompt(project.id));
        })
      )
  );

  it.effect("keeps an open project on the list when asked to remove it", () =>
    withApp(() =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProjects;
        const shop = yield* store.add("/work/shop");
        yield* open.open(shop.id);
        const refused = yield* Effect.flip(open.remove(shop.id));
        assert.strictEqual(refused._tag, "ProjectOpen");
        yield* open.close(shop.id);
        yield* open.remove(shop.id);
        assert.deepStrictEqual(yield* store.list, []);
      })
    )
  );

  it.effect(
    "removes a project from the list with the session kept for it, a remote one too, and leaves its folder",
    () =>
      withApp((_recorded, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const folder = path.join(dir, "work", "shop");
          yield* fs.makeDirectory(folder, { recursive: true });
          yield* fs.writeFileString(path.join(folder, "page.tsx"), "");
          const shop = yield* store.add(folder);
          const site = yield* store.addRemote({
            host: "devbox",
            path: "~/site",
          });
          const kept = yield* store.add("/work/kept");
          const sessionOf = (id: string) => path.join(dir, "sessions", id);
          for (const { id } of [shop, site, kept]) {
            yield* fs.makeDirectory(sessionOf(id), { recursive: true });
            yield* fs.writeFileString(
              path.join(sessionOf(id), "state.json"),
              "{}"
            );
          }
          yield* open.remove(shop.id);
          yield* open.remove(site.id);
          // Removed already, or never there: nothing to do.
          yield* open.remove(shop.id);
          assert.deepStrictEqual(
            (yield* store.list).map((p) => p.id),
            [kept.id]
          );
          assert.deepStrictEqual(
            yield* fs.readDirectory(path.join(dir, "sessions")),
            [kept.id]
          );
          assert.deepStrictEqual(yield* fs.readDirectory(folder), ["page.tsx"]);
        })
      )
  );

  it.effect(
    "says a project holds unsaved work while its session holds something and its folder has no configuration, and never for a remote one",
    () =>
      withApp((_recorded, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const folder = path.join(dir, "work", "shop");
          yield* fs.makeDirectory(folder, { recursive: true });
          const shop = yield* store.add(folder);
          const site = yield* store.addRemote({
            host: "devbox",
            path: "~/site",
          });
          const sessionOf = (id: string) => path.join(dir, "sessions", id);
          assert.isFalse(yield* open.unsaved(shop));
          yield* fs.makeDirectory(sessionOf(shop.id), { recursive: true });
          assert.isFalse(yield* open.unsaved(shop));
          yield* fs.writeFileString(
            path.join(sessionOf(shop.id), "session.json"),
            "{}"
          );
          assert.isTrue(yield* open.unsaved(shop));
          yield* fs.makeDirectory(sessionOf(site.id), { recursive: true });
          yield* fs.writeFileString(
            path.join(sessionOf(site.id), "session.json"),
            "{}"
          );
          assert.isFalse(yield* open.unsaved(site));
          yield* fs.writeFileString(
            path.join(folder, "ultrapaint.config.json"),
            "{}"
          );
          assert.isFalse(yield* open.unsaved(shop));
        })
      )
  );
});
