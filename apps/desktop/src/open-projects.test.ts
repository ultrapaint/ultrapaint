import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
} from "effect";
import { TestClock } from "effect/testing";
import { Agents, makeRuntime } from "./agents.ts";
import { APP_EDITOR_URL, type AppEditor } from "./app-editor.ts";
import { Folders } from "./folders.ts";
import { LoginShell } from "./login-shell.ts";
import { MAX_VIEWS, OpenProjects } from "./open-projects.ts";
import { PROJECTS_FILE, ProjectStore } from "./projects.ts";
import {
  exitProcess,
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

/** Whether the strip was told a tab is the one shown. */
const shownIn = (told: Recorded["tabs"], id: string) =>
  (told.at(-1) ?? []).some((t) => t.id === id && t.shown);

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
    "switching tabs stops nothing and loads nothing for a project view kept",
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
    "lets the project view seen least recently go past five, its server running, and loads it again when shown",
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
          assert.strictEqual(MAX_VIEWS, 5);
          // p1 was seen least recently: its view goes, not its server.
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
            // Both gone, in either order: the start given up, the server stopped.
            assert.deepStrictEqual(recorded.events.slice(0, 2), [
              "start here",
              "connect silent:srv",
            ]);
            assert.sameMembers(recorded.events.slice(2), [
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
    "a tab shows its name and icon as its project view says, kept in the list",
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
          // The view already says what it is waiting for.
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
  it.effect(
    "adds a picked folder and opens it in a tab; a cancelled picker adds nothing",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          assert.isTrue(Option.isNone(yield* open.add));
          assert.deepStrictEqual(yield* store.list, []);
          recorded.picks.push("/work/shop");
          const added = yield* open.add;
          assert.strictEqual(Option.getOrThrow(added).name, "shop");
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          assert.deepStrictEqual(tabsTold(recorded), ["*shop opening"]);
        })
      )
  );

  it.effect("Try again does nothing when no open failed", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const open = yield* OpenProjects;
        const shop = yield* store.add("/work/shop");
        yield* open.retryOpening(shop.id);
        yield* open.open(shop.id);
        const told = recorded.openings.length;
        yield* open.retryOpening(shop.id);
        assert.strictEqual(recorded.openings.length, told);
        assert.deepStrictEqual(recorded.events, ["start shop"]);
      })
    )
  );

  it.effect("says why a remote project could not be opened", () =>
    withApp((recorded) =>
      Effect.gen(function* () {
        const open = yield* OpenProjects;
        const failed = yield* Effect.flip(
          open.addRemote({ host: "down", path: "/srv" })
        );
        assert.strictEqual(failed._tag, "ServerStartError");
        assert.deepStrictEqual(recorded.views, [{ _tag: "Opening" }]);
        assert.deepStrictEqual(recorded.openings.at(-1)?.problem, {
          reason: "down could not be reached.",
        });
      })
    )
  );

  it.effect(
    "keeps the one opening on the list too when asked to remove it",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const open = yield* OpenProjects;
          const opening = yield* Effect.forkChild(
            open.addRemote({ host: "silent", path: "/srv" }),
            { startImmediately: true }
          );
          yield* connected(recorded);
          const off = Option.getOrThrow(yield* open.current);
          const refused = yield* Effect.flip(open.remove(off.id));
          assert.strictEqual(refused._tag, "ProjectOpen");
          yield* open.stopOpening(off.id);
          yield* Fiber.join(opening);
          yield* open.remove(off.id);
          assert.deepStrictEqual(yield* (yield* ProjectStore).list, []);
        })
      )
  );

  for (const [what, ask] of [
    [
      "a close's",
      (open: OpenProjects["Service"], id: string) =>
        Effect.map(open.close(id), (closed) => !closed),
    ],
    [
      "a restart's",
      (open: OpenProjects["Service"]) => Effect.as(open.restart, true),
    ],
  ] as const) {
    it.effect(
      `a signal cuts ${what} question short: answered no, and every server stops`,
      () =>
        withApp((recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const busy = yield* store.add("/work/busy");
            yield* open.open(busy.id);
            recorded.working.busy = 1;
            recorded.answers.push(Effect.never);
            const asking = yield* Effect.forkChild(ask(open, busy.id), {
              startImmediately: true,
            });
            yield* asked(recorded);
            assert.isTrue(yield* open.stop({ ask: false }));
            assert.isTrue(yield* Fiber.join(asking));
            assert.deepStrictEqual(recorded.events, [
              "start busy",
              "stop busy",
            ]);
          })
        )
    );
  }

  it.effect("shows a restored tab twice at once and starts one server", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const slow = yield* startedAgain(dir, () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const slowProject = yield* store.add("/work/slow");
          yield* open.open(a.id);
          yield* store.setTabs({ open: [a.id, slowProject.id], shown: a.id });
          yield* open.stop({ ask: false });
          return slowProject.id;
        })
      );
      yield* startedAgain(dir, (recorded) =>
        Effect.gen(function* () {
          const open = yield* OpenProjects;
          yield* open.start();
          const first = yield* Effect.forkChild(open.show(slow), {
            startImmediately: true,
          });
          const second = yield* Effect.forkChild(open.showAt(2), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(first);
          yield* Fiber.join(second);
          assert.deepStrictEqual(recorded.events, [
            "start a",
            "wait slow",
            "start slow",
          ]);
        })
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "a tab shown while the person's folder moves starts once the servers are back, and only once",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          yield* open.open(a.id);
          yield* open.openingDone(a.id, {});
          yield* open.open(b.id);
          yield* open.openingDone(b.id, {});
          let showing: Fiber.Fiber<void> | undefined;
          yield* open.whileStopped(
            Effect.gen(function* () {
              recorded.events.push("copy");
              // a is shown mid-move: its server is stopped, and a show would start it.
              showing = yield* Effect.forkDetach(open.show(a.id), {
                startImmediately: true,
              });
              const begun = recorded.openings.length;
              yield* until(recorded, ({ tabs }) => shownIn(tabs, a.id));
              // The strip is told the tab shown just before its start is asked for: none began.
              assert.strictEqual(recorded.openings.length, begun);
              recorded.events.push("copied");
            })
          );
          if (showing) {
            yield* Fiber.join(showing);
          }
          const during = recorded.events.slice(
            recorded.events.indexOf("copy"),
            recorded.events.indexOf("copied")
          );
          assert.isFalse(during.some((e) => e.startsWith("start")));
          const after = recorded.events.slice(
            recorded.events.indexOf("copied") + 1
          );
          // Each started again once, nothing started twice and stopped.
          assert.deepStrictEqual([...after].sort(), ["start a", "start b"]);
        })
      )
  );

  it.effect(
    "a restart waits for a project still starting, then starts it again too; a show meanwhile starts nothing more",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const slow = yield* store.add("/work/slow");
          const opening = yield* Effect.forkChild(open.open(slow.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          const restarting = yield* Effect.forkChild(open.restart, {
            startImmediately: true,
          });
          const showing = yield* Effect.forkChild(open.show(slow.id), {
            startImmediately: true,
          });
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          // Started on the old setup: started again.
          yield* until(
            recorded,
            ({ events }) => events.filter((e) => e === "wait slow").length === 2
          );
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(restarting);
          yield* Fiber.join(showing);
          assert.deepStrictEqual(recorded.events, [
            "wait slow",
            "start slow",
            "stop slow",
            "wait slow",
            "start slow",
          ]);
        })
      )
  );
  it.effect(
    "a show overtaken while it looks for the editor's version shows nothing late",
    () =>
      withApp(
        (recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const lag = yield* store.add("/work/lagging");
            const versions = () =>
              recorded.events.filter((e) => e === "version lagging").length;
            const opening = yield* Effect.forkChild(open.open(lag.id), {
              startImmediately: true,
            });
            yield* until(recorded, () => versions() === 1);
            yield* TestClock.adjust("1 second");
            yield* Fiber.join(opening);
            for (const name of ["p1", "p2", "p3", "p4", "p5"]) {
              yield* open.open((yield* store.add(`/work/${name}`)).id);
            }
            assert.include(recorded.drops, lag.id);
            const loaded = recorded.views.length;
            const showing = yield* Effect.forkChild(open.show(lag.id), {
              startImmediately: true,
            });
            // Home chosen while the editor's version is asked.
            yield* until(recorded, () => versions() === 2);
            yield* open.show(null);
            yield* TestClock.adjust("1 second");
            yield* Fiber.join(showing);
            assert.isNull(recorded.shown.at(-1));
            assert.strictEqual(recorded.views.length, loaded);
            assert.isFalse((recorded.tabs.at(-1) ?? []).some((t) => t.shown));
          }),
        // The app's own editor: the version decides it, asked each time.
        { url: APP_EDITOR_URL, version: FAKE_VERSION }
      )
  );

  it.effect(
    "a project over SSH added again with another command starts with it on Try again",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const open = yield* OpenProjects;
          const site = { host: "devbox", path: "~/site" };
          const failed = yield* Effect.flip(
            open.addRemote({ ...site, command: "broken" })
          );
          assert.strictEqual(failed._tag, "ServerStartError");
          const { project } = yield* open.addRemote({
            ...site,
            command: "ultrapaint",
          });
          yield* open.retryOpening(project.id);
          assert.deepStrictEqual(recorded.events, ["start devbox:site"]);
        })
      )
  );

  it.effect(
    "a project opened again while its close lets its server go starts once that one stopped",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const lingering = yield* store.add("/work/lingering");
          yield* open.open(lingering.id);
          yield* open.openingDone(lingering.id, {});
          const closing = yield* Effect.forkChild(open.close(lingering.id), {
            startImmediately: true,
          });
          const reopening = yield* Effect.forkChild(open.open(lingering.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) =>
            events.includes("stopping lingering")
          );
          yield* TestClock.adjust("1 second");
          yield* Fiber.join(closing);

          yield* Fiber.join(reopening);
          assert.deepStrictEqual(recorded.events, [
            "start lingering",
            "stopping lingering",
            "stop lingering",
            "start lingering",
          ]);
          assert.deepStrictEqual(tabsTold(recorded), ["*lingering opening"]);
          // Closed again before the test ends, its stop's second on the test clock.
          const last = yield* Effect.forkChild(open.close(lingering.id), {
            startImmediately: true,
          });
          yield* until(
            recorded,
            ({ events }) =>
              events.filter((e) => e === "stopping lingering").length === 2
          );
          yield* TestClock.adjust("1 second");
          yield* Fiber.join(last);
        })
      )
  );

  it.effect(
    "a project opened while it is taken off the list is either open and kept, or gone",
    () =>
      withApp((recorded, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          for (const name of ["a", "b", "c", "d"]) {
            const project = yield* store.add(`/work/${name}`);
            const session = path.join(dir, "sessions", project.id);
            yield* fs.makeDirectory(session, { recursive: true });
            yield* fs.writeFileString(path.join(session, "state.json"), "{}");
            const removing = yield* Effect.forkChild(
              Effect.exit(open.remove(project.id)),
              { startImmediately: true }
            );
            const opening = yield* Effect.forkChild(
              Effect.exit(open.open(project.id)),
              { startImmediately: true }
            );
            const removed = yield* Fiber.join(removing);
            const opened = yield* Fiber.join(opening);
            // One won: removed, and the open found it gone; or opened, and the removal refused.
            const failure = (
              exit: Exit.Exit<unknown, { readonly _tag: string }>
            ) =>
              Exit.isFailure(exit)
                ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag
                : "done";
            assert.include(
              [
                ["done", "UnknownProject"],
                ["ProjectOpen", "done"],
              ].map((pair) => pair.join(" ")),
              `${failure(removed)} ${failure(opened)}`,
              name
            );
            const listed = (yield* store.list).some((p) => p.id === project.id);
            const tabbed = (recorded.tabs.at(-1) ?? []).some(
              (t) => t.id === project.id
            );
            assert.strictEqual(tabbed, listed, name);
            assert.strictEqual(yield* fs.exists(session), listed, name);
          }
        })
      )
  );

  it.effect(
    "a closing project over SSH counts as remote until its view is let go",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const open = yield* OpenProjects;
          const { project: site } = yield* open.addRemote({
            host: "devbox",
            path: "~/site",
          });
          let asDropped: boolean | null = null;
          recorded.beforeDrop = Effect.map(open.isRemote(site.id), (remote) => {
            asDropped = remote;
          });
          yield* open.close(site.id);
          assert.isTrue(asDropped);
          assert.isFalse(yield* open.isRemote(site.id));
        })
      )
  );

  it.effect(
    "a restart asks about a project still starting once it is up, an agent at work there",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const slow = yield* store.add("/work/slow");
          recorded.working.slow = 1;
          recorded.answers.push(false);
          const opening = yield* Effect.forkChild(open.open(slow.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          const restarting = yield* Effect.forkChild(open.restart, {
            startImmediately: true,
          });
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          yield* Fiber.join(restarting);
          assert.deepStrictEqual(recorded.questions, ["Apply the change?"]);
          assert.deepStrictEqual(recorded.events, ["wait slow", "start slow"]);
        })
      )
  );

  it.effect(
    "a tab never started, shown while the person's folder moves, starts once it has moved",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const idle = yield* startedAgain(dir, () =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const b = yield* store.add("/work/b");
            yield* store.setTabs({ open: [b.id], shown: null });
            return b.id;
          })
        );
        yield* startedAgain(dir, (recorded) =>
          Effect.gen(function* () {
            const open = yield* OpenProjects;
            yield* open.start();
            let showing: Fiber.Fiber<void> | undefined;
            yield* open.whileStopped(
              Effect.gen(function* () {
                recorded.events.push("copy");
                showing = yield* Effect.forkDetach(open.show(idle), {
                  startImmediately: true,
                });
                const begun = recorded.openings.length;
                yield* until(recorded, ({ tabs }) => shownIn(tabs, idle));
                // Told the strip just before its start is asked for: none began.
                assert.strictEqual(recorded.openings.length, begun);
                recorded.events.push("copied");
              })
            );
            if (showing) {
              yield* Fiber.join(showing);
            }
            assert.deepStrictEqual(recorded.events, [
              "copy",
              "copied",
              "start b",
            ]);
          })
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "refuses to move the person's folder when a project still starting attached to a server started outside the app",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const theirs = yield* store.add("/work/slow-attached");
          const opening = yield* Effect.forkChild(open.open(theirs.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          const moving = yield* Effect.forkChild(
            Effect.flip(
              open.whileStopped(Effect.sync(() => recorded.events.push("copy")))
            ),
            { startImmediately: true }
          );
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          const refused = yield* Fiber.join(moving);
          assert.strictEqual(refused._tag, "ServerNotOurs");
          assert.notInclude(recorded.events, "copy");
        })
      )
  );

  it.effect(
    "a folder opened while the tabs come back at start opens beside them",
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
            const open = yield* OpenProjects;
            const starting = yield* Effect.forkChild(open.start(), {
              startImmediately: true,
            });
            const second = yield* Effect.forkChild(open.openFolder("/work/b"), {
              startImmediately: true,
            });
            yield* Fiber.join(starting);
            yield* Fiber.join(second);
            assert.deepStrictEqual(
              (recorded.tabs.at(-1) ?? []).map((t) => t.name),
              ["a", "b"]
            );
          })
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "an editor that does not load says why on its splash, and Try again loads it again",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/shop");
          yield* open.open(shop.id);
          yield* open.openingDone(shop.id, {});
          yield* open.loadFailed(shop.id, "connection refused");
          assert.include(
            recorded.openings.at(-1)?.problem?.reason ?? "",
            "connection refused"
          );
          assert.deepStrictEqual(recorded.views.at(-1), { _tag: "Opening" });
          yield* open.retryOpening(shop.id);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          assert.isUndefined(recorded.openings.at(-1)?.problem);
          assert.deepStrictEqual(recorded.events, ["start shop"]);
        })
      )
  );

  it.effect(
    "an editor that did not load still shows its splash when its view comes back, until Try again",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/shop");
          yield* open.open(shop.id);
          yield* open.openingDone(shop.id, {});
          yield* open.loadFailed(shop.id, "connection refused");
          for (const name of ["p1", "p2", "p3", "p4", "p5"]) {
            yield* open.open((yield* store.add(`/work/${name}`)).id);
          }
          assert.include(recorded.drops, shop.id);
          yield* open.show(shop.id);
          assert.strictEqual(recorded.viewsIn.at(-1), shop.id);
          assert.deepStrictEqual(recorded.views.at(-1), { _tag: "Opening" });
        })
      )
  );

  it.effect(
    "Try again starts a server again that stopped answering once it was ready",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/shop");
          yield* open.open(shop.id);
          yield* open.openingDone(shop.id, {});
          yield* open.loadFailed(shop.id, "connection refused");
          // The process that started exits; the one a start makes later does not.
          exitProcess(recorded, "shop");
          yield* open.retryOpening(shop.id);
          assert.deepStrictEqual(recorded.events, [
            "start shop",
            "stop shop",
            "start shop",
          ]);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          // The new process runs: its editor failing again is loaded again, nothing started.
          yield* open.openingDone(shop.id, {});
          yield* open.loadFailed(shop.id, "connection refused");
          yield* open.retryOpening(shop.id);
          assert.strictEqual(recorded.events.length, 3);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
        })
      )
  );

  it.effect(
    "a show that looked for the editor of a server started again meanwhile asks the one it has now",
    () =>
      withApp(
        (recorded) =>
          Effect.gen(function* () {
            const store = yield* ProjectStore;
            const open = yield* OpenProjects;
            const versions = () =>
              recorded.events.filter((e) => e === "version lagging").length;
            const lag = yield* store.add("/work/lagging");
            const opening = yield* Effect.forkChild(open.open(lag.id), {
              startImmediately: true,
            });
            yield* until(recorded, () => versions() === 1);
            yield* TestClock.adjust("1 second");
            yield* Fiber.join(opening);
            yield* open.openingDone(lag.id, {});
            for (const name of ["p1", "p2", "p3", "p4", "p5"]) {
              yield* open.open((yield* store.add(`/work/${name}`)).id);
            }
            const showing = yield* Effect.forkChild(open.show(lag.id), {
              startImmediately: true,
            });
            yield* until(recorded, () => versions() === 2);
            // Started again while that version is asked: its view is not loaded, so only the
            // show loads it.
            yield* open.restart;
            yield* TestClock.adjust("1 second");
            yield* until(recorded, () => versions() === 3);
            yield* TestClock.adjust("1 second");
            yield* Fiber.join(showing);
            // Asked a third time, of the server it has now, and loaded.
            assert.strictEqual(versions(), 3);
            assert.strictEqual(recorded.viewsIn.at(-1), lag.id);
            assert.strictEqual(recorded.shown.at(-1), lag.id);
          }),
        { url: APP_EDITOR_URL, version: FAKE_VERSION }
      )
  );

  it.effect(
    "a folder move stops a server whose tab is closing before it copies",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const a = yield* store.add("/work/a");
          yield* open.open(a.id);
          yield* open.openingDone(a.id, {});
          const closing = yield* Effect.forkChild(open.close(a.id), {
            startImmediately: true,
          });
          const moving = yield* Effect.forkChild(
            open.whileStopped(Effect.sync(() => recorded.events.push("copy"))),
            { startImmediately: true }
          );
          yield* Fiber.join(closing);
          yield* Fiber.join(moving);
          assert.deepStrictEqual(recorded.events, [
            "start a",
            "stop a",
            "copy",
          ]);
        })
      )
  );

  it.effect(
    "Try again keeps a server whose health check is slow or says no version, and loads its editor again",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const shop = yield* store.add("/work/shop");
          yield* open.open(shop.id);
          yield* open.openingDone(shop.id, {});
          recorded.working.shop = 1;
          yield* open.loadFailed(shop.id, "connection refused");
          // Its health says nothing: no sign its process is gone, and an agent works there.
          recorded.quiet.push("shop");
          yield* open.retryOpening(shop.id);
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          assert.deepStrictEqual(recorded.questions, []);
        })
      )
  );

  it.effect(
    "a restart starts nothing for a tab closed while its server stopped",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const lingering = yield* store.add("/work/lingering");
          yield* open.open(lingering.id);
          yield* open.openingDone(lingering.id, {});
          const restarting = yield* Effect.forkChild(open.restart, {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) =>
            events.includes("stopping lingering")
          );
          // Closed while its server stops for the restart.
          const closing = yield* Effect.forkChild(open.close(lingering.id), {
            startImmediately: true,
          });
          yield* until(
            recorded,
            ({ tabs }) => (tabs.at(-1) ?? []).length === 0
          );
          yield* TestClock.adjust("1 second");
          yield* Fiber.join(restarting);
          yield* Fiber.join(closing);
          assert.deepStrictEqual(recorded.events, [
            "start lingering",
            "stopping lingering",
            "stop lingering",
          ]);
        })
      )
  );

  it.effect(
    "a quit asks again, naming it, about a project that became busy while the person answered",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const docs = yield* store.add("/work/docs");
          const slow = yield* store.add("/work/slow");
          yield* open.open(docs.id);
          recorded.working.docs = 1;
          const opening = yield* Effect.forkChild(open.open(slow.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          const answer = yield* Deferred.make<boolean>();
          recorded.answers.push(Deferred.await(answer));
          const quitting = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          yield* asked(recorded);
          // slow is up while the question is on screen, an agent at work there.
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          recorded.working.slow = 1;
          recorded.answers.push(false);
          yield* Deferred.succeed(answer, true);
          assert.isFalse(yield* Fiber.join(quitting));
          assert.deepStrictEqual(recorded.details, [
            "An agent is working in docs. Quitting stops it.",
            "Agents are working in docs and slow. Quitting stops them.",
          ]);
          assert.isFalse(recorded.events.some((e) => e.startsWith("stop")));
        })
      )
  );

  it.effect(
    "a quit asks about a project that started and became busy while a health check was slow",
    () =>
      withApp((recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const open = yield* OpenProjects;
          const quiet = yield* store.add("/work/lazyhealth");
          const slow = yield* store.add("/work/slow");
          yield* open.open(quiet.id);
          const opening = yield* Effect.forkChild(open.open(slow.id), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) => events.includes("wait slow"));
          recorded.working.slow = 1;
          recorded.answers.push(false);
          // Its health slow to answer: slow starts, an agent at work there, meanwhile.
          const quitting = yield* Effect.forkChild(open.stop({ ask: true }), {
            startImmediately: true,
          });
          yield* until(recorded, ({ events }) =>
            events.includes("health lazyhealth")
          );
          // slow is up before that health answers.
          yield* TestClock.adjust("1200 millis");
          yield* Fiber.join(opening);
          // Each health answers in its time, as often as the quit looks: until it is answered.
          for (let step = 0; step < 20; step += 1) {
            if (quitting.pollUnsafe() !== undefined) {
              break;
            }
            yield* TestClock.adjust("2 seconds");
          }
          assert.isFalse(yield* Fiber.join(quitting));
          assert.deepStrictEqual(recorded.details, [
            "An agent is working in slow. Quitting stops it.",
          ]);
          assert.isFalse(recorded.events.some((e) => e.startsWith("stop")));
        })
      )
  );
});
