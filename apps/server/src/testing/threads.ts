/**
 * The thread services in-process, for a test that plays the agent (`scripted-agents.ts`): the thread
 * services as the composition root builds them (`ThreadsLayer`), with the tests' agents, on a
 * fixture folder and a home of their own, without the HTTP server, the preview or the project's
 * other services. The briefing and the slash commands are
 * stand-ins: the briefing says which purpose it was asked for, and a command `/name rest` stands
 * for the task `taskFor` writes, with the purpose of the request it reads as; `/hold` is written
 * only once the test lets it go (`HeldTask`). Two agents are configured, `scripted` and `other`.
 */
import { NodeServices } from "@effect/platform-node";
import { NotConfigured } from "@ultrapaint/contracts/errors";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { parseCommand, taskPurpose } from "@ultrapaint/contracts/tasks";
import type {
  PromptInput,
  Thread,
  ThreadItem,
} from "@ultrapaint/contracts/threads";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Queue,
  Scope,
  Stream,
} from "effect";
import { Foundation, ThreadsLayer } from "../composition.ts";
import { ServerConfig } from "../config.ts";
import { EventBus } from "../events.ts";
import { ListenPort } from "../listen-port.ts";
import { OpenProject, type ProjectServices } from "../project.ts";
import { DesignFiles } from "../services/design-files.ts";
import { RepoPaths } from "../services/repo-paths.ts";
import { AgentSandbox } from "../services/threads/agent-sandbox.ts";
import { ProjectBriefing } from "../services/threads/briefing.ts";
import { SlashCommands } from "../services/threads/commands.ts";
import {
  type ThreadSession,
  ThreadSessions,
} from "../services/threads/thread-session.ts";
import { ThreadStore } from "../services/threads/thread-store.ts";
import { WorkingTree } from "../services/working-tree.ts";
import { makeFixture } from "./harness.ts";
import { TEST_PORT } from "./project.ts";
import { ScriptedAgents } from "./scripted-agents.ts";

/** Where the test's threads work: the fixture folder, and the home their state is kept in. */
export class ThreadFixture extends Context.Service<
  ThreadFixture,
  { readonly home: string; readonly repo: string }
>()("ultrapaint/server/testing/ThreadFixture") {}

/**
 * The briefing's stand-in: `<ultrapaint>` and the purpose it was asked for, and whether its
 * agent has the editor's tools.
 */
export const briefingFor = (purpose: string, tools = false) =>
  `<ultrapaint>\nThe project, for a ${purpose} thread${tools ? ", with the editor's tools" : ""}.\n</ultrapaint>`;

/**
 * The fixture's project closed, as saving other settings closes it, and opened again: every
 * session of the project ends with it.
 */
export class FixtureProject extends Context.Service<
  FixtureProject,
  { readonly close: Effect.Effect<void>; readonly reopen: Effect.Effect<void> }
>()("ultrapaint/server/testing/FixtureProject") {}

/**
 * The project as threads use it: the fixture's paths, its working tree and what changed in its
 * designs (only what the threads tell, no watcher), open from the start;
 * `FixtureProject` closes and reopens it. A project service threads do not use is not there.
 */
const projectOf = (repo: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const managerScope = yield* Effect.scope;
      const services = yield* Layer.build(
        Layer.mergeAll(WorkingTree.layer, DesignFiles.layerTest).pipe(
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
      const use = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
        Effect.suspend(
          (): Effect.Effect<A, E | NotConfigured> =>
            current
              ? Effect.provideContext(
                  effect,
                  // Only what threads use; any other service is missing, and says so.
                  services as Context.Context<unknown> as Context.Context<ProjectServices>
                )
              : Effect.fail(notConfigured)
        );
      return Context.make(
        OpenProject,
        OpenProject.of({
          scope: Effect.suspend(() =>
            current ? Effect.succeed(current) : Effect.fail(notConfigured)
          ),
          service: (key) => (f) => use(Effect.flatMap(key, f)),
          use,
        })
      ).pipe(
        Context.add(
          FixtureProject,
          FixtureProject.of({
            close,
            // Whatever the settings, the fixture's project opens again.
            reopen: Effect.andThen(
              close,
              Effect.map(Scope.fork(managerScope), (scope) => {
                current = scope;
              })
            ),
          })
        )
      );
    })
  );

const COMMAND_RE = /^\/([\w-]+)(?:\s+([\s\S]*))?$/;

/** The task `/name rest` stands for in these tests, for an agent with the editor's tools or not. */
export const taskFor = (name: string, rest = "", tools = false) =>
  `<ultrapaint-task command="${name}"${tools ? " tools" : ""}>\n${rest}\n</ultrapaint-task>`;

/**
 * A prompt held while it is accepted: `/hold`'s task is written once the test lets it go
 * (`release`), and `reached` says the prompt has come that far.
 */
export class HeldTask extends Context.Service<
  HeldTask,
  {
    readonly reached: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  }
>()("ultrapaint/server/testing/HeldTask") {}

const held = Layer.effect(
  HeldTask,
  Effect.all({
    reached: Deferred.make<void>(),
    release: Deferred.make<void>(),
  })
);

const commands = Layer.effect(
  SlashCommands,
  Effect.map(HeldTask, ({ reached, release }) =>
    SlashCommands.of({
      expand: Effect.fnUntraced(function* (
        text: string,
        options: { readonly tools?: boolean } = {}
      ) {
        const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
        const name = match?.[1];
        if (name === undefined) {
          return null;
        }
        if (name === "hold") {
          yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(release);
        }
        const parsed = parseCommand(text);
        return {
          purpose:
            parsed?._tag === "Request"
              ? taskPurpose(parsed.request)
              : ("design" as const),
          text: taskFor(name, match?.[2]?.trim(), options.tools),
        };
      }),
      list: [],
    })
  )
);

const briefing = Layer.succeed(
  ProjectBriefing,
  ProjectBriefing.of({
    text: (purpose, options = {}) =>
      Effect.succeed(briefingFor(purpose, options.tools)),
  })
);

/** What `scripted`'s configuration sends to stop a sandbox of its own, where it is confined. */
export const SCRIPTED_SANDBOX_META = { scripted: { sandbox: false } };

/**
 * Thread services on a fresh fixture, with the agents the test plays. Build one per test.
 * `sandboxed` says the machine confines its agents: nothing is wrapped, but the agents are told
 * what their configuration says to a confined one. `mcp` gives them the editor's MCP server, at
 * the address of a server that says it listens on `TEST_PORT`, where nothing does.
 */
export const threadTest = (
  options: { readonly mcp?: boolean; readonly sandboxed?: boolean } = {}
) =>
  Layer.unwrap(
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
          JSON.stringify({
            args: [],
            command: id,
            id,
            name,
            ...(id === "scripted" && { sandboxMeta: SCRIPTED_SANDBOX_META }),
          })
        );
      }
      // Where the editor's MCP server is said to be: no agent of a test connects to it.
      const listening = Layer.effectDiscard(
        Effect.flatMap(ListenPort, (port) => port.listening(TEST_PORT))
      );
      return Layer.mergeAll(ThreadsLayer, listening).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            briefing,
            Layer.provideMerge(commands, held),
            ScriptedAgents.layer,
            options.sandboxed
              ? AgentSandbox.layerTestConfined
              : AgentSandbox.layerTest
          )
        ),
        Layer.provideMerge(projectOf(repo)),
        Layer.provideMerge(Foundation),
        Layer.provideMerge(
          ServerConfig.layerTest({
            briefing: true,
            cwd: repo,
            machine: { home },
            mcp: options.mcp === true,
            storage: { home, mode: "managed" },
            userDir: home,
          })
        ),
        Layer.provideMerge(Layer.succeed(ThreadFixture, { home, repo }))
      );
    })
  ).pipe(Layer.provideMerge(NodeServices.layer));

/** What a test does to a thread, through its session, as the server's handlers do. */
export const onThread = <A, E>(
  threadId: string,
  act: (session: ThreadSession) => Effect.Effect<A, E>
) =>
  Effect.flatMap(ThreadSessions, (sessions) =>
    Effect.flatMap(sessions.of(threadId), act)
  );

/** A prompt sent to its thread. */
export const promptThread = (input: PromptInput) =>
  onThread(input.threadId, (session) => session.prompt(input));

/** Thread services on a machine without a sandbox. */
export const ThreadTest = threadTest();

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
      // Subscribed before the first look, so that no change slips between the two: started at
      // once, the fiber has subscribed by the time the fork returns (a pull would subscribe
      // only when first pulled, after the look).
      const changed = yield* Queue.sliding<void>(1);
      yield* Effect.forkScoped(
        Stream.runForEach(events.subscribe("agent"), () =>
          Queue.offer(changed, undefined)
        ),
        { startImmediately: true }
      );
      for (;;) {
        const thread = yield* store.get(threadId);
        const items = [...(yield* store.items(threadId))];
        if (thread && done(thread, items)) {
          return { items, thread };
        }
        yield* Queue.take(changed);
      }
    })
  );
});
