import { BadRequest } from "@ultrapaint/contracts/errors";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { EditService } from "./services/edit.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { ScreensService } from "./services/screens.ts";
import { SettingsService } from "./services/settings.ts";
import { elementSource } from "./services/source.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";

const RECENT_LOG_LINES = 200;

/** One handler per RPC. They only route: every decision lives in a service. */
export const RpcHandlers = UltrapaintRpcs.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settings = yield* SettingsService;
    const project = yield* ProjectManager;
    const events = yield* EventBus;
    const log = yield* AppLog;
    const agents = yield* AgentConfigs;
    const store = yield* ThreadStore;
    const threads = yield* ThreadService;
    const checkpoints = yield* Checkpoints;

    const screens = <A, E>(
      f: (s: ScreensService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(ScreensService, f));
    const edit = <A, E>(
      f: (s: EditService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(EditService, f));
    const git = <A, E>(f: (s: GitService["Service"]) => Effect.Effect<A, E>) =>
      project.use(Effect.flatMap(GitService, f));
    const host = <A, E>(
      f: (s: HostManager["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(HostManager, f));
    const catalogue = <A, E>(
      f: (s: CatalogueService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CatalogueService, f));

    return UltrapaintRpcs.of({
      "agents.list": () => agents.list,
      "canvas.get": ({ flow }) => screens((s) => s.readCanvas(flow)),
      "canvas.set": ({ flow, layout }) =>
        screens((s) => s.writeCanvas(flow, layout)),

      "catalogue.get": ({ refresh }) => catalogue((c) => c.get(refresh)),
      "catalogue.storyUrl": ({ storyId }) =>
        catalogue((c) => Effect.succeed(c.storyUrl(storyId))),
      "checkpoints.diff": ({ id }) => checkpoints.diff(id),
      "checkpoints.list": () => checkpoints.list,
      "checkpoints.revert": ({ id }) => checkpoints.revert(id),
      "edit.apply": ({ op, expectedHash }) =>
        edit((e) => e.apply(op, expectedHash)),
      "edit.redo": () => edit((e) => e.redo),
      "edit.state": () => edit((e) => e.state),
      "edit.undo": () => edit((e) => e.undo),

      "events.agent": () => events.subscribe("agent"),
      "events.canvas": () => events.subscribe("canvas"),
      "events.edit.state": () => events.subscribe("edit.state"),
      "events.file.changed": () => events.subscribe("file.changed"),
      "events.git": () => events.subscribe("git"),
      "events.log": () => events.subscribe("log"),
      "events.project": () => events.subscribe("project"),
      "events.screens": () => events.subscribe("screens"),
      "git.commit": ({ message, paths }) =>
        git((g) =>
          Effect.gen(function* () {
            const sha = yield* g.commit(message, paths);
            yield* events.publish("git", yield* g.status);
            return { sha };
          })
        ),
      "git.diff": ({ path }) => git((g) => g.diff(path)),

      "git.status": () => git((g) => g.status),
      health: () => Effect.succeed({ ok: true, version: config.version }),
      "host.start": () => host((h) => h.start),
      "host.stop": () => host((h) => h.stop),
      "logs.recent": () => log.recent(RECENT_LOG_LINES),

      "project.info": () => project.info,
      "screens.create": ({ flow, name, template }) =>
        screens((s) => s.create(flow, name, template)),
      "screens.delete": ({ id }) => screens((s) => s.delete(id)),
      "screens.duplicate": ({ id }) => screens((s) => s.duplicate(id)),

      "screens.list": () =>
        screens((s) => Effect.map(s.list, (list) => ({ screens: list }))),
      "screens.rename": ({ id, name }) => screens((s) => s.rename(id, name)),
      "screens.templates": () => screens((s) => Effect.succeed(s.templates)),

      "settings.get": () => settings.get,
      "settings.set": Effect.fnUntraced(function* (input) {
        const validation = yield* settings.set(input);
        const saved = yield* settings.get;
        if (validation.ok && saved) {
          yield* project.open(saved);
        }
        return validation;
      }),
      "settings.validate": (input) => settings.validate(input),
      "source.element": (location) =>
        project.use(
          Effect.gen(function* () {
            const paths = yield* RepoPaths;
            const { content } = yield* (yield* EditService).read(location.file);
            // `source.ts` is pure and throws on TSX it cannot parse.
            return yield* Effect.try({
              catch: (error) =>
                new BadRequest({
                  message: `${location.file} cannot be parsed: ${String(error)}`,
                }),
              try: () =>
                elementSource(
                  content,
                  location.file,
                  location,
                  paths.isEditable(location.file)
                ),
            });
          })
        ),

      "source.read": ({ file }) =>
        edit((e) =>
          Effect.map(e.read(file), ({ content, hash }) => ({ content, hash }))
        ),
      "threads.cancel": ({ threadId }) => threads.cancel(threadId),
      "threads.create": ({ agentId, title }) => threads.create(agentId, title),
      "threads.delete": ({ threadId }) => threads.delete(threadId),
      "threads.items": ({ threadId }) => store.items(threadId),
      "threads.list": () => store.list,
      "threads.permission": ({ threadId, requestId, optionId, remember }) =>
        threads.resolvePermission(threadId, requestId, optionId, remember),
      "threads.prompt": (input) => threads.prompt(input),
      "threads.setConfigOption": ({ threadId, optionId, value }) =>
        threads.setConfigOption(threadId, optionId, value),
      "threads.setMode": ({ threadId, modeId }) =>
        threads.setMode(threadId, modeId),
    });
  })
);
