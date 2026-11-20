import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { AgentSettings } from "./agent-settings.ts";
import { Agents, makeRuntime } from "./agents.ts";
import { Caller } from "./caller.ts";
import { CommandLine } from "./command-line.ts";
import { Folders } from "./folders.ts";
import {
  bridgeHandlers,
  callerRemote,
  type HandlerServices,
} from "./handlers.ts";
import { LoginShell } from "./login-shell.ts";
import { NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProjects } from "./open-projects.ts";
import { ProjectStore } from "./projects.ts";
import {
  fakeRemoteProjects,
  fakeServers,
  fakeShell,
  makeRecorded,
  type Recorded,
} from "./testing.ts";
import { noUpdates } from "./updater.ts";

/** Agents as the test layer has them, whose downloads and keys are recorded in `asked`. */
const fakeAgents = (asked: string[]) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents;
      return Agents.of({
        ...agents,
        download: (id) =>
          Effect.sync(() => {
            asked.push(`download ${id}`);
            return `/agents/${id}`;
          }),
        setApiKey: (id, key) =>
          Effect.sync(() => asked.push(`key ${id} ${key ?? "forgotten"}`)),
      });
    })
  ).pipe(
    Layer.provide(
      Agents.layerTest(
        makeRuntime({ adaptersDir: "/app/adapters", node: "/app/electron" }, {})
      )
    )
  );

/** The handlers on the app's services, with fakes for Electron, the servers and the agents. */
const withHandlers = <A, E>(
  body: (
    handlers: ReturnType<typeof bridgeHandlers>,
    recorded: Recorded,
    asked: string[],
    /** The app's data directory. */
    dir: string
  ) => Effect.Effect<A, E, HandlerServices>,
  sshConfig = "/nowhere/config",
  home = "/home/u"
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const recorded = makeRecorded();
    const asked: string[] = [];
    const app = Layer.mergeAll(
      noUpdates,
      Layer.succeed(
        NewDesigns,
        NewDesigns.of({
          create: (request, report) =>
            Effect.as(report({ state: "active", step: "folder" }), {
              failed: { message: request.name, step: "install" },
            }),
          folderFor: (name) => Effect.succeed(`/home/u/Ultrapaint/${name}`),
        })
      ),
      Layer.succeed(
        Notices,
        Notices.of({
          list: Effect.succeed([
            { id: "node", section: "about", title: "No Node.js" },
          ]),
          node: Effect.succeed({ _tag: "Missing" }),
        })
      ),
      OpenProjects.layer(dir),
      // A page of no project (Home, the strip) unless a test calls from a project's.
      Caller.layer(null),
      CommandLine.layer({
        app: {
          _tag: "Bundle",
          executable: "/app/ultrapaint",
          serverBin: "/app/server/bin.mjs",
          webDist: "/app/web",
        },
        home: dir,
        platform: "linux",
      })
    ).pipe(
      Layer.provideMerge(ProjectStore.layer(dir)),
      Layer.provideMerge(
        Folders.layer({
          dataDir: dir,
          home,
          location: `${home}/.config/Ultrapaint/user-folder.json`,
        })
      ),
      Layer.provideMerge(AgentSettings.layer(dir)),
      Layer.provideMerge(LoginShell.layerTest({ PATH: "/usr/bin" })),
      Layer.provideMerge(fakeAgents(asked)),
      Layer.provideMerge(fakeServers(recorded)),
      Layer.provideMerge(fakeRemoteProjects(recorded)),
      Layer.provideMerge(fakeShell(recorded))
    );
    const handlers = bridgeHandlers({ home, sshConfig });
    return yield* body(handlers, recorded, asked, dir).pipe(
      Effect.provide(app)
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Whether the page of `id`'s project is shown none of this machine's capabilities. */
const remoteFor = (id: string) =>
  callerRemote.pipe(Effect.provide(Caller.layer(id)));

describe("the bridge's handlers", () => {
  it.effect("list the projects with where each is, and the one shown", () =>
    withHandlers((handlers, recorded) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const shop = yield* store.add("/work/shop");
        yield* store.addRemote({ host: "devbox", path: "~/site" });
        assert.isNull(yield* handlers["projects.current"]());
        yield* handlers["projects.open"](shop.id);
        assert.strictEqual(yield* handlers["projects.current"](), shop.id);
        const listed = yield* handlers["projects.list"]();
        assert.deepStrictEqual(
          listed.map((p) => [p.name, p.detail]),
          [
            ["shop", "/work/shop"],
            ["site", "devbox:~/site"],
          ]
        );
        assert.deepStrictEqual(recorded.events, ["start shop"]);
      })
    )
  );

  it.effect(
    "list a project as unsaved when the app keeps a session for it that holds something",
    () =>
      withHandlers((handlers, _recorded, _asked, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* ProjectStore;
          const blog = yield* store.add("/work/blog");
          yield* store.add("/work/shop");
          const session = path.join(dir, "sessions", blog.id);
          yield* fs.makeDirectory(session, { recursive: true });
          yield* fs.writeFileString(path.join(session, "session.json"), "{}");
          assert.deepStrictEqual(
            (yield* handlers["projects.list"]()).map((p) => [
              p.name,
              p.unsaved,
            ]),
            [
              ["blog", true],
              ["shop", false],
            ]
          );
        })
      )
  );

  it.effect(
    "give a remote project's wrong fields back as the problem, and open a right one",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const wrong = yield* handlers["projects.addRemote"]({
            host: "devbox",
            path: "site",
          });
          assert.include(wrong.problem ?? "", "is not a folder's full path");
          assert.deepStrictEqual(recorded.events, []);
          assert.deepStrictEqual(
            yield* handlers["projects.addRemote"]({
              host: "devbox",
              path: "~/site",
            }),
            {}
          );
          assert.deepStrictEqual(recorded.events, ["start devbox:site"]);
          const site = yield* handlers["projects.current"]();
          assert.isTrue(yield* remoteFor(site ?? ""));
          // One that cannot be reached is its splash's to say, not the dialog's.
          assert.deepStrictEqual(
            yield* handlers["projects.addRemote"]({
              host: "down",
              path: "/srv/site",
            }),
            {}
          );
        })
      )
  );

  it.effect(
    "remove a project from the list, and say why an open one stays",
    () =>
      withHandlers((handlers) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const shop = yield* store.add("/work/shop");
          const site = yield* store.addRemote({
            host: "devbox",
            path: "~/site",
          });
          yield* handlers["projects.open"](shop.id);
          yield* handlers["projects.remove"](site.id);
          assert.deepStrictEqual(
            (yield* handlers["projects.list"]()).map((p) => p.name),
            ["shop"]
          );
          const refused = yield* Effect.flip(
            handlers["projects.remove"](shop.id)
          );
          assert.strictEqual(
            refused.message,
            "shop is open. Close its tab, then remove it from the list."
          );
          assert.strictEqual(yield* handlers["projects.current"](), shop.id);
        })
      )
  );

  it.effect(
    "show a page this machine's capabilities unless its project is on another machine",
    () =>
      withHandlers((handlers) =>
        Effect.gen(function* () {
          // Home and the strip are this machine's.
          assert.isFalse(yield* callerRemote);
          const store = yield* ProjectStore;
          const shop = yield* store.add("/work/shop");
          yield* handlers["projects.open"](shop.id);
          yield* handlers["projects.addRemote"]({
            host: "devbox",
            path: "~/site",
          });
          const site = yield* handlers["projects.current"]();
          assert.isFalse(yield* remoteFor(shop.id));
          assert.isTrue(yield* remoteFor(site ?? ""));
        })
      )
  );

  it.effect(
    "answer a page's calls for its own project: its prompt, its open done, its close",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const start = { look: "agent", prompt: "A shop" } as const;
          yield* handlers["projects.openFolder"]("/work/shop", start);
          const shop = (yield* handlers["projects.current"]()) ?? "";
          yield* handlers["projects.openFolder"]("/work/blog");
          const blog = (yield* handlers["projects.current"]()) ?? "";
          const fromPage =
            (id: string) =>
            <A, E, R>(call: Effect.Effect<A, E, R>) =>
              call.pipe(Effect.provide(Caller.layer(id)));
          assert.isNull(
            yield* fromPage(blog)(handlers["projects.takeFirstPrompt"]())
          );
          assert.deepStrictEqual(
            yield* fromPage(shop)(handlers["projects.takeFirstPrompt"]()),
            start
          );
          // From Home, none.
          assert.isNull(yield* handlers["projects.takeFirstPrompt"]());
          yield* fromPage(shop)(handlers["projects.openingDone"]({}));
          assert.deepStrictEqual(
            (yield* handlers["projects.list"]()).map((p) => p.name),
            ["blog", "shop"]
          );
          yield* fromPage(shop)(
            handlers["projects.describe"]({ name: "Shop admin" })
          );
          yield* fromPage(shop)(handlers["projects.close"](undefined));
          assert.deepStrictEqual(
            recorded.events.filter((e) => e.startsWith("stop")),
            ["stop shop"]
          );
          assert.deepStrictEqual(
            (yield* handlers["projects.list"]()).map((p) => p.name),
            ["blog", "Shop admin"]
          );
          yield* handlers["projects.close"](blog);
          assert.isNull(yield* handlers["projects.current"]());
        })
      )
  );

  it.effect(
    "keep the agent's executable picked and start the server again; cancelled, change nothing",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const settings = yield* AgentSettings;
          yield* handlers["projects.open"]((yield* store.add("/work/shop")).id);
          yield* handlers["agents.choosePath"]("claude-code");
          assert.deepStrictEqual(recorded.pickers, ["Where is Claude Code?"]);
          assert.deepStrictEqual(yield* settings.get("claude-code"), {});
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          recorded.picks.push("/opt/claude");
          yield* handlers["agents.choosePath"]("claude-code");
          assert.strictEqual(
            (yield* settings.get("claude-code")).path,
            "/opt/claude"
          );
          assert.deepStrictEqual(recorded.events, [
            "start shop",
            "stop shop",
            "start shop",
          ]);
          yield* handlers["agents.clearPath"]("claude-code");
          assert.isUndefined((yield* settings.get("claude-code")).path);
          assert.strictEqual(recorded.events.length, 5);
        })
      )
  );

  it.effect(
    "forget a blank key, and download before the server starts again",
    () =>
      withHandlers((handlers, _recorded, asked) =>
        Effect.gen(function* () {
          yield* handlers["agents.setApiKey"]("claude-code", "  ");
          yield* handlers["agents.setApiKey"]("claude-code", "sk-1");
          yield* handlers["agents.setApiKey"]("claude-code", null);
          yield* handlers["agents.download"]("codex");
          assert.deepStrictEqual(asked, [
            "key claude-code forgotten",
            "key claude-code sk-1",
            "key claude-code forgotten",
            "download codex",
          ]);
        })
      )
  );

  it.effect("pick a folder, titled when the page gives none", () =>
    withHandlers((handlers, recorded) =>
      Effect.gen(function* () {
        assert.isNull(yield* handlers.pickFolder(undefined));
        recorded.picks.push("/work/new");
        assert.strictEqual(
          yield* handlers.pickFolder({ title: "Where does it go?" }),
          "/work/new"
        );
        assert.deepStrictEqual(recorded.pickers, [
          "Choose a folder",
          "Where does it go?",
        ]);
      })
    )
  );

  it.effect("write a new design with its steps, and pass the rest on", () =>
    withHandlers((handlers) =>
      Effect.gen(function* () {
        const steps: unknown[] = [];
        const outcome = yield* handlers["newDesign.create"](
          {
            code: "app",
            folder: "/f",
            git: false,
            name: "Shop",
            template: "blank",
          },
          (step) => Effect.sync(() => steps.push(step))
        );
        assert.deepStrictEqual(outcome, {
          failed: { message: "Shop", step: "install" },
        });
        assert.deepStrictEqual(steps, [{ state: "active", step: "folder" }]);
        assert.strictEqual(
          yield* handlers["newDesign.folderFor"]("Shop"),
          "/home/u/Ultrapaint/Shop"
        );
        assert.deepStrictEqual(
          (yield* handlers.notices()).map((n) => n.id),
          ["node"]
        );
        assert.deepStrictEqual(yield* handlers["node.status"](), {
          _tag: "Missing",
        });
      })
    )
  );

  it.effect("suggest the SSH configuration's hosts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const config = path.join(dir, "config");
      yield* fs.writeFileString(config, "Host devbox\nHost *.internal\n");
      yield* withHandlers(
        (handlers) =>
          Effect.map(handlers["projects.sshHosts"](), (hosts) =>
            assert.deepStrictEqual(hosts, ["devbox"])
          ),
        config
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "say what a folder holds: a project, nothing but what a system leaves, or anything else",
    () =>
      withHandlers((handlers) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped();
          const at = (name: string, files: readonly string[]) =>
            Effect.gen(function* () {
              const dir = path.join(root, name);
              yield* fs.makeDirectory(dir);
              for (const file of files) {
                yield* fs.writeFileString(path.join(dir, file), "");
              }
              return dir;
            });
          const kinds = [
            yield* handlers["projects.inspect"](
              yield* at("shop", ["ultrapaint.config.json", "package.json"])
            ),
            yield* handlers["projects.inspect"](
              yield* at("blank", [".DS_Store"])
            ),
            yield* handlers["projects.inspect"](
              yield* at("app", ["package.json"])
            ),
          ];
          assert.deepStrictEqual(kinds, [
            { kind: "project", name: "shop" },
            { kind: "empty", name: "blank" },
            { kind: "folder", name: "app" },
          ]);
        }).pipe(Effect.scoped)
      )
  );

  it.effect(
    "read what the chat remembers from the user's directory, nothing when no chat has run",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const remembered = {
          agents: [{ agentId: "codex", configOptions: [] }],
          defaults: { agentId: "codex" },
        };
        yield* withHandlers(
          (handlers) =>
            Effect.gen(function* () {
              assert.deepStrictEqual(yield* handlers["agents.preferences"](), {
                agents: [],
                defaults: {},
              });
              const dir = path.join(home, ".ultrapaint", "chat");
              yield* fs.makeDirectory(dir, { recursive: true });
              yield* fs.writeFileString(
                path.join(dir, "preferences.json"),
                JSON.stringify(remembered)
              );
              assert.deepStrictEqual(
                yield* handlers["agents.preferences"](),
                remembered
              );
            }),
          "/nowhere/config",
          home
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "open a folder with the start screen's prompt, which its editor takes once",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const start = {
            attachments: [
              {
                dataUrl: "data:image/png;base64,AAAA",
                kind: "image" as const,
                name: "Sketch",
              },
            ],
            look: "agent" as const,
            prompt: "A bike shop",
          };
          yield* handlers["projects.openFolder"]("/work/shop", start);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          const shop = (yield* handlers["projects.current"]()) ?? "";
          const take = handlers["projects.takeFirstPrompt"]().pipe(
            Effect.provide(Caller.layer(shop))
          );
          assert.deepStrictEqual(yield* take, start);
          // Taken, a reload of the editor sends nothing again.
          assert.strictEqual(yield* take, null);
        })
      )
  );

  it.effect(
    "give no prompt to a project opened from the list after one it was not taken in",
    () =>
      withHandlers((handlers) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const shop = yield* store.add("/work/shop");
          const cafe = yield* store.add("/work/cafe");
          yield* handlers["projects.openFolder"]("/work/shop", {
            look: "agent",
            prompt: "A bike shop",
          });
          yield* handlers["projects.open"](cafe.id);
          yield* handlers["projects.open"](shop.id);
          assert.strictEqual(
            yield* handlers["projects.takeFirstPrompt"](),
            null
          );
        })
      )
  );

  it.effect(
    "open the folder of an open project with a prompt: its tab shown, its editor loaded again to take it",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          yield* handlers["projects.openFolder"]("/work/shop");
          yield* handlers["projects.show"](null);
          const loaded = recorded.views.length;
          yield* handlers["projects.openFolder"]("/work/shop", {
            look: "agent",
            prompt: "A bike shop",
          });
          assert.strictEqual(recorded.views.length, loaded + 1);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          const shop = (yield* handlers["projects.current"]()) ?? "";
          assert.deepStrictEqual(
            yield* handlers["projects.takeFirstPrompt"]().pipe(
              Effect.provide(Caller.layer(shop))
            ),
            { look: "agent", prompt: "A bike shop" }
          );
          // The server it had goes on: nothing started again.
          assert.deepStrictEqual(recorded.events, ["start shop"]);
        })
      )
  );

  it.effect(
    "leave the open project's editor as it is when its folder is opened again",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          yield* handlers["projects.openFolder"]("/work/shop");
          const shown = recorded.views.length;
          // A second launch of the app naming the folder: nothing is loaded again.
          yield* handlers["projects.openFolder"]("/work/shop");
          assert.strictEqual(recorded.views.length, shown);
          assert.deepStrictEqual(recorded.events, ["start shop"]);
        })
      )
  );

  it.effect("add a remote project open already by showing its tab", () =>
    withHandlers((handlers, recorded) =>
      Effect.gen(function* () {
        const site = { host: "devbox", path: "~/site" };
        yield* handlers["projects.addRemote"](site);
        yield* handlers["projects.show"](null);
        yield* handlers["projects.addRemote"](site);
        assert.isNotNull(yield* handlers["projects.current"]());
        assert.deepStrictEqual(recorded.events, ["start devbox:site"]);
      })
    )
  );
});

/** The handlers in a home folder of their own, whose `.ultrapaint` holds the person's name. */
const withHome = <A, E>(
  body: (
    handlers: ReturnType<typeof bridgeHandlers>,
    recorded: Recorded,
    home: string
  ) => Effect.Effect<A, E, HandlerServices>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    yield* fs.makeDirectory(path.join(home, ".ultrapaint", "chat"), {
      recursive: true,
    });
    yield* fs.writeFileString(
      path.join(home, ".ultrapaint", "profile.json"),
      '{"displayName":"Ada"}\n'
    );
    return yield* withHandlers(
      (handlers, recorded) => body(handlers, recorded, home),
      "/nowhere/config",
      home
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("the person's folders (ADR 0091)", () => {
  it.effect(
    "move the person's folder: copied, the old one removed, and the open projects' servers started again on it",
    () =>
      withHome((handlers, recorded, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* ProjectStore;
          yield* handlers["projects.open"]((yield* store.add("/work/shop")).id);
          assert.strictEqual(recorded.starts[0]?.userDirIn, home);
          const sync = path.join(home, "Sync");
          yield* fs.makeDirectory(sync);
          recorded.picks.push(sync);
          const moved = path.join(sync, ".ultrapaint");
          assert.deepStrictEqual(yield* handlers["folders.moveUser"](), {
            user: moved,
          });
          assert.deepStrictEqual(recorded.pickers, ["Move your folder to…"]);
          assert.strictEqual(
            yield* fs.readFileString(path.join(moved, "profile.json")),
            '{"displayName":"Ada"}\n'
          );
          assert.isFalse(yield* fs.exists(path.join(home, ".ultrapaint")));
          assert.deepStrictEqual(recorded.events, [
            "start shop",
            "stop shop",
            "start shop",
          ]);
          assert.strictEqual(recorded.starts[1]?.userDirIn, sync);
          // Recorded where every server looks, so an agent outside the app finds it too.
          assert.deepStrictEqual(
            JSON.parse(
              yield* fs.readFileString(
                path.join(home, ".config", "Ultrapaint", "user-folder.json")
              )
            ),
            { userDirIn: sync, version: 1 }
          );
          assert.deepStrictEqual(yield* handlers["folders.current"](), {
            newProjects: path.join(home, "Ultrapaint"),
            user: moved,
          });
          // What the app reads there itself follows it.
          yield* fs.writeFileString(
            path.join(moved, "chat", "preferences.json"),
            JSON.stringify({ agents: [], defaults: { agentId: "codex" } })
          );
          assert.deepStrictEqual(
            (yield* handlers["agents.preferences"]()).defaults,
            { agentId: "codex" }
          );
        })
      )
  );

  it.effect(
    "refuse a folder inside the person's folder, or one with a .ultrapaint already, before anything stops",
    () =>
      withHome((handlers, recorded, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* ProjectStore;
          yield* handlers["projects.open"]((yield* store.add("/work/shop")).id);
          const inside = path.join(home, ".ultrapaint", "chat");
          recorded.picks.push(inside);
          assert.deepStrictEqual(yield* handlers["folders.moveUser"](), {
            problem: `That folder is inside your folder. Choose one outside ${path.join(home, ".ultrapaint")}.`,
          });
          const taken = path.join(home, "Taken");
          yield* fs.makeDirectory(path.join(taken, ".ultrapaint"), {
            recursive: true,
          });
          recorded.picks.push(taken);
          assert.deepStrictEqual(yield* handlers["folders.moveUser"](), {
            problem: `${taken} already has a .ultrapaint folder. Choose another folder, or move that one away first.`,
          });
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          assert.isTrue(
            yield* fs.exists(path.join(home, ".ultrapaint", "profile.json"))
          );
        })
      )
  );

  it.effect(
    "refuse to move it under a server started outside the app, which keeps using it",
    () =>
      withHome((handlers, recorded, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* ProjectStore;
          yield* handlers["projects.open"](
            (yield* store.add("/work/attached")).id
          );
          const sync = path.join(home, "Sync");
          yield* fs.makeDirectory(sync);
          recorded.picks.push(sync);
          const moved = yield* handlers["folders.moveUser"]();
          assert.include(moved.problem ?? "", "started outside the app");
          assert.isUndefined(moved.user);
          assert.isFalse(yield* fs.exists(path.join(sync, ".ultrapaint")));
          assert.isTrue(
            yield* fs.exists(path.join(home, ".ultrapaint", "profile.json"))
          );
        })
      )
  );

  it.effect(
    "ask before stopping agents at work, and leave the folder where it is when told no",
    () =>
      withHome((handlers, recorded, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* ProjectStore;
          yield* handlers["projects.open"]((yield* store.add("/work/shop")).id);
          recorded.working.shop = 1;
          recorded.answers.push(false);
          const sync = path.join(home, "Sync");
          yield* fs.makeDirectory(sync);
          recorded.picks.push(sync);
          assert.deepStrictEqual(yield* handlers["folders.moveUser"](), {});
          assert.deepStrictEqual(recorded.questions, ["Move your folder?"]);
          assert.deepStrictEqual(recorded.events, ["start shop"]);
          assert.isFalse(yield* fs.exists(path.join(sync, ".ultrapaint")));
          assert.strictEqual(
            (yield* handlers["folders.current"]()).user,
            path.join(home, ".ultrapaint")
          );
        })
      )
  );

  it.effect(
    "change where new projects are made, and nothing when the picker is cancelled",
    () =>
      withHome((handlers, recorded, home) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          assert.isNull(yield* handlers["folders.setNewProjects"]());
          const work = path.join(home, "Work");
          recorded.picks.push(work);
          assert.strictEqual(yield* handlers["folders.setNewProjects"](), work);
          assert.deepStrictEqual(recorded.pickers, [
            "Make new projects in…",
            "Make new projects in…",
          ]);
          assert.strictEqual(
            (yield* handlers["folders.current"]()).newProjects,
            work
          );
        })
      )
  );

  it.effect("show a folder in the file manager", () =>
    withHome((handlers, recorded, home) =>
      Effect.gen(function* () {
        yield* handlers["folders.open"](home);
        assert.deepStrictEqual(recorded.events, [`show ${home}`]);
      })
    )
  );
});
