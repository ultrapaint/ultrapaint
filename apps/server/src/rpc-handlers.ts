import { NotFound } from "@ultrapaint/contracts/errors";
import {
  type EventName,
  type EventPayload,
  eventNames,
  UltrapaintRpcs,
} from "@ultrapaint/contracts/rpc";
import { Effect, type Stream } from "effect";
import { AppLog } from "./app-log.ts";
import { EventBus } from "./events.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ComponentService } from "./services/components.ts";
import { DesignMd } from "./services/design-md.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { EditorSelection } from "./services/editor-selection.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { History } from "./services/history.ts";
import { ImplementationService } from "./services/implementation.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { PagesService } from "./services/pages.ts";
import { ProfileService } from "./services/profile.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SetupService } from "./services/setup.ts";
import { SetupSteps } from "./services/setup-steps.ts";
import { SkillsService } from "./services/skills.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import {
  type ThreadSession,
  ThreadSessions,
} from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { Thumbnails } from "./services/thumbnails.ts";

const RECENT_LOG_LINES = 200;

/** One handler per RPC. They only route: every decision lives in a service. */
export const RpcHandlers = UltrapaintRpcs.toLayer(
  Effect.gen(function* () {
    const setup = yield* SetupService;
    const project = yield* ProjectManager;
    const open = yield* OpenProject;
    const events = yield* EventBus;
    const log = yield* AppLog;
    const agents = yield* AgentConfigs;
    const store = yield* ThreadStore;
    const preferences = yield* ChatPreferences;
    const discovery = yield* AgentDiscovery;
    const threads = yield* ThreadSessions;
    /** What a thread's session does. */
    const thread = <A, E>(
      threadId: string,
      act: (session: ThreadSession) => Effect.Effect<A, E>
    ) => Effect.flatMap(threads.of(threadId), act);
    const access = yield* McpAccess;
    const selection = yield* EditorSelection;
    const commands = yield* SlashCommands;
    const screenshots = yield* Screenshots;
    const dsSetup = yield* DesignSystemSetupService;
    const setupSteps = yield* SetupSteps;
    const profile = yield* ProfileService;
    const sync = yield* DesignSystemSyncService;

    const pages = open.service(PagesService);
    const comments = open.service(CommentsService);
    const edit = open.service(EditService);
    const git = open.service(GitService);
    const history = open.service(History);
    const documents = open.service(DocumentService);
    const designSystem = open.service(DesignSystemService);
    const designMd = open.service(DesignMd);
    const thumbnails = open.service(Thumbnails);
    const skills = open.service(SkillsService);
    const figma = open.service(FigmaImportService);
    const components = open.service(ComponentService);
    const implementation = open.service(ImplementationService);

    // Every event as the bus carries it, but a screenshot request: an editor listening for those
    // is one that can draw, which the screenshots count.
    const eventHandlers = {
      ...(Object.fromEntries(
        eventNames.map((name) => [`events.${name}`, () => events.follow(name)])
      ) as {
        readonly [E in EventName as `events.${E}`]: () => Stream.Stream<
          EventPayload<E>
        >;
      }),
      "events.screenshot": () => screenshots.requests,
    };

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

      "chat.defaults": () => preferences.defaults,
      "chat.setDefaults": (defaults) => preferences.setDefaults(defaults),

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
      "components.change": ({ change, name }) =>
        components((c) => c.change(name, change)),
      "components.create": ({ name }) => components((c) => c.create(name)),
      "components.fromDefault": ({ name }) =>
        components((c) => c.fromDefault(name)),
      "components.list": () => components((c) => c.list),
      "components.makeApp": ({ id, name, nodeIds }) =>
        components((c) => c.makeApp(id, nodeIds, name)),
      "components.remove": ({ name }) => components((c) => c.remove(name)),
      "designSystem.detect": () => designSystem((d) => d.detect),
      "designSystem.edit": ({ label, ops }) =>
        designSystem((d) => d.edit(ops, label)),
      "designSystem.get": () => designSystem((d) => d.get),
      "designSystem.placeDocument": () => designSystem((d) => d.placeDocument),
      "designSystem.setSection": ({ name, text }) =>
        designMd((m) => m.setSection(name, text)),
      "designSystem.write": ({ designSystem: input, document }) =>
        designSystem((d) =>
          Effect.map(d.write(input, document), ({ findings }) => ({
            findings,
          }))
        ),
      "documents.apply": (input) =>
        documents((d) =>
          Effect.map(d.apply(input), ({ changes, created }) => ({
            changes,
            created,
          }))
        ),
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

      ...eventHandlers,
      "editor.select": ({ nodes }) => selection.set(nodes),
      "git.commit": ({ message, paths }) =>
        git((g) => Effect.map(g.commit(message, paths), (sha) => ({ sha }))),
      "git.diff": ({ path }) => git((g) => g.diff(path)),

      "git.status": () => git((g) => g.status),
      "history.compare": ({ id }) => history((h) => h.compare(id)),
      "history.get": () => history((h) => h.get),
      "history.rename": ({ id, name }) => history((h) => h.rename(id, name)),
      "history.restore": ({ id }) => history((h) => h.restore(id)),
      "history.save": ({ id, name }) => history((h) => h.save(name, id)),
      "history.view": ({ id }) => history((h) => h.view(id)),
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
      "mcp.connection": () => access.connection,
      "pages.copyTo": ({ ids, move, target }) =>
        pages((s) => s.copyTo(ids, target, move)),
      "pages.create": ({ canvas, name, route, template }) =>
        pages((s) => s.create(canvas, { name, route }, template)),
      "pages.createState": ({ id, state }) =>
        pages((s) => s.createState(id, state)),
      "pages.createVariant": ({ id, variant }) =>
        pages((s) => s.createVariant(id, variant)),
      "pages.delete": ({ ids }) => pages((s) => Effect.asVoid(s.delete(ids))),
      "pages.duplicate": ({ id }) => pages((s) => s.duplicate(id)),

      "pages.list": () => pages((s) => s.list),
      "pages.rename": ({ id, name }) => pages((s) => s.rename(id, name)),
      "pages.setRoute": ({ id, route }) => pages((s) => s.setRoute(id, route)),
      "profile.get": () => profile.get,
      "profile.set": (input) => profile.set(input),

      "project.info": () => project.info,

      "screenshots.deliver": (result) => screenshots.deliver(result),

      "settings.persist": (input) => project.persist(input),
      "settings.renameConfig": () => project.renameConfig,
      "settings.set": (input) => project.set(input),
      "setup.createDesigns": (input) => setup.createDesigns(input),
      "setup.detect": ({ repoPath }) => setup.detect(repoPath),
      // The open project's latest Figma import starts the application's theme.
      "setup.scaffold": (input) =>
        setup.scaffold(
          input,
          figma((f) => f.theme)
        ),
      "skills.list": () => skills((s) => s.list),
      "sync.apply": ({ decisions, only, source, tokens }) =>
        sync.apply(source, decisions, only, tokens),
      "sync.match": ({ entries, source }) =>
        sync.match(source, entries, "user"),
      "sync.plan": () => sync.plan,
      "sync.tokens": ({ source }) => sync.tokens(source),
      "threads.answer": ({ threadId, itemId, answers }) =>
        thread(threadId, (s) => s.answer(itemId, answers)),
      "threads.cancel": ({ threadId }) => thread(threadId, (s) => s.cancel),
      "threads.create": ({ agentId, purpose, title }) =>
        threads.create({ agentId, purpose, title }),
      "threads.decline": ({ threadId, itemId }) =>
        thread(threadId, (s) => s.cards.decline(itemId)),
      "threads.delete": ({ threadId }) => threads.delete(threadId),
      "threads.items": ({ threadId }) => store.items(threadId),
      "threads.list": () => store.list,
      "threads.permission": ({ threadId, requestId, optionId }) =>
        thread(threadId, (s) => s.cards.choose(requestId, optionId)),
      // A prompt is a change of the person's: an unsaved session saves first (ADR 0092).
      "threads.prompt": (input) =>
        thread(input.threadId, (s) =>
          Effect.andThen(project.changed, s.prompt(input))
        ),
      "threads.sendQueued": ({ threadId }) =>
        thread(threadId, (s) => s.sendQueued),
      "threads.setAgent": ({ threadId, agentId }) =>
        thread(threadId, (s) => s.switchAgent(agentId)),
      "threads.setConfigOption": ({ threadId, optionId, value }) =>
        thread(threadId, (s) => s.setConfigOption(optionId, value)),
      "threads.setMode": ({ threadId, modeId }) =>
        thread(threadId, (s) => s.setMode(modeId)),
      // The design's own review settings: kept on the thread, read when its next review starts.
      "threads.setReview": Effect.fnUntraced(function* ({ review, threadId }) {
        if (!(yield* store.get(threadId))) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        yield* store.update(threadId, { review: review ?? undefined });
      }),
      "threads.unqueue": ({ id, threadId }) =>
        thread(threadId, (s) => s.unqueue(id)),
      "thumbnails.get": ({ key }) => thumbnails((t) => t.get(key)),
      "thumbnails.put": ({ dataUrl, key, name }) =>
        thumbnails((t) => t.put(key, name, dataUrl)),
    });
  })
);
