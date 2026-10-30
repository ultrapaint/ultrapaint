/**
 * The server's services in-process, a project open on a fixture: what `server.ts` serves, built
 * by the same composition root with the tests' adapters. The agents are the ones a test plays
 * (`ScriptedAgents`). No
 * HTTP server and no socket: a test asks a service for what it wants, and calls the editor's MCP
 * tools as an agent's call reaches them, with `callTool`. The server says it listens on
 * `TEST_PORT`, so a thread's MCP address is known and its prompts reach the scripted agent.
 */
import { NodeServices } from "@effect/platform-node";
import {
  defaultSettings,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import type { Tool, Toolkit } from "effect/ai";
import { type Adapters, ApplicationLayer } from "../composition.ts";
import { ServerConfig } from "../config.ts";
import { ListenPort } from "../listen-port.ts";
import { ProjectManager } from "../project.ts";
import { DesignFiles } from "../services/design-files.ts";
import { CallingThread } from "../services/mcp/access.ts";
import { ToolkitHandlers } from "../services/mcp/route.ts";
import { AgentSandbox } from "../services/threads/agent-sandbox.ts";
import { makeFixture } from "./harness.ts";
import { ScriptedAgents } from "./scripted-agents.ts";

/** The port a test's server says it listens on: nothing does, and no scripted agent connects. */
export const TEST_PORT = 1;

/**
 * The tests' adapters: agents the test plays, no sandbox, and the designs' changes the journal
 * and the test tell of (`DesignFiles.report`), no watcher.
 */
export const TestAdapters = {
  agents: Layer.mergeAll(ScriptedAgents.layer, AgentSandbox.layerTest),
  designFiles: DesignFiles.layerTest,
} satisfies Adapters<ScriptedAgents | AgentSandbox>;

/** The project the test opened: its folder, its home, and the settings it was opened with. */
export class ProjectFixture extends Context.Service<
  ProjectFixture,
  {
    readonly home: string;
    readonly repo: string;
    /** Puts the settings with these changed in force, as saving them does. */
    readonly reopen: (changes: Partial<Settings>) => Effect.Effect<void>;
    readonly settings: Settings;
  }
>()("ultrapaint/server/testing/ProjectFixture") {}

export interface ProjectTestOptions {
  /** The file system every service is given, changed by the test: a write made to fail. */
  readonly fileSystem?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem;
  /** Files written into the fixture before the project opens, by their path in it. */
  readonly files?: Readonly<Record<string, string>>;
  /** A git repository with the fixture committed; a plain folder without. */
  readonly git?: boolean;
  /** Whether the server runs the editor's MCP server, which the tasks and briefing tell of. */
  readonly mcp?: boolean;
  /** Settings the project is opened with, over the fixture's own. */
  readonly settings?: Partial<Settings>;
  /**
   * Files written into the state directory (the home, as `managed` keeps it) before the server
   * starts, by their path in it: what an earlier version of the server left there.
   */
  readonly state?: Readonly<Record<string, string>>;
  /**
   * Where the settings are kept: a home directory's file (`managed`, the default), or nowhere,
   * an unsaved session started in the fixture (`ephemeral`). The project is opened either way,
   * with nothing saved.
   */
  readonly storage?: "managed" | "ephemeral";
  /**
   * Whether the designs directory is watched, as the server watches it: for the one test of a
   * file written by hand that the watcher must see. Without, a test tells `DesignFiles` itself.
   */
  readonly watch?: boolean;
}

/**
 * Every service of the server, with a project open on a fresh fixture (`makeFixture`: a designs
 * package with a Home page, and a file of the application's code in `ui/`) and the editor's MCP
 * tools' handlers. Build one per test, or per group that shares it.
 */
export const ProjectTest = (options: ProjectTestOptions = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
      const repo = yield* makeFixture({ git: options.git ?? false });
      const writeUnder = (
        dir: string,
        files: Readonly<Record<string, string>>
      ) =>
        Effect.forEach(
          Object.entries(files),
          ([file, content]) =>
            Effect.andThen(
              fs.makeDirectory(path.dirname(path.join(dir, file)), {
                recursive: true,
              }),
              fs.writeFileString(path.join(dir, file), content)
            ),
          { discard: true }
        );
      yield* writeUnder(repo, options.files ?? {});
      yield* writeUnder(home, options.state ?? {});
      const settings: Settings = {
        ...defaultSettings(repo),
        designsDir: "designs",
        ...options.settings,
      };
      const opened = Layer.effect(
        ProjectFixture,
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          yield* project.apply(settings, "the test's settings");
          return ProjectFixture.of({
            home,
            reopen: (changes) =>
              project.apply({ ...settings, ...changes }, "the test's settings"),
            repo,
            settings,
          });
        })
      );
      const listening = Layer.effectDiscard(
        Effect.flatMap(ListenPort, (port) => port.listening(TEST_PORT))
      );
      return Layer.mergeAll(opened, listening).pipe(
        Layer.provideMerge(ToolkitHandlers),
        Layer.provideMerge(
          ApplicationLayer(
            options.watch
              ? { ...TestAdapters, designFiles: DesignFiles.layer }
              : TestAdapters
          )
        ),
        Layer.provideMerge(
          ServerConfig.layerTest({
            cwd: repo,
            machine: { home },
            mcp: options.mcp ?? true,
            storage:
              options.storage === "ephemeral"
                ? { mode: "ephemeral" }
                : { home, mode: "managed" },
            userDir: home,
          })
        )
      );
    })
  ).pipe(
    Layer.provideMerge(
      options.fileSystem
        ? Layer.effect(
            FileSystem.FileSystem,
            Effect.map(FileSystem.FileSystem, options.fileSystem)
          ).pipe(Layer.provideMerge(NodeServices.layer))
        : NodeServices.layer
    )
  );

/**
 * One of the editor's MCP tools, called as an agent's call reaches its handler: the parameters
 * decoded, the handler run, its answer or its failure back. `thread` is the calling thread, as
 * the token an agent connects with says; without one the call is an agent's from outside the
 * editor.
 */
export const callTool = <
  Tools extends Record<string, Tool.Any>,
  Name extends keyof Tools & string,
>(
  toolkit: Toolkit.Toolkit<Tools>,
  name: Name,
  parameters: Tool.ParametersEncoded<Tools[Name]>,
  thread?: string
) =>
  Effect.gen(function* () {
    const handlers = yield* toolkit;
    const results = yield* handlers.handle(name, parameters);
    const last = yield* Stream.runLast(results);
    if (last._tag === "None" || last.value.isFailure) {
      return yield* Effect.die(new Error(`${name} gave no answer`));
    }
    // A tool fails in the error channel (its failure mode is "error"), so what it gives is its
    // success.
    return last.value.result as Tool.Success<Tools[Name]>;
  }).pipe(Effect.provideService(CallingThread, thread));
