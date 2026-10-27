/**
 * `ThreadService` in-process, for a test that plays the agent (`scripted-agents.ts`): the thread
 * services the server builds, on a fixture folder and a home of their own, without the HTTP
 * server, the preview or the project's other services. The briefing and the slash commands are
 * stand-ins: the briefing says which purpose it was asked for, and `/name rest` stands for the
 * task `taskFor` writes. Two agents are configured, `scripted` and `other`.
 */
import { NodeServices } from "@effect/platform-node";
import { NotConfigured } from "@ultrapaint/contracts/errors";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import {
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Scope,
  Stream,
} from "effect";
import { AppLog } from "../app-log.ts";
import { ServerConfig } from "../config.ts";
import { EventBus } from "../events.ts";
import { ListenPort } from "../listen-port.ts";
import { ProjectManager, type ProjectServices } from "../project.ts";
import { McpAccess } from "../services/mcp/access.ts";
import { RepoPaths } from "../services/repo-paths.ts";
import { Storage } from "../services/storage.ts";
import { AgentConfigs } from "../services/threads/agent-configs.ts";
import { AgentDiscovery } from "../services/threads/agent-discovery.ts";
import { AgentSandbox } from "../services/threads/agent-sandbox.ts";
import { ProjectBriefing } from "../services/threads/briefing.ts";
import { ChatPreferences } from "../services/threads/chat-preferences.ts";
import { Checkpoints } from "../services/threads/checkpoints.ts";
import { SlashCommands } from "../services/threads/commands.ts";
import { ThreadStore } from "../services/threads/thread-store.ts";
import { ThreadService } from "../services/threads/threads.ts";
import { WorkingTree } from "../services/working-tree.ts";
import { makeFixture } from "./harness.ts";
import { ScriptedAgents } from "./scripted-agents.ts";

/** Where the test's threads work: the fixture folder, and the home their state is kept in. */
export class ThreadFixture extends Context.Service<
  ThreadFixture,
  { readonly home: string; readonly repo: string }
>()("ultrapaint/server/testing/ThreadFixture") {}

/** The briefing's stand-in: `<ultrapaint>` and the purpose it was asked for. */
export const briefingFor = (purpose: string) =>
  `<ultrapaint>\nThe project, for a ${purpose} thread.\n</ultrapaint>`;

/**
 * The project as threads use it: the fixture's paths and its working tree, open from the start.
 * `close` ends its scope, and every session with it, and `open` opens it again, as saving the
 * settings does. A project service threads do not use is not there.
 */
const projectOf = (repo: string) =>
  Layer.effect(
    ProjectManager,
    Effect.gen(function* () {
      const managerScope = yield* Effect.scope;
      const services = yield* Layer.build(
        WorkingTree.layer.pipe(
          Layer.provideMerge(
            RepoPaths.layer({ ...defaultSettings(repo), designsDir: "designs" })
          )
        )
      );
      let current: Scope.Closeable | null = yield* Scope.fork(managerScope);
      const notConfigured = new NotConfigured({
        message: "no target repository configured",
      });
      const close = Effect.suspend(() => {
        const open = current;
        current = null;
        return open ? Scope.close(open, Exit.void) : Effect.void;
      });
      return ProjectManager.of({
        close,
        info: Effect.die(new Error("thread tests have no project info")),
        open: () =>
          Effect.andThen(
            close,
            Effect.map(Scope.fork(managerScope), (scope) => {
              current = scope;
            })
          ),
        publishInfo: Effect.void,
        scope: Effect.suspend(() =>
          current ? Effect.succeed(current) : Effect.fail(notConfigured)
        ),
        use: <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
          Effect.suspend(
            (): Effect.Effect<A, E | NotConfigured> =>
              current
                ? Effect.provideContext(
                    effect,
                    // Only what threads use; any other service is missing, and says so.
                    services as Context.Context<unknown> as Context.Context<ProjectServices>
                  )
                : Effect.fail(notConfigured)
          ),
      });
    })
  );

const COMMAND_RE = /^\/([\w-]+)(?:\s+([\s\S]*))?$/;

/** The task `/name rest` stands for in these tests. */
export const taskFor = (name: string, rest = "") =>
  `<ultrapaint-task command="${name}">\n${rest}\n</ultrapaint-task>`;

const commands = Layer.succeed(
  SlashCommands,
  SlashCommands.of({
    expand: (text) =>
      Effect.sync(() => {
        const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
        const name = match?.[1];
        return name === undefined ? null : taskFor(name, match?.[2]?.trim());
      }),
    list: [],
  })
);

const briefing = Layer.succeed(
  ProjectBriefing,
  ProjectBriefing.of({
    text: (purpose) => Effect.succeed(briefingFor(purpose)),
  })
);

/** Thread services on a fresh fixture, with the agents the test plays. Build one per test. */
export const ThreadTest = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const repo = yield* makeFixture({ git: false });
    yield* fs.makeDirectory(path.join(home, "agents"));
    for (const [id, name] of [
      ["scripted", "Scripted"],
      ["other", "Other"],
    ]) {
      yield* fs.writeFileString(
        path.join(home, "agents", `${id}.json`),
        // Never run: the launcher plays the agent.
        JSON.stringify({ args: [], command: id, id, name })
      );
    }
    return ThreadService.layer.pipe(
      Layer.provideMerge(Checkpoints.layer),
      Layer.provideMerge(AgentDiscovery.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          ThreadStore.layer,
          AgentConfigs.layer,
          ChatPreferences.layer,
          briefing,
          McpAccess.layer,
          commands
        )
      ),
      Layer.provideMerge(
        Layer.mergeAll(ScriptedAgents.layer, AgentSandbox.layerTest)
      ),
      Layer.provideMerge(projectOf(repo)),
      Layer.provideMerge(AppLog.layer),
      Layer.provideMerge(
        Layer.mergeAll(Storage.layer, EventBus.layer, ListenPort.layer)
      ),
      Layer.provideMerge(
        ServerConfig.layerTest({
          briefing: true,
          cwd: repo,
          machine: { home },
          storage: { home, mode: "managed" },
          userDir: home,
        })
      ),
      Layer.provideMerge(Layer.succeed(ThreadFixture, { home, repo }))
    );
  })
).pipe(Layer.provideMerge(NodeServices.layer));

/** What a test built on `ThreadTest` can ask for. */
export type ThreadTestServices = Layer.Success<typeof ThreadTest>;

/**
 * The thread and a copy of its transcript once `done` holds of them, looked at again each time
 * the store publishes a change: no clock, so it suits a test on `TestClock`.
 */
export const threadWhen = Effect.fnUntraced(function* (
  threadId: string,
  done: (thread: Thread, items: readonly ThreadItem[]) => boolean
) {
  const store = yield* ThreadStore;
  const events = yield* EventBus;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      // Subscribed before the first look, so that no change slips between the two.
      const changes = yield* Stream.toPull(events.subscribe("agent"));
      for (;;) {
        const thread = yield* store.get(threadId);
        const items = [...(yield* store.items(threadId))];
        if (thread && done(thread, items)) {
          return { items, thread };
        }
        yield* Effect.orDie(changes);
      }
    })
  );
});
