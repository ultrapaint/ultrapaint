/**
 * What a thread's agent asks of the editor while it works, as an ACP client answers it: the
 * permissions and forms it waits on go to the thread's cards (`pending-cards.ts`), and its file
 * and terminal calls are confined to the repository. Its session updates are the thread
 * session's, which keeps the turn they belong to.
 */
import type { AcpHandlers } from "@ultrapaint/acp/acp-agent";
import { ResourceNotFound } from "@ultrapaint/acp/errors";
import type { TerminalManager } from "@ultrapaint/acp/terminal-manager";
import { ForbiddenPath } from "@ultrapaint/contracts/errors";
import { TERMINAL_TAIL } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Path } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { hashContent } from "../../hash.ts";
import type { RepoPaths } from "../repo-paths.ts";
import type { PendingCards } from "./pending-cards.ts";

export const makeAgentClient = Effect.fnUntraced(function* () {
  const log = yield* AppLog;
  const events = yield* EventBus;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeAtomic = makeWriteAtomic(fs, path);

  // ---- what the host does for the agent, but for its updates, which are the session's ----
  const handlersFor = ({
    agentName,
    cards,
    onTerminalEnd,
    paths,
    terminals,
    writable,
  }: {
    readonly agentName: string;
    readonly cards: PendingCards;
    /** A terminal the agent waited on or let go of: the tail of its output, to keep. */
    readonly onTerminalEnd: (
      terminalId: string,
      output: string
    ) => Effect.Effect<void>;
    readonly paths: RepoPaths["Service"];
    readonly terminals: TerminalManager;
    /**
     * The only directory the agent may write through the editor, when not the whole repository:
     * a design thread's designs directory (ADR 0030). The sandbox closes the rest to its own
     * tools; this closes it to the writes the editor makes for it.
     */
    readonly writable?: string | undefined;
  }): Omit<AcpHandlers, "onUpdate"> => {
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
      onElicitation: cards.elicitation,
      onPermission: cards.permission,
      onStderr: (text) => log.log("agent", "info", `[${agentName}] ${text}`),
      readTextFile: Effect.fn("ThreadService.readTextFile")(
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
        }
      ),
      terminal: {
        create: Effect.fn("ThreadService.createTerminal")(function* (request) {
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
        }),
        kill: (request) => terminals.kill(request.terminalId),
        output: (request) => terminals.output(request.terminalId),
        release: (request) =>
          Effect.andThen(
            keep(request.terminalId),
            terminals.release(request.terminalId)
          ),
        waitForExit: (request) =>
          Effect.tap(terminals.waitForExit(request.terminalId), () =>
            keep(request.terminalId)
          ),
      },
      writeTextFile: Effect.fn("ThreadService.writeTextFile")(
        function* (request) {
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
          yield* events.publish("file.changed", {
            file: paths.relative(abs),
            hash: hashContent(request.content),
          });
        }
      ),
    };
  };

  return { handlersFor };
});

export type AgentClient = Effect.Success<ReturnType<typeof makeAgentClient>>;
