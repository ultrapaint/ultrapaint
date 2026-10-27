/**
 * `AgentTasks` in-process, for a test that reads the tasks an agent would be given: the project
 * services the server opens on a fixture folder (`makeFixture`: a designs package with a Home
 * page, a component in `ui/`), with the setup and the sync, and the server started with the
 * editor's MCP server or without it. No HTTP server, no threads, no preview.
 */
import { NodeServices } from "@effect/platform-node";
import {
  defaultSettings,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer } from "effect";
import { AppLog } from "../app-log.ts";
import { ServerConfig } from "../config.ts";
import { EventBus } from "../events.ts";
import { ListenPort } from "../listen-port.ts";
import { PreviewProxy } from "../preview-proxy.ts";
import { ProjectManager } from "../project.ts";
import { DesignSystemSetupService } from "../services/design-system-setup.ts";
import { DesignSystemSyncService } from "../services/design-system-sync.ts";
import { ProfileService } from "../services/profile.ts";
import { Screenshots } from "../services/screenshots.ts";
import { SettingsService } from "../services/settings.ts";
import { SnapshotStore } from "../services/snapshot-store.ts";
import { Storage } from "../services/storage.ts";
import { AgentTasks } from "../services/threads/tasks.ts";
import { makeFixture } from "./harness.ts";

/** The fixture the tasks are read on, and the settings it was opened with. */
export class TaskFixture extends Context.Service<
  TaskFixture,
  {
    readonly repo: string;
    /** Opens the project again with these settings changed, as saving them does. */
    readonly reopen: (changes: Partial<Settings>) => Effect.Effect<void>;
  }
>()("ultrapaint/server/testing/TaskFixture") {}

/** The tasks module on a fresh fixture, opened. Build one per test, or per group that shares it. */
export const TasksTest = (options: { readonly mcp: boolean }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
      const repo = yield* makeFixture({ git: false });
      const settings: Settings = {
        ...defaultSettings(repo),
        designsDir: "designs",
      };
      const opened = Layer.effect(
        TaskFixture,
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          yield* project.open(settings);
          return TaskFixture.of({
            reopen: (changes) => project.open({ ...settings, ...changes }),
            repo,
          });
        })
      );
      return opened.pipe(
        Layer.provideMerge(AgentTasks.layer),
        Layer.provideMerge(DesignSystemSyncService.layer),
        Layer.provideMerge(DesignSystemSetupService.layer),
        Layer.provideMerge(ProjectManager.layer),
        // In the order the server builds them: each on the ones below it.
        Layer.provideMerge(ProfileService.layer),
        Layer.provideMerge(SnapshotStore.layer),
        Layer.provideMerge(Screenshots.layer),
        Layer.provideMerge(SettingsService.layer),
        Layer.provideMerge(Storage.layer),
        Layer.provideMerge(AppLog.layer),
        Layer.provideMerge(EventBus.layer),
        Layer.provideMerge(ListenPort.layer),
        Layer.provideMerge(PreviewProxy.layer),
        Layer.provideMerge(
          ServerConfig.layerTest({
            cwd: repo,
            machine: { home },
            mcp: options.mcp,
            storage: { home, mode: "managed" },
            userDir: home,
          })
        )
      );
    })
  ).pipe(Layer.provideMerge(NodeServices.layer));
