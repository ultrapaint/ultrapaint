import { BadRequest } from "@ultrapaint/contracts/errors";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { CanvasItems } from "./services/canvas-items.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { CommentsService } from "./services/comments.ts";
import { EditService } from "./services/edit.ts";
import { ProjectFramework } from "./services/framework.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { MCP_PATH, MCP_TOKEN_HEADER } from "./services/mcp/route.ts";
import { PagesService } from "./services/pages.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
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
    const setup = yield* SetupService;
    const project = yield* ProjectManager;
    const events = yield* EventBus;
    const log = yield* AppLog;
    const agents = yield* AgentConfigs;
    const store = yield* ThreadStore;
    const threads = yield* ThreadService;
    const checkpoints = yield* Checkpoints;
    const access = yield* McpAccess;
    const { mcp: mcpEnabled, port } = yield* ServerConfig;

    const pages = <A, E>(
      f: (s: PagesService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(PagesService, f));
    const comments = <A, E>(
      f: (s: CommentsService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CommentsService, f));
    const edit = <A, E>(
      f: (s: EditService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(EditService, f));
    const git = <A, E>(f: (s: GitService["Service"]) => Effect.Effect<A, E>) =>
      project.use(Effect.flatMap(GitService, f));
    const host = <A, E>(
      f: (s: HostManager["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(HostManager, f));
    const items = <A, E>(
      f: (s: CanvasItems["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CanvasItems, f));
    const catalogue = <A, E>(
      f: (s: CatalogueService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CatalogueService, f));

    return UltrapaintRpcs.of({
      "agents.list": () => agents.list,
      "canvas.addImage": (input) => items((i) => i.addImage(input)),
      "canvas.createItem": (input) => items((i) => i.create(input)),
      "canvas.extractItem": (input) => items((i) => i.extract(input)),
      "canvas.get": ({ space }) => pages((s) => s.readCanvas(space)),
      "canvas.placeItem": (input) => items((i) => i.place(input)),
      "canvas.removeItem": (input) => items((i) => i.remove(input)),
      "canvas.set": ({ layout, space }) =>
        pages((s) => s.writeCanvas(space, layout)),

      "catalogue.get": ({ refresh }) => catalogue((c) => c.get(refresh)),
      "catalogue.storyUrl": ({ storyId }) =>
        catalogue((c) => Effect.succeed(c.storyUrl(storyId))),
      "checkpoints.diff": ({ id }) => checkpoints.diff(id),
      "checkpoints.list": () => checkpoints.list,
      "checkpoints.revert": ({ id }) => checkpoints.revert(id),
      "comments.create": (input) => comments((c) => c.create(input)),
      "comments.delete": ({ id, space }) =>
        comments((c) => c.delete(space, id)),
      "comments.deleteReply": ({ id, replyId, space }) =>
        comments((c) => c.deleteReply(space, id, replyId)),
      "comments.list": ({ space }) => comments((c) => c.list(space)),
      "comments.reply": (input) => comments((c) => c.reply(input)),
      "comments.update": (input) => comments((c) => c.update(input)),
      "edit.apply": ({ op, expectedHash }) =>
        edit((e) => e.apply(op, expectedHash)),
      "edit.redo": () => edit((e) => e.redo),
      "edit.state": () => edit((e) => e.state),
      "edit.transfer": (request) => edit((e) => e.transfer(request)),
      "edit.undo": () => edit((e) => e.undo),

      "events.agent": () => events.subscribe("agent"),
      "events.agent.focus": () => events.subscribe("agent.focus"),
      "events.agent.terminal": () => events.subscribe("agent.terminal"),
      "events.canvas": () => events.subscribe("canvas"),
      "events.comments": () => events.subscribe("comments"),
      "events.edit.state": () => events.subscribe("edit.state"),
      "events.file.changed": () => events.subscribe("file.changed"),
      "events.git": () => events.subscribe("git"),
      "events.log": () => events.subscribe("log"),
      "events.pages": () => events.subscribe("pages"),
      "events.project": () => events.subscribe("project"),
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
      "mcp.connection": () =>
        Effect.map(
          mcpEnabled ? access.external : Effect.succeed(""),
          (token) => ({
            enabled: mcpEnabled,
            header: MCP_TOKEN_HEADER,
            token,
            url: `http://127.0.0.1:${port}${MCP_PATH}`,
          })
        ),
      "pages.create": ({ route, space, template }) =>
        pages((s) => s.create(space, route, template)),
      "pages.delete": ({ id }) => pages((s) => s.delete(id)),
      "pages.duplicate": ({ id }) => pages((s) => s.duplicate(id)),

      "pages.list": () => pages((s) => s.list),
      "pages.rename": ({ id, route }) => pages((s) => s.rename(id, route)),
      "pages.templates": () => pages((s) => Effect.succeed(s.templates)),

      "project.info": () => project.info,

      "settings.get": () => settings.get,
      "settings.persist": Effect.fnUntraced(function* (input) {
        const before = yield* settings.get;
        const result = yield* settings.persist(input);
        const saved = yield* settings.get;
        if (result.validation.ok && saved) {
          const { configured } = yield* project.info;
          // Saving what is already running must not restart the preview.
          if (!configured || JSON.stringify(before) !== JSON.stringify(saved)) {
            yield* project.open(saved);
          }
          yield* project.publishInfo;
        }
        return result;
      }),
      "settings.set": Effect.fnUntraced(function* (input) {
        const validation = yield* settings.set(input);
        const saved = yield* settings.get;
        if (validation.ok && saved) {
          yield* project.open(saved);
        }
        return validation;
      }),
      "settings.validate": (input) => settings.validate(input),
      "setup.createDesigns": (input) => setup.createDesigns(input),
      "setup.detect": ({ repoPath }) => setup.detect(repoPath),
      "source.element": (location) =>
        project.use(
          Effect.gen(function* () {
            const paths = yield* RepoPaths;
            const framework = yield* ProjectFramework;
            const { content } = yield* (yield* EditService).read(location.file);
            // The source editor is pure and throws on a file it cannot parse.
            return yield* Effect.try({
              catch: (error) =>
                new BadRequest({
                  message: `${location.file} cannot be parsed: ${String(error)}`,
                }),
              try: () =>
                framework.source.elementSource(
                  content,
                  location.file,
                  location,
                  paths.isEditable(location.file)
                ),
            });
          })
        ),

      "source.outline": ({ file }) =>
        project.use(
          Effect.gen(function* () {
            const framework = yield* ProjectFramework;
            const { content, hash } = yield* (yield* EditService).read(file);
            const elements = yield* Effect.try({
              catch: (error) =>
                new BadRequest({
                  message: `${file} cannot be parsed: ${String(error)}`,
                }),
              try: () => framework.source.outline(content),
            });
            return { elements, hash };
          })
        ),
      "source.read": ({ file }) =>
        edit((e) =>
          Effect.map(e.read(file), ({ content, hash }) => ({ content, hash }))
        ),
      "spaces.create": ({ name }) => pages((s) => s.createSpace(name)),
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
