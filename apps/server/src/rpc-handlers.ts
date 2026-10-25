import {
  type SetupStepId,
  setupStepOf,
} from "@ultrapaint/contracts/design-system-setup";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect } from "effect";
import { AppLog } from "./app-log.ts";
import { connectHost, ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { CommentsService } from "./services/comments.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { ImplementationService } from "./services/implementation.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { MCP_PATH, MCP_TOKEN_HEADER } from "./services/mcp/route.ts";
import { PagesService } from "./services/pages.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { SkillsService } from "./services/skills.ts";
import { Snapshots } from "./services/snapshots.ts";
import { SpecService } from "./services/specs.ts";
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
    const sync = yield* DesignSystemSyncService;
    const { host: listenHost, mcp: mcpEnabled, port } = yield* ServerConfig;

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
    const skills = <A, E>(
      f: (s: SkillsService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(SkillsService, f));
    const catalogue = <A, E>(
      f: (s: CatalogueService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(CatalogueService, f));
    const figma = <A, E>(
      f: (s: FigmaImportService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(FigmaImportService, f));
    const specs = <A, E>(
      f: (s: SpecService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(SpecService, f));
    const implementation = <A, E>(
      f: (s: ImplementationService["Service"]) => Effect.Effect<A, E>
    ) => project.use(Effect.flatMap(ImplementationService, f));

    /**
     * Stops the turns of the steps from `step` on that are under way, before the setup moves
     * them: an agent still writing would undo the redo.
     */
    const stopThreads = (step: SetupStepId, only: boolean) =>
      Effect.gen(function* () {
        const { steps } = yield* dsSetup.get;
        const from = steps.findIndex((s) => s.id === step);
        const affected = only ? [steps[from]] : steps.slice(from);
        for (const s of affected) {
          if (s?.threadId !== undefined && s.status === "active") {
            // A thread that is not working has no turn to cancel.
            yield* Effect.ignore(threads.cancel(s.threadId));
          }
        }
      });

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

      "catalogue.get": ({ refresh }) => catalogue((c) => c.get(refresh)),

      "chat.defaults": () => preferences.defaults,
      "chat.setDefaults": (defaults) => preferences.setDefaults(defaults),
      "checkpoints.diff": ({ id }) => checkpoints.diff(id),
      "checkpoints.list": () => checkpoints.list,
      "checkpoints.revert": ({ id }) => checkpoints.revert(id),
      "commands.list": () => Effect.succeed(commands.list),
      "comments.create": (input) => comments((c) => c.create(input)),
      "comments.delete": ({ id, canvas }) =>
        comments((c) => c.delete(canvas, id)),
      "comments.deleteReply": ({ id, replyId, canvas }) =>
        comments((c) => c.deleteReply(canvas, id, replyId)),
      "comments.list": ({ canvas }) => comments((c) => c.list(canvas)),
      "comments.reply": (input) => comments((c) => c.reply(input)),
      "comments.update": (input) => comments((c) => c.update(input)),
      "designSystem.detect": () => designSystem((d) => d.detect),
      "designSystem.get": () => designSystem((d) => d.get),
      "designSystem.placeDocument": () => designSystem((d) => d.placeDocument),
      "designSystem.setSection": ({ name, text }) =>
        designSystem((d) => d.setSection(name, text)),
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
      "dsSetup.redo": ({ step }) =>
        Effect.andThen(stopThreads(step, false), dsSetup.redo(step)),
      "dsSetup.redoPreview": ({ step }) => dsSetup.redoPreview(step),
      "dsSetup.resume": ({ step }) => dsSetup.resume(step),
      "dsSetup.revertBatch": ({ batchId }) => dsSetup.revertBatch(batchId),
      "dsSetup.setMapping": ({ changes }) =>
        Effect.map(dsSetup.setMapping(changes, "user"), (r) => ({
          mapping: r.mapping,
          problems: r.problems,
        })),
      "dsSetup.start": Effect.fnUntraced(function* ({ mode, step }) {
        const thread = setupStepOf(step)?.agent
          ? yield* threads.create(
              undefined,
              `Design system: ${setupStepOf(step)?.title ?? step}`
            )
          : null;
        const started = yield* dsSetup
          .start(step, {
            ...(mode && { mode }),
            ...(thread && { threadId: thread.id }),
          })
          // A step that could not start leaves no empty thread behind.
          .pipe(
            Effect.tapError(() =>
              thread ? threads.delete(thread.id) : Effect.void
            )
          );
        return { setup: started, threadId: thread?.id ?? null };
      }),
      "dsSetup.stop": ({ step }) =>
        Effect.andThen(stopThreads(step, true), dsSetup.stop(step)),
      "edit.redo": () => edit((e) => e.redo),
      "edit.state": () => edit((e) => e.state),
      "edit.undo": () => edit((e) => e.undo),

      "events.agent": () => events.subscribe("agent"),
      "events.agent.edited": () => events.subscribe("agent.edited"),
      "events.agent.focus": () => events.subscribe("agent.focus"),
      "events.agent.terminal": () => events.subscribe("agent.terminal"),
      "events.canvas": () => events.subscribe("canvas"),
      "events.comments": () => events.subscribe("comments"),
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
      "events.specs": () => events.subscribe("specs"),
      "events.syncPlan": () => events.subscribe("syncPlan"),
      "figma.list": () => figma((f) => f.list),
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
      "implementation.changes": ({ target }) =>
        implementation((s) => s.changes(target)),
      "implementation.list": () => implementation((s) => s.list),
      "implementation.mark": ({ files, target }) =>
        implementation((s) => s.mark(target, files)),
      "implementation.setReady": ({ ready, target }) =>
        implementation((s) => s.setReady(target, ready)),
      "implementation.unbind": ({ target }) =>
        implementation((s) => s.unbind(target)),
      "logs.recent": () => log.recent(RECENT_LOG_LINES),
      "mcp.connection": () =>
        Effect.map(
          mcpEnabled
            ? Effect.all({ replaced: access.replaced, token: access.external })
            : Effect.succeed({ replaced: false, token: "" }),
          ({ replaced, token }) => ({
            enabled: mcpEnabled,
            header: MCP_TOKEN_HEADER,
            replaced,
            token,
            url: `http://${connectHost(listenHost)}:${port}${MCP_PATH}`,
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
      "pages.delete": ({ id }) => pages((s) => s.delete(id)),
      "pages.duplicate": ({ id }) => pages((s) => s.duplicate(id)),

      "pages.list": () => pages((s) => s.list),
      "pages.rename": ({ id, name }) => pages((s) => s.rename(id, name)),
      "pages.setRoute": ({ id, route }) => pages((s) => s.setRoute(id, route)),
      "pages.templates": () => pages((s) => Effect.succeed(s.templates)),

      "project.info": () => project.info,

      "screenshots.deliver": (result) => screenshots.deliver(result),

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
      "settings.renameConfig": () =>
        Effect.tap(settings.renameConfig, () => project.publishInfo),
      "settings.set": Effect.fnUntraced(function* (input) {
        const before = yield* settings.get;
        const validation = yield* settings.set(input);
        const saved = yield* settings.get;
        if (validation.ok && saved) {
          const { configured } = yield* project.info;
          // Setting what is already running must not restart the preview, nor drop the
          // project's undo history.
          if (!configured || JSON.stringify(before) !== JSON.stringify(saved)) {
            yield* project.open(saved);
          }
        }
        return validation;
      }),
      "settings.validate": (input) => settings.validate(input),
      "setup.createDesigns": (input) => setup.createDesigns(input),
      "setup.detect": ({ repoPath }) => setup.detect(repoPath),
      "setup.scaffold": Effect.fnUntraced(function* (input) {
        // A Figma file imported already gives the new application its theme.
        const tokens = yield* figma((f) =>
          Effect.gen(function* () {
            const latest = yield* f.latest;
            if (!latest) {
              return {};
            }
            const set = yield* f.tokens(latest.id);
            return Object.fromEntries(
              set.tokens.flatMap((t) => {
                const value = t.values[""];
                return value === undefined ? [] : [[t.name, value] as const];
              })
            );
          })
        ).pipe(
          // No project open, or a file that does not read: the template's own theme.
          Effect.orElseSucceed((): Record<string, string> => ({}))
        );
        return yield* setup.scaffold(input, tokens);
      }),
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
      "specs.draftFrom": ({ id, name, nodeId }) =>
        specs((s) => s.draftFrom(id, nodeId, name)),
      "specs.fromCode": ({ component, from, look }) =>
        specs((s) => s.fromCode(component, from, look ?? "code")),
      "specs.list": () => specs((s) => s.list),
      "specs.remove": ({ component }) => specs((s) => s.remove(component)),
      "specs.write": ({ spec }) => specs((s) => s.write(spec)),
      "sync.apply": ({ decisions, only, source }) =>
        sync.apply(source, decisions, only),
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
