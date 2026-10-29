import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ComponentService } from "./services/components.ts";
import { DesignMd } from "./services/design-md.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { ImplementationService } from "./services/implementation.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { PagesService } from "./services/pages.ts";
import { ProfileService } from "./services/profile.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { SetupSteps } from "./services/setup-steps.ts";
import { SkillsService } from "./services/skills.ts";
import { Snapshots } from "./services/snapshots.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
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
    const discovery = yield* AgentDiscovery;
    const threads = yield* ThreadService;
    const checkpoints = yield* Checkpoints;
    const snapshots = yield* Snapshots;
    const access = yield* McpAccess;
    const commands = yield* SlashCommands;
    const screenshots = yield* Screenshots;
    const dsSetup = yield* DesignSystemSetupService;
    const setupSteps = yield* SetupSteps;
    const profile = yield* ProfileService;
    const sync = yield* DesignSystemSyncService;
    const { mcp: mcpEnabled } = yield* ServerConfig;

    const pages = project.service(PagesService);
    const comments = project.service(CommentsService);
    const edit = project.service(EditService);
    const git = project.service(GitService);
    const documents = project.service(DocumentService);
    const designSystem = project.service(DesignSystemService);
    const designMd = project.service(DesignMd);
    const thumbnails = project.service(Thumbnails);
    const skills = project.service(SkillsService);
    const figma = project.service(FigmaImportService);
    const components = project.service(ComponentService);
    const implementation = project.service(ImplementationService);

    return UltrapaintRpcs.of({
      "agents.discover": ({ agentId }) => discovery.discover(agentId),
      "agents.list": () => agents.list,
      "agents.options": () => preferences.options,
      "assets.upload": (input) => documents((d) => d.upload(input)),
      "canvas.get": ({ canvas }) => pages((s) => s.readCanvas(canvas)),
      "canvas.set": ({ canvas, frames }) =>
        pages((s) => s.writeFrames(canvas, frames)),
      "canvases.create": ({ name }) => pages((s) => s.createCanvas(name)),
      "canvases.delete": ({ id }) => pages((s) => s.deleteCanvas(id)),
      "canvases.duplicate": ({ id, name }) =>
        pages((s) => s.duplicateCanvas(id, name)),
      "canvases.rename": ({ id, name }) =>
        pages((s) => s.renameCanvas(id, name)),
      "canvases.reorder": ({ order }) => pages((s) => s.reorderCanvases(order)),
      "canvases.setHome": ({ id, route }) => pages((s) => s.setHome(id, route)),

      "chat.defaults": () => preferences.defaults,
      "chat.setDefaults": (defaults) => preferences.setDefaults(defaults),
      "checkpoints.diff": ({ id }) => checkpoints.diff(id),
      "checkpoints.list": () => checkpoints.list,
      "checkpoints.revert": ({ id }) => checkpoints.revert(id),

      "code.write": ({ node, ...options }) =>
        designSystem((d) =>
          Effect.map(d.codeOf(node, options), (code) => ({
            code,
            language: "tsx",
          }))
        ),
      "commands.list": () => Effect.succeed(commands.list),
      "comments.create": (input) => comments((c) => c.create(input)),
      "comments.delete": ({ id, canvas }) =>
        comments((c) => c.delete(canvas, id)),
      "comments.deleteReply": ({ id, replyId, canvas }) =>
        comments((c) => c.deleteReply(canvas, id, replyId)),
      "comments.list": ({ canvas }) => comments((c) => c.list(canvas)),
      "comments.reply": (input) => comments((c) => c.reply(input)),
      "comments.update": (input) => comments((c) => c.update(input)),
      "components.addNote": ({ name, slot, text }) =>
        components((c) => c.addNote(name, text, slot)),
      "components.fromDefault": ({ name }) =>
        components((c) => c.fromDefault(name)),
      "components.list": () => components((c) => c.list),
      "components.makeApp": ({ id, name, nodeIds }) =>
        components((c) => c.makeApp(id, nodeIds, name)),
      "components.migrate": () => components((c) => c.migrate),
      "components.remove": ({ name }) => components((c) => c.remove(name)),
      "components.write": ({ component }) =>
        components((c) => c.write(component)),
      "designSystem.detect": () => designSystem((d) => d.detect),
      "designSystem.get": () => designSystem((d) => d.get),
      "designSystem.placeDocument": () =>
        designSystem((d) =>
          Effect.flatMap(d.get, ({ designSystem: ds }) =>
            designMd((m) => m.place(ds))
          )
        ),
      "designSystem.setSection": ({ name, text }) =>
        designMd((m) => m.setSection(name, text)),
      "designSystem.setToken": (change) =>
        designSystem((d) => d.setToken(change)),
      "documents.apply": (input) => documents((d) => d.apply(input)),
      "documents.get": ({ doc }) => documents((d) => d.get(doc)),
      "documents.list": ({ canvas }) => documents((d) => d.list(canvas)),
      "dsSetup.audit": () => dsSetup.audit,
      "dsSetup.batchPreview": ({ batchId }) => dsSetup.batchPreview(batchId),
      "dsSetup.complete": ({ step }) => dsSetup.complete(step),
      "dsSetup.get": () => dsSetup.get,
      "dsSetup.inventory": () => dsSetup.inventory,
      "dsSetup.mapping": () => dsSetup.mapping,
      "dsSetup.redo": ({ step }) => setupSteps.redo(step),
      "dsSetup.redoPreview": ({ step }) => dsSetup.redoPreview(step),
      "dsSetup.resume": ({ step }) => dsSetup.resume(step),
      "dsSetup.revertBatch": ({ batchId }) => setupSteps.revertBatch(batchId),
      "dsSetup.setMapping": ({ changes }) =>
        Effect.map(dsSetup.setMapping(changes, "user"), (r) => ({
          mapping: r.mapping,
          problems: r.problems,
        })),
      "dsSetup.start": ({ mode, step }) => setupSteps.start(step, mode),
      "dsSetup.stop": ({ step }) => setupSteps.stop(step),
      "edit.redo": () => edit((e) => e.redo),
      "edit.state": () => edit((e) => e.state),
      "edit.undo": () => edit((e) => e.undo),

      "events.agent": () => events.subscribe("agent"),
      "events.agent.edited": () => events.subscribe("agent.edited"),
      "events.agent.focus": () => events.subscribe("agent.focus"),
      "events.agent.terminal": () => events.subscribe("agent.terminal"),
      "events.canvas": () => events.subscribe("canvas"),
      "events.checkpoints": () => events.subscribe("checkpoints"),
      "events.comments": () => events.subscribe("comments"),
      "events.components": () => events.subscribe("components"),
      "events.designSystem": () => events.subscribe("designSystem"),
      "events.document": () => events.subscribe("document"),
      "events.dsSetup": () => events.subscribe("dsSetup"),
      "events.dsSetupMapping": () => events.subscribe("dsSetupMapping"),
      "events.edit.state": () => events.subscribe("edit.state"),
      "events.file.changed": () => events.subscribe("file.changed"),
      "events.git": () => events.subscribe("git"),
      "events.implementation": () => events.subscribe("implementation"),
      "events.log": () => events.subscribe("log"),
      "events.pages": () => events.subscribe("pages"),
      "events.project": () => events.subscribe("project"),
      "events.screenshot": () => screenshots.requests,
      "events.skills": () => events.subscribe("skills"),
      "events.snapshots": () => events.subscribe("snapshots"),
      "events.syncPlan": () => events.subscribe("syncPlan"),
      "figma.list": () => figma((f) => f.list),
      "git.commit": ({ message, paths }) =>
        git((g) => Effect.map(g.commit(message, paths), (sha) => ({ sha }))),
      "git.diff": ({ path }) => git((g) => g.diff(path)),
      "git.init": () => git((g) => g.init),

      "git.status": () => git((g) => g.status),
      health: () => Effect.succeed({ ok: true, version: config.version }),
      "implementation.changes": ({ target }) =>
        implementation((s) => s.changes(target)),
      "implementation.list": () => implementation((s) => s.list),
      "implementation.mark": ({ files, target }) =>
        implementation((s) => s.mark(target, files)),
      "implementation.setReady": ({ ready, target }) =>
        implementation((s) => s.setReady(target, ready)),
      "implementation.setReadyAll": ({ ready, targets }) =>
        implementation((s) =>
          Effect.map(s.setReadyAll(targets, ready), (changed) => ({
            changed,
          }))
        ),
      "implementation.unbind": ({ target }) =>
        implementation((s) => s.unbind(target)),
      "logs.recent": () => log.recent(RECENT_LOG_LINES),
      "mcp.connection": () =>
        Effect.map(
          Effect.all({
            endpoint: access.endpoint,
            tokens: mcpEnabled
              ? Effect.all({
                  replaced: access.replaced,
                  token: access.external,
                })
              : Effect.succeed({ replaced: false, token: "" }),
          }),
          ({ endpoint: { header, url }, tokens: { replaced, token } }) => ({
            enabled: mcpEnabled,
            header,
            replaced,
            token,
            url,
          })
        ),
      "pages.copyTo": ({ ids, move, target }) =>
        pages((s) => s.copyTo(ids, target, move)),
      "pages.create": ({ canvas, name, route, template }) =>
        pages((s) => s.create(canvas, { name, route }, template)),
      "pages.createState": ({ id, state }) =>
        pages((s) => s.createState(id, state)),
      "pages.createVariant": ({ id, variant }) =>
        pages((s) => s.createVariant(id, variant)),
      "pages.delete": ({ id }) => pages((s) => Effect.asVoid(s.delete(id))),
      "pages.duplicate": ({ id }) => pages((s) => s.duplicate(id)),

      "pages.list": () => pages((s) => s.list),
      "pages.rename": ({ id, name }) => pages((s) => s.rename(id, name)),
      "pages.setRoute": ({ id, route }) => pages((s) => s.setRoute(id, route)),
      "pages.templates": () => pages((s) => Effect.succeed(s.templates)),
      "profile.get": () => profile.get,
      "profile.set": (input) => profile.set(input),

      "project.info": () => project.info,

      "screenshots.deliver": (result) => screenshots.deliver(result),

      "settings.get": () => settings.get,
      "settings.persist": (input) => project.persist(input),
      "settings.renameConfig": () => project.renameConfig,
      "settings.set": (input) => project.set(input),
      "settings.validate": (input) => settings.validate(input),
      "setup.createDesigns": (input) => setup.createDesigns(input),
      "setup.detect": ({ repoPath }) => setup.detect(repoPath),
      "setup.scaffold": (input) =>
        figma((f) => f.theme).pipe(
          // No project open, or a file that does not read: the template's own theme.
          Effect.orElseSucceed((): Record<string, string> => ({})),
          Effect.flatMap((theme) => setup.scaffold(input, theme))
        ),
      "skills.customise": ({ mode, name }) =>
        skills((s) => s.customise(name, mode)),
      "skills.list": () => skills((s) => s.list),
      "snapshots.create": ({ checkpoint, name }) =>
        snapshots.create(name, checkpoint),
      "snapshots.delete": ({ id }) => snapshots.delete(id),
      "snapshots.diff": ({ id }) => snapshots.diff(id),
      "snapshots.list": () => snapshots.list,
      "snapshots.restore": ({ id }) => snapshots.restore(id),
      "snapshots.view": ({ id }) => snapshots.view(id),
      "sync.apply": ({ decisions, only, source, tokens }) =>
        sync.apply(source, decisions, only, tokens),
      "sync.match": ({ entries, source }) =>
        sync.match(source, entries, "user"),
      "sync.plan": () => sync.plan,
      "sync.tokens": ({ source }) => sync.tokens(source),
      "threads.answer": ({ threadId, itemId, answers }) =>
        threads.answer(threadId, itemId, answers),
      "threads.cancel": ({ threadId }) => threads.cancel(threadId),
      "threads.create": ({ agentId, purpose, title }) =>
        threads.create(agentId, title, purpose),
      "threads.decline": ({ threadId, itemId }) =>
        threads.decline(threadId, itemId),
      "threads.delete": ({ threadId }) => threads.delete(threadId),
      "threads.items": ({ threadId }) => store.items(threadId),
      "threads.list": () => store.list,
      "threads.permission": ({ threadId, requestId, optionId, remember }) =>
        threads.resolvePermission(threadId, requestId, optionId, remember),
      "threads.prompt": (input) => threads.prompt(input),
      "threads.sendQueued": ({ threadId }) => threads.sendQueued(threadId),
      "threads.setAgent": ({ threadId, agentId }) =>
        threads.setAgent(threadId, agentId),
      "threads.setConfigOption": ({ threadId, optionId, value }) =>
        threads.setConfigOption(threadId, optionId, value),
      "threads.setMode": ({ threadId, modeId }) =>
        threads.setMode(threadId, modeId),
      "threads.unqueue": ({ id, threadId }) => threads.unqueue(threadId, id),
      "thumbnails.get": ({ key }) => thumbnails((t) => t.get(key)),
      "thumbnails.put": ({ dataUrl, key, name }) =>
        thumbnails((t) => t.put(key, name, dataUrl)),
    });
  })
);
