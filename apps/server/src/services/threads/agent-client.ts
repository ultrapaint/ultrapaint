/**
 * What a thread's agent asks of the editor while it works, as an ACP client answers it: the
 * permissions and forms it waits on go to the thread's cards (`pending-cards.ts`), and its file
 * and terminal calls are confined to the repository, its terminals to the agent's own sandbox.
 * Its session updates are the thread's, which keeps the turn they belong to. The launcher makes
 * the handlers for each launch (`agent-launcher.ts`); a thread gives it a small host.
 */
import type { AcpHandlers } from "@ultrapaint/acp/acp-agent";
import { hostError, ResourceNotFound } from "@ultrapaint/acp/errors";
import type { AgentLaunch } from "@ultrapaint/acp/sandbox";
import { makeTerminalManager } from "@ultrapaint/acp/terminal-manager";
import { ForbiddenPath } from "@ultrapaint/contracts/errors";
import { TERMINAL_TAIL } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Path, type Scope } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { ServerConfig } from "../../config.ts";
import type { RepoPaths } from "../repo-paths.ts";

/** What a thread gives the agent it launches: where it works, and where its news goes. */
export interface AgentHost {
  /** The permissions and forms the agent waits on: the thread's cards. */
  readonly cards: Pick<AcpHandlers, "onElicitation" | "onPermission">;
  /** A terminal the agent waited on or let go of: the tail of its output, to keep. */
  readonly onTerminalEnd: (
    terminalId: string,
    output: string
  ) => Effect.Effect<void>;
  /** Output of a terminal as it arrives, for the editor to follow. */
  readonly onTerminalOutput: (
    terminalId: string,
    chunk: string
  ) => Effect.Effect<void>;
  /** Every session update, in order. */
  readonly onUpdate: AcpHandlers["onUpdate"];
  readonly paths: RepoPaths["Service"];
  /**
   * A file the editor wrote for the agent, by its path in the repository, told to whoever follows
   * the files (`DesignFiles`): the editors, and the modules that own the file's kind.
   */
  readonly wrote: (file: string, content: string) => Effect.Effect<void>;
}

export const makeAgentClient = Effect.fnUntraced(function* () {
  const log = yield* AppLog;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { machine } = yield* ServerConfig;
  const writeAtomic = makeWriteAtomic(fs, path);

  /**
   * What the editor does for an agent of `agentName`, for as long as the scope: a command the
   * agent asks it to run goes through `confine`, so that it reaches no further than one the
   * agent runs itself, and `writable`, when not the whole repository, is the only directory it
   * writes for the agent: a design thread's designs directory (ADR 0030). The sandbox closes the
   * rest to the agent's own tools; this closes it to the writes the editor makes for it.
   */
  const handlersFor = Effect.fnUntraced(function* (
    host: AgentHost,
    launch: {
      readonly agentName: string;
      readonly confine: (launch: AgentLaunch) => AgentLaunch;
      readonly writable?: string | undefined;
    }
  ): Effect.fn.Return<AcpHandlers, never, Scope.Scope> {
    const { cards, onTerminalEnd, onUpdate, paths } = host;
    const { agentName, writable } = launch;
    const terminals = yield* makeTerminalManager({
      confine: launch.confine,
      env: machine.env,
      onOutput: host.onTerminalOutput,
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
    );
    /** What a terminal printed, its tail, kept once the agent is done with it. */
    const keep = (terminalId: string) =>
      terminals.output(terminalId).pipe(
        Effect.flatMap(({ output }) =>
          onTerminalEnd(terminalId, output.slice(-TERMINAL_TAIL))
        ),
        // A terminal already let go of has nothing more to keep.
        Effect.catchTag("TerminalError", () => Effect.void)
      );
    return {
      onElicitation: cards.onElicitation,
      onPermission: cards.onPermission,
      onStderr: (text) => log.log("agent", "info", `[${agentName}] ${text}`),
      onUpdate,
      readTextFile: Effect.fn("AgentClient.readTextFile")(
        function* (request) {
          const abs = yield* paths.resolve(request.path);
          const content = yield* fs.readFileString(abs).pipe(
            // The agent asked for a file that is not there: its to handle, as ACP names it.
            Effect.catchReason("PlatformError", "NotFound", () =>
              Effect.fail(
                new ResourceNotFound({
                  message: `${paths.relative(abs)} is not there`,
                  path: abs,
                })
              )
            )
          );
          if (!(request.line || request.limit)) {
            return { content };
          }
          const start = Math.max(0, (request.line ?? 1) - 1);
          const end = request.limit ? start + request.limit : undefined;
          return {
            content: content.split("\n").slice(start, end).join("\n"),
          };
        },
        Effect.mapError((error) =>
          error._tag === "ResourceNotFound" ? error : hostError(error)
        )
      ),
      terminal: {
        create: Effect.fn("AgentClient.createTerminal")(function* (request) {
          const cwd = request.cwd
            ? yield* paths.resolve(request.cwd)
            : paths.root;
          const terminalId = yield* terminals.create({
            args: request.args ?? [],
            command: request.command,
            cwd,
            env: Object.fromEntries(
              (request.env ?? []).map((e) => [e.name, e.value])
            ),
            outputByteLimit: request.outputByteLimit,
          });
          return { terminalId };
        }, Effect.mapError(hostError)),
        kill: (request) => terminals.kill(request.terminalId),
        output: (request) =>
          terminals.output(request.terminalId).pipe(Effect.mapError(hostError)),
        release: (request) =>
          Effect.andThen(
            keep(request.terminalId),
            terminals.release(request.terminalId)
          ),
        waitForExit: (request) =>
          Effect.tap(terminals.waitForExit(request.terminalId), () =>
            keep(request.terminalId)
          ).pipe(Effect.mapError(hostError)),
      },
      writeTextFile: Effect.fn("AgentClient.writeTextFile")(function* (
        request
      ) {
        const abs = yield* paths.resolve(request.path);
        // The editor writes this file, outside the sandbox that keeps `.git` read-only: an agent
        // asking it to write a git configuration or a hook would escape through git (0013).
        if (paths.relative(abs).split(path.sep).includes(".git")) {
          return yield* new ForbiddenPath({
            message: `${paths.relative(abs)} is git's own: agents do not write in .git.`,
          });
        }
        if (
          writable !== undefined &&
          abs !== writable &&
          !abs.startsWith(`${writable}${path.sep}`)
        ) {
          return yield* new ForbiddenPath({
            message: `${paths.relative(abs)} is outside the designs directory: this thread designs, and writes only ${paths.relative(writable)}. The application's code is an implement thread's (the Implement button).`,
          });
        }
        yield* writeAtomic(abs, request.content);
        yield* host.wrote(paths.relative(abs), request.content);
      }, Effect.mapError(hostError)),
    };
  });

  return { handlersFor };
});

export type AgentClient = Effect.Success<ReturnType<typeof makeAgentClient>>;
