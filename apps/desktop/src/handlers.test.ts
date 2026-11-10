import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { AgentSettings } from "./agent-settings.ts";
import { Agents, makeRuntime } from "./agents.ts";
import {
  bridgeHandlers,
  type HandlerServices,
  remoteOpen,
} from "./handlers.ts";
import { LoginShell } from "./login-shell.ts";
import { NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectStore } from "./projects.ts";
import {
  fakeRemoteProjects,
  fakeServers,
  fakeShell,
  makeRecorded,
  type Recorded,
} from "./testing.ts";

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
    asked: string[]
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
      Layer.succeed(
        NewDesigns,
        NewDesigns.of({
          create: (request, report) =>
            Effect.as(report({ state: "active", step: "folder" }), {
              failed: { message: request.name, step: "install" },
            }),
          folderFor: (name) => Effect.succeed(`/home/u/Ultrapaint/${name}`),
          open: () => Effect.succeed({}),
        })
      ),
      Layer.succeed(
        Notices,
        Notices.of({
          list: Effect.succeed([
            { detail: "Install it.", id: "node", title: "No Node.js" },
          ]),
        })
      ),
      OpenProject.layer(dir)
    ).pipe(
      Layer.provideMerge(ProjectStore.layer(dir)),
      Layer.provideMerge(AgentSettings.layer(dir)),
      Layer.provideMerge(LoginShell.layerTest({ PATH: "/usr/bin" })),
      Layer.provideMerge(fakeAgents(asked)),
      Layer.provideMerge(fakeServers(recorded)),
      Layer.provideMerge(fakeRemoteProjects(recorded)),
      Layer.provideMerge(fakeShell(recorded))
    );
    const handlers = bridgeHandlers({ home, sshConfig });
    return yield* body(handlers, recorded, asked).pipe(Effect.provide(app));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("the bridge's handlers", () => {
  it.effect("list the projects with where each is, and the open one", () =>
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
          assert.isTrue(yield* remoteOpen);
          // One that cannot be reached is the welcome page's to say, not the dialog's.
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

  it.effect("tell a local project from a remote one", () =>
    withHandlers((handlers) =>
      Effect.gen(function* () {
        assert.isFalse(yield* remoteOpen);
        const store = yield* ProjectStore;
        yield* handlers["projects.open"]((yield* store.add("/work/shop")).id);
        assert.isFalse(yield* remoteOpen);
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
    "open a folder with the start screen's prompt on the editor's address",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          yield* handlers["projects.openFolder"]("/work/shop", {
            look: "agent",
            prompt: "A bike shop",
          });
          const editor = recorded.views.at(-1);
          assert.strictEqual(editor?._tag, "Editor");
          const url = new URL(editor?._tag === "Editor" ? editor.url : "");
          assert.deepStrictEqual(
            JSON.parse(url.searchParams.get("first-prompt") ?? "null"),
            { look: "agent", prompt: "A bike shop" }
          );
        })
      )
  );

  it.effect(
    "show the start screen with the open project kept behind it, and go back to it",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const shop = yield* store.add("/work/shop");
          yield* handlers["projects.open"](shop.id);
          yield* handlers["projects.showStart"]();
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Welcome",
            back: "shop",
          });
          yield* handlers["projects.open"](shop.id);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/shop",
          });
          // Its server ran on behind the start screen.
          assert.deepStrictEqual(recorded.events, ["start shop"]);
        })
      )
  );

  it.effect(
    "open the folder of the project behind the start screen as its editor again, with the prompt",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          yield* handlers["projects.openFolder"]("/work/shop");
          yield* handlers["projects.showStart"]();
          yield* handlers["projects.openFolder"]("/work/shop", {
            look: "agent",
            prompt: "A bike shop",
          });
          const editor = recorded.views.at(-1);
          assert.strictEqual(editor?._tag, "Editor");
          const url = new URL(editor?._tag === "Editor" ? editor.url : "");
          assert.strictEqual(
            url.origin + url.pathname,
            "http://127.0.0.1/shop"
          );
          assert.deepStrictEqual(
            JSON.parse(url.searchParams.get("first-prompt") ?? "null"),
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

  it.effect(
    "add the remote project behind the start screen as its editor again",
    () =>
      withHandlers((handlers, recorded) =>
        Effect.gen(function* () {
          const site = { host: "devbox", path: "~/site" };
          yield* handlers["projects.addRemote"](site);
          yield* handlers["projects.showStart"]();
          yield* handlers["projects.addRemote"](site);
          assert.deepStrictEqual(recorded.views.at(-1), {
            _tag: "Editor",
            url: "http://127.0.0.1/devbox/site",
          });
          assert.deepStrictEqual(recorded.events, ["start devbox:site"]);
        })
      )
  );
});
