/**
 * The composition root: what the server is made of, each service on the ones below it, in one
 * place. `server.ts` serves the application layer with the server's adapters; the tests build
 * the same layers with their own (`testing/project.ts`, `testing/threads.ts`).
 *
 * The adapters are the seams that have a second one for tests: how an agent is started and
 * confined (`AgentLauncher`, `AgentSandbox`).
 */
import type { Settings } from "@ultrapaint/contracts/settings";
import { Layer } from "effect";
import { AppLog } from "./app-log.ts";
import { EventBus } from "./events.ts";
import { ListenPort } from "./listen-port.ts";
import { ProjectManager, type ProjectRequirements } from "./project.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { CodeSide } from "./services/code-side.ts";
import { CommentsService } from "./services/comments.ts";
import { DesignMd } from "./services/design-md.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { DesignTargets } from "./services/design-targets.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { FigmaBaseline } from "./services/figma-baseline.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { ProjectFramework } from "./services/framework.ts";
import { GitService } from "./services/git.ts";
import { ImplementationService } from "./services/implementation.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { PagePngs } from "./services/page-pngs.ts";
import { PagesService } from "./services/pages.ts";
import { ProfileService } from "./services/profile.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { SetupSteps } from "./services/setup-steps.ts";
import { SkillsService } from "./services/skills.ts";
import { SnapshotStore } from "./services/snapshot-store.ts";
import { Snapshots } from "./services/snapshots.ts";
import { SpecService } from "./services/specs.ts";
import { Storage } from "./services/storage.ts";
import { ProjectStyleSystem } from "./services/style-system.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { AgentLauncher } from "./services/threads/agent-launcher.ts";
import { AgentSandbox } from "./services/threads/agent-sandbox.ts";
import { ProjectBriefing } from "./services/threads/briefing.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";
import { Thumbnails } from "./services/thumbnails.ts";
import { WorkingTree } from "./services/working-tree.ts";

/** What the agents' adapters are built on: the server's own services and the project. */
type AgentRequirements = ProjectRequirements | ProjectManager;

/**
 * The adapters the application is built with. `agents` gives `AgentLauncher` and
 * `AgentSandbox`, and whatever else its adapter offers a test (the agents it plays).
 */
export interface Adapters<Agents> {
  readonly agents: Layer.Layer<Agents, never, AgentRequirements>;
}

/** The server's adapters: the sandboxed agent process. */
export const ServerAdapters = {
  agents: AgentLauncher.layer.pipe(Layer.provideMerge(AgentSandbox.layer)),
} satisfies Adapters<AgentLauncher | AgentSandbox>;

/** The services of the project the settings describe. */
export const projectLayer = (settings: Settings) =>
  // Pictures of the pages, drawn from the documents as they change; and what a design target
  // names, with its behaviour notes in a spec or in comments (ADR 0030).
  Layer.mergeAll(PagePngs.layer, DesignTargets.layer).pipe(
    // The specs: a primitive's look as the design says it (ADR 0029, 0040).
    Layer.provideMerge(SpecService.layer),
    // The link to the code reads the pages, their documents and the specs (ADR 0030).
    Layer.provideMerge(ImplementationService.layer),
    Layer.provideMerge(
      Layer.mergeAll(DocumentService.layer, FigmaImportService.layer)
    ),
    Layer.provideMerge(
      Layer.mergeAll(DesignSystemService.layer, SkillsService.layer)
    ),
    // The design system's sides: DESIGN.md mirrors it with the code's tokens and the
    // components' classes; Figma's baseline waits for it.
    Layer.provideMerge(Layer.mergeAll(DesignMd.layer, FigmaBaseline.layer)),
    Layer.provideMerge(
      Layer.mergeAll(
        CatalogueService.layer,
        CodeSide.layer,
        PagesService.layer,
        Thumbnails.layer,
        WorkingTree.layer
      )
    ),
    // A page renamed, moved or deleted takes its comments along, in the same undo step.
    Layer.provideMerge(CommentsService.layer),
    // Comments are signed with git's user name as it is when each is made.
    Layer.provideMerge(GitService.layer),
    // One journal for every change the editor makes, documents and canvas included.
    Layer.provideMerge(EditService.layer),
    Layer.provideMerge(
      Layer.mergeAll(ProjectFramework.layer, ProjectStyleSystem.layer)
    ),
    Layer.provideMerge(RepoPaths.layer(settings))
  );

/**
 * The services every other one is built on: the settings, the storage, the log and the events,
 * and the port the server listens on. None of them needs a project.
 */
export const Foundation = ProfileService.layer.pipe(
  Layer.provideMerge(SnapshotStore.layer),
  Layer.provideMerge(Screenshots.layer),
  Layer.provideMerge(SettingsService.layer),
  Layer.provideMerge(SetupService.layer),
  Layer.provideMerge(Storage.layer),
  Layer.provideMerge(AppLog.layer),
  Layer.provideMerge(EventBus.layer),
  Layer.provideMerge(ListenPort.layer)
);

/**
 * The agent threads, on what they are given: the briefing, the slash commands, the launcher
 * and its sandbox, and the project. The server gives them its own; a test of threads may give
 * stand-ins.
 */
export const ThreadsLayer = ThreadService.layer.pipe(
  Layer.provideMerge(ThreadSessions.layer),
  Layer.provideMerge(Checkpoints.layer),
  Layer.provideMerge(AgentDiscovery.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      ThreadStore.layer,
      AgentConfigs.layer,
      ChatPreferences.layer,
      McpAccess.layer
    )
  )
);

/** Application services, with the adapters given. Each is built once and shared by every route. */
export const ApplicationLayer = <Agents>(adapters: Adapters<Agents>) =>
  SetupSteps.layer.pipe(
    // A step of the setup starts with its thread, so its runner sits above the threads.
    Layer.provideMerge(Snapshots.layer),
    Layer.provideMerge(ThreadsLayer),
    // The briefing says what the sandbox allows, so it is built on it.
    Layer.provideMerge(
      Layer.mergeAll(ProjectBriefing.layer, SlashCommands.layer)
    ),
    // The handoff tool asks for tasks too; the tasks read the setup and the sync's plan, and
    // the sync reads the setup.
    Layer.provideMerge(AgentTasks.layer),
    Layer.provideMerge(DesignSystemSyncService.layer),
    Layer.provideMerge(DesignSystemSetupService.layer),
    Layer.provideMerge(adapters.agents),
    Layer.provideMerge(ProjectManager.layer(projectLayer)),
    Layer.provideMerge(Foundation)
  );
