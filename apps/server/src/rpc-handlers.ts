import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { CommentsService } from "./services/comments.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { MCP_PATH, MCP_TOKEN_HEADER } from "./services/mcp/route.ts";
import { PagesService } from "./services/pages.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";
import { Thumbnails } from "./services/thumbnails.ts";

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
    const preferences = yield* ChatPreferences;
    const threads = yield* ThreadService;
    const checkpoints = yield* Checkpoints;
    const access = yield* McpAccess;
    const commands = yield* SlashCommands;
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
    const documents = <A, E>(
      f: (s: DocumentService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(DocumentService, f));
    const designSystem = <A, E>(
      f: (s: DesignSystemService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(DesignSystemService, f));
    const thumbnails = <A, E>(
      f: (s: Thumbnails["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(Thumbnails, f));
    const catalogue = <A, E>(
      f: (s: CatalogueService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CatalogueService, f));

    return UltrapaintRpcs.of({
      "agents.list": () => agents.list,
      "agents.options": () => preferences.options,
      "assets.upload": (input) => documents((d) => d.upload(input)),
      "canvas.get": ({ space }) => pages((s) => s.readCanvas(space)),
      "canvas.set": ({ frames, space }) =>
        pages((s) => s.writeFrames(space, frames)),

      "catalogue.get": ({ refresh }) => catalogue((c) => c.get(refresh)),
      "catalogue.storyUrl": ({ storyId }) =>
        catalogue((c) => Effect.succeed(c.storyUrl(storyId))),
      "chat.defaults": () => preferences.defaults,
      "chat.setDefaults": (defaults) => preferences.setDefaults(defaults),
      "checkpoints.diff": ({ id }) => checkpoints.diff(id),
      "checkpoints.list": () => checkpoints.list,
      "checkpoints.revert": ({ id }) => checkpoints.revert(id),
      "commands.list": () => Effect.succeed(commands.list),
      "comments.create": (input) => comments((c) => c.create(input)),
      "comments.delete": ({ id, space }) =>
        comments((c) => c.delete(space, id)),
      "comments.deleteReply": ({ id, replyId, space }) =>
        comments((c) => c.deleteReply(space, id, replyId)),
      "comments.list": ({ space }) => comments((c) => c.list(space)),
      "comments.reply": (input) => comments((c) => c.reply(input)),
      "comments.update": (input) => comments((c) => c.update(input)),
      "designSystem.detect": () => designSystem((d) => d.detect),
      "designSystem.get": () => designSystem((d) => d.get),
      "documents.apply": (input) => documents((d) => d.apply(input)),
      "documents.get": ({ doc }) => documents((d) => d.get(doc)),
      "documents.list": ({ space }) => documents((d) => d.list(space)),
      "edit.redo": () => edit((e) => e.redo),
      "edit.state": () => edit((e) => e.state),
      "edit.undo": () => edit((e) => e.undo),

      "events.agent": () => events.subscribe("agent"),
      "events.agent.focus": () => events.subscribe("agent.focus"),
      "events.agent.terminal": () => events.subscribe("agent.terminal"),
      "events.canvas": () => events.subscribe("canvas"),
      "events.comments": () => events.subscribe("comments"),
      "events.designSystem": () => events.subscribe("designSystem"),
      "events.document": () => events.subscribe("document"),
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
      "spaces.create": ({ name }) => pages((s) => s.createSpace(name)),
      "threads.cancel": ({ threadId }) => threads.cancel(threadId),
      "threads.create": ({ agentId, title }) => threads.create(agentId, title),
      "threads.delete": ({ threadId }) => threads.delete(threadId),
      "threads.items": ({ threadId }) => store.items(threadId),
      "threads.list": () => store.list,
      "threads.permission": ({ threadId, requestId, optionId, remember }) =>
        threads.resolvePermission(threadId, requestId, optionId, remember),
      "threads.prompt": (input) => threads.prompt(input),
      "threads.setAgent": ({ threadId, agentId }) =>
        threads.setAgent(threadId, agentId),
      "threads.setConfigOption": ({ threadId, optionId, value }) =>
        threads.setConfigOption(threadId, optionId, value),
      "threads.setMode": ({ threadId, modeId }) =>
        threads.setMode(threadId, modeId),
      "thumbnails.get": ({ key }) => thumbnails((t) => t.get(key)),
      "thumbnails.put": ({ dataUrl, key, name }) =>
        thumbnails((t) => t.put(key, name, dataUrl)),
    });
  })
);
