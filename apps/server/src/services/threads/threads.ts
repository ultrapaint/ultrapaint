/**
 * Agent threads. Each thread owns one ACP session with the target repository as working
 * directory. Updates are projected into a transcript that the editor renders, permission
 * requests are routed to the UI, and every filesystem or terminal call the agent makes is
 * confined to the repository.
 *
 * A live session is a scope forked from the open project: closing the project, deleting the
 * thread or shutting down ends the agent process, its terminals and any pending permission.
 */
import {
  type AcpAgent,
  type AcpHandlers,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  spawnAcpAgent,
} from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import {
  makeTerminalManager,
  type TerminalManager,
} from "@ultrapaint/acp/terminal-manager";
import {
  AgentFailure,
  Conflict,
  type ForbiddenPath,
  type NotConfigured,
  NotFound,
} from "@ultrapaint/contracts/errors";
import type { PromptInput, Thread } from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Scope,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { hashContent } from "../../hash.ts";
import { makeId } from "../../ids.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { ProjectManager } from "../../project.ts";
import { GitService, type GitSnapshot } from "../git.ts";
import { RepoPaths } from "../repo-paths.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { Checkpoints } from "./checkpoints.ts";
import { ThreadStore } from "./thread-store.ts";
import {
  emptyCursor,
  mapConfigOptions,
  projectUpdate,
  type TurnCursor,
} from "./transcript.ts";

const AUTH_ERROR_RE = /auth/i;
const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;
/** Boolean options travel as strings in the editor and as booleans in ACP. */
const BOOLEAN_VALUES: Record<string, boolean | undefined> = {
  false: false,
  true: true,
};
const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

interface PendingPermission {
  readonly decision: Deferred.Deferred<RequestPermissionResponse>;
  /** What "remember this choice" is keyed by: the tool kind, else its title. */
  readonly rememberKey: string;
}

interface Live {
  readonly agent: AcpAgent;
  readonly pending: Map<string, PendingPermission>;
  readonly remembered: Map<string, string>;
  /** While a stored session is replayed by `session/load`, its updates are not new items. */
  replaying: boolean;
  readonly scope: Scope.Closeable;
  turn: TurnCursor | null;
}

interface SessionInfo {
  readonly configOptions?: unknown;
  readonly modes?: {
    readonly availableModes: readonly {
      readonly description?: string | null;
      readonly id: string;
      readonly name: string;
    }[];
    readonly currentModeId: string;
  } | null;
  readonly sessionId: string;
}

type ThreadFailure =
  | NotFound
  | NotConfigured
  | Conflict
  | ForbiddenPath
  | AgentFailure;

const agentFailure = (error: AcpError) =>
  new AgentFailure({ message: error.message });

export class ThreadService extends Context.Service<
  ThreadService,
  {
    readonly cancel: (threadId: string) => Effect.Effect<void, ThreadFailure>;
    readonly create: (
      agentId: string,
      title?: string
    ) => Effect.Effect<Thread, ThreadFailure>;
    readonly delete: (threadId: string) => Effect.Effect<void>;
    readonly prompt: (input: PromptInput) => Effect.Effect<void, ThreadFailure>;
    readonly resolvePermission: (
      threadId: string,
      requestId: string,
      optionId: string,
      remember: boolean
    ) => Effect.Effect<void, ThreadFailure>;
    readonly setConfigOption: (
      threadId: string,
      optionId: string,
      value: string
    ) => Effect.Effect<void, ThreadFailure>;
    readonly setMode: (
      threadId: string,
      modeId: string
    ) => Effect.Effect<void, ThreadFailure>;
  }
>()("ultrapaint/server/ThreadService") {
  static readonly layer = Layer.effect(
    ThreadService,
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const agents = yield* AgentConfigs;
      const checkpoints = yield* Checkpoints;
      const project = yield* ProjectManager;
      const events = yield* EventBus;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serviceScope = yield* Effect.scope;
      const writeAtomic = makeWriteAtomic(fs, path);
      const live = new Map<string, Live>();
      // One session start per thread, however many calls ask for it at once.
      const starting = makeKeyedLock();

      const newItemId = makeId("item");
      const currentPaths = project.use(Effect.map(RepoPaths, (paths) => paths));

      // ---- transcript ----
      const onUpdate = Effect.fnUntraced(function* (
        threadId: string,
        session: Live,
        update: Parameters<typeof projectUpdate>[0]
      ) {
        if (session.replaying) {
          return;
        }
        // Ids are drawn up front because the projection itself is pure and synchronous.
        const ids = [yield* newItemId];
        const actions = projectUpdate(update, {
          hasItem: (itemId) => store.hasItem(threadId, itemId),
          newId: () => ids.pop() ?? `item_${ids.length}`,
          now: yield* Clock.currentTimeMillis,
          turn: session.turn,
        });
        for (const action of actions) {
          if (action.type === "push") {
            yield* store.push(threadId, action.item);
          } else if (action.type === "patch") {
            yield* store.patchItem(threadId, action.itemId, action.patch);
          } else {
            yield* store.update(threadId, action.patch);
          }
        }
      });

      // ---- permissions ----
      const onPermission = Effect.fnUntraced(function* (
        threadId: string,
        session: Live,
        request: RequestPermissionRequest
      ) {
        const { toolCall } = request;
        const rememberKey = toolCall.kind ?? toolCall.title ?? "tool";
        const remembered = session.remembered.get(rememberKey);
        if (
          remembered &&
          request.options.some((o) => o.optionId === remembered)
        ) {
          return {
            outcome: { optionId: remembered, outcome: "selected" },
          } satisfies RequestPermissionResponse;
        }
        const requestId = yield* makeId("perm");
        const detail = [
          ...(toolCall.locations ?? []).map((l) => l.path),
          ...(toolCall.rawInput
            ? [JSON.stringify(toolCall.rawInput).slice(0, 500)]
            : []),
        ].join("\n");
        const decision = yield* Deferred.make<RequestPermissionResponse>();
        session.pending.set(requestId, { decision, rememberKey });
        yield* store.push(threadId, {
          at: yield* Clock.currentTimeMillis,
          decision: null,
          id: requestId,
          kind: "permission",
          options: request.options.map((o) => ({
            kind: o.kind,
            name: o.name,
            optionId: o.optionId,
          })),
          requestId,
          title: toolCall.title ?? "Permission request",
          ...(detail ? { detail } : {}),
          ...(toolCall.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
        });
        const response = yield* Deferred.await(decision);
        session.pending.delete(requestId);
        const chosen =
          response.outcome.outcome === "selected"
            ? response.outcome.optionId
            : "cancelled";
        yield* store.patchItem(threadId, requestId, (i) =>
          i.kind === "permission" ? { ...i, decision: chosen } : i
        );
        return response;
      });

      // ---- what the host does for the agent ----
      const handlersFor = (
        threadId: string,
        agentName: string,
        paths: RepoPaths["Service"],
        terminals: TerminalManager,
        session: () => Live
      ): AcpHandlers => ({
        onPermission: (request) => onPermission(threadId, session(), request),
        onStderr: (text) => log.log("agent", "info", `[${agentName}] ${text}`),
        readTextFile: Effect.fnUntraced(function* (request) {
          const abs = yield* paths.resolve(request.path);
          const content = yield* fs.readFileString(abs);
          if (!(request.line || request.limit)) {
            return { content };
          }
          const start = Math.max(0, (request.line ?? 1) - 1);
          const end = request.limit ? start + request.limit : undefined;
          return { content: content.split("\n").slice(start, end).join("\n") };
        }),
        terminal: {
          create: Effect.fnUntraced(function* (request) {
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
          release: (request) => terminals.release(request.terminalId),
          waitForExit: (request) => terminals.waitForExit(request.terminalId),
        },
        writeTextFile: Effect.fnUntraced(function* (request) {
          const abs = yield* paths.resolve(request.path);
          yield* writeAtomic(abs, request.content);
          yield* events.publish("file.changed", {
            file: paths.relative(abs),
            hash: hashContent(request.content),
          });
        }),
      });

      // ---- session lifecycle ----
      const stop = (threadId: string) =>
        Effect.suspend(() => {
          const session = live.get(threadId);
          live.delete(threadId);
          return session ? Scope.close(session.scope, Exit.void) : Effect.void;
        });

      /** Loads the stored session when the agent can, otherwise starts a new one. */
      const openSession = Effect.fnUntraced(function* (
        session: Live,
        storedSessionId: string | undefined,
        canLoad: boolean,
        root: string
      ) {
        if (storedSessionId && canLoad) {
          session.replaying = true;
          const loaded = yield* session.agent
            .loadSession(storedSessionId, root)
            .pipe(
              Effect.map(
                (info): SessionInfo => ({
                  ...(info as Omit<SessionInfo, "sessionId"> | undefined),
                  sessionId: storedSessionId,
                })
              ),
              // An expired or unknown session is not an error for the user: start fresh.
              Effect.catch((error) =>
                Effect.as(
                  log.log(
                    "agent",
                    "warn",
                    `session load failed, starting fresh: ${error.message}`
                  ),
                  null
                )
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  session.replaying = false;
                })
              )
            );
          if (loaded) {
            return loaded;
          }
        }
        return (yield* session.agent.newSession(root)) as SessionInfo;
      });

      const start = Effect.fnUntraced(function* (threadId: string) {
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        const projectScope = yield* project.scope;
        const paths = yield* currentPaths;
        const config = yield* agents.get(thread.agentId);
        yield* store.update(threadId, { error: undefined, status: "starting" });

        const scope = yield* Scope.fork(projectScope);
        const holder: { session: Live | null } = { session: null };
        const boot = Effect.gen(function* () {
          const terminals = yield* makeTerminalManager;
          const agent = yield* spawnAcpAgent(config, {
            cwd: paths.root,
            handlers: handlersFor(
              threadId,
              config.name,
              paths,
              terminals,
              () => holder.session as Live
            ),
          });
          const session: Live = {
            agent,
            pending: new Map(),
            remembered: new Map(),
            replaying: false,
            scope,
            turn: null,
          };
          holder.session = session;
          return session;
        }).pipe(
          Scope.provide(scope),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        );
        const session = yield* boot.pipe(
          Effect.mapError(agentFailure),
          Effect.onError(() => Scope.close(scope, Exit.void))
        );
        live.set(threadId, session);

        // Whoever closes the scope: nobody waits on a permission forever, and a thread that
        // was mid-turn does not stay "running".
        yield* Scope.addFinalizer(
          scope,
          Effect.gen(function* () {
            for (const pending of session.pending.values()) {
              yield* Deferred.succeed(pending.decision, CANCELLED);
            }
            const current = yield* store.get(threadId);
            if (current && current.status !== "error") {
              yield* store.update(threadId, { status: "idle" });
            }
          })
        );
        yield* session.agent.updates.pipe(
          Stream.runForEach((n) => onUpdate(threadId, session, n.update)),
          Effect.forkIn(scope)
        );
        // An exit we did not ask for. Forked outside the session scope because it closes it.
        yield* session.agent.exited.pipe(
          Effect.flatMap(({ code, signal }) =>
            Effect.gen(function* () {
              if (live.get(threadId) !== session) {
                return;
              }
              const status = (yield* store.get(threadId))?.status;
              if (status === "running" || status === "starting") {
                yield* store.update(threadId, {
                  error: `agent exited (${signal ?? code})`,
                  status: "error",
                });
              }
              yield* stop(threadId);
            })
          ),
          Effect.forkIn(projectScope)
        );

        const negotiate = Effect.gen(function* () {
          const init = yield* session.agent.initialize;
          const canLoad = init.agentCapabilities?.loadSession === true;
          const open = openSession(
            session,
            thread.sessionId,
            canLoad,
            paths.root
          );
          const [firstAuth] = init.authMethods ?? [];
          // Some agents need authentication before a session can be created.
          return yield* open.pipe(
            Effect.catchIf(
              (error) => !!firstAuth && AUTH_ERROR_RE.test(error.message),
              () =>
                Effect.andThen(
                  session.agent.authenticate(firstAuth?.id ?? ""),
                  open
                )
            )
          );
        });
        const info = yield* negotiate.pipe(
          Effect.mapError(agentFailure),
          Effect.tapError((error) =>
            Effect.andThen(
              stop(threadId),
              store.update(threadId, { error: error.message, status: "error" })
            )
          )
        );
        yield* store.update(threadId, {
          configOptions: mapConfigOptions(info.configOptions),
          currentModeId: info.modes?.currentModeId,
          modes: info.modes?.availableModes.map((m) => ({
            id: m.id,
            name: m.name,
            ...(m.description ? { description: m.description } : {}),
          })),
          sessionId: info.sessionId,
          status: "idle",
        });
        return session;
      });

      const ensureLive = (threadId: string) =>
        starting
          .withLock(
            threadId,
            Effect.suspend(() => {
              const existing = live.get(threadId);
              return existing ? Effect.succeed(existing) : start(threadId);
            })
          )
          .pipe(Effect.withSpan("ThreadService.ensureLive"));

      const sessionOf = Effect.fnUntraced(function* (threadId: string) {
        const session = yield* ensureLive(threadId);
        const sessionId = (yield* store.get(threadId))?.sessionId;
        if (!sessionId) {
          return yield* new AgentFailure({ message: "no session" });
        }
        return { session, sessionId };
      });

      // ---- prompting ----
      const attachmentBlocks = Effect.fnUntraced(function* (
        input: PromptInput,
        paths: RepoPaths["Service"]
      ) {
        const blocks: ContentBlock[] = [{ text: input.text, type: "text" }];
        const labels: string[] = [];
        for (const a of input.attachments) {
          if (a.kind === "file") {
            const abs = yield* paths.resolve(a.path);
            // A file attached and then deleted is sent as empty rather than failing the prompt.
            const text = yield* Effect.orElseSucceed(
              fs.readFileString(abs),
              () => ""
            );
            blocks.push({
              resource: { mimeType: "text/plain", text, uri: `file://${abs}` },
              type: "resource",
            });
            labels.push(a.path);
          } else if (a.kind === "selection") {
            const abs = yield* paths.resolve(a.file);
            blocks.push(
              {
                text: `The user has selected the <${a.name}> element at ${a.file}:${a.line}:${a.col} (line ${a.line}, column ${a.col}) on the design canvas. Edits should target this element unless told otherwise.`,
                type: "text",
              },
              { name: a.file, type: "resource_link", uri: `file://${abs}` }
            );
            labels.push(`${a.name} @ ${a.file}:${a.line}`);
          } else {
            const match = a.dataUrl.match(DATA_URL_RE);
            if (match?.[1] && match[2] !== undefined) {
              blocks.push({
                data: match[2],
                mimeType: match[1],
                type: "image",
              });
            }
            labels.push(a.name);
          }
        }
        return { blocks, labels };
      });

      const runTurn = (
        threadId: string,
        session: Live,
        sessionId: string,
        blocks: ContentBlock[],
        snapshot: GitSnapshot
      ) =>
        session.agent.prompt(sessionId, blocks).pipe(
          // The response can overtake the last updates; the transcript must be complete first.
          // Bounded, so a stalled consumer cannot keep the thread "running" forever.
          Effect.tap(() =>
            Effect.timeoutOption(session.agent.drained, "5 seconds")
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                yield* store.push(threadId, {
                  at: yield* Clock.currentTimeMillis,
                  id: yield* newItemId,
                  kind: "status",
                  text: `Turn failed: ${error.message}`,
                });
                yield* store.update(threadId, {
                  error: error.message,
                  status: "error",
                });
              }),
            onSuccess: (response) =>
              Effect.gen(function* () {
                const changedFiles = yield* project
                  .use(
                    Effect.flatMap(GitService, (git) =>
                      git.changedSince(snapshot)
                    )
                  )
                  // Attribution is a nicety; a git failure must not fail the turn.
                  .pipe(Effect.orElseSucceed((): string[] => []));
                yield* store.push(threadId, {
                  at: yield* Clock.currentTimeMillis,
                  changedFiles,
                  id: yield* newItemId,
                  kind: "turn_end",
                  stopReason: response.stopReason,
                });
                yield* store.update(threadId, { status: "idle" });
              }),
          }),
          Effect.ensuring(
            Effect.sync(() => {
              session.turn = null;
            })
          )
        );

      const prompt = Effect.fn("ThreadService.prompt")(function* (
        input: PromptInput
      ) {
        const { threadId } = input;
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        if (thread.status === "running") {
          return yield* new Conflict({
            message: "the agent is still working on the previous prompt",
          });
        }
        const paths = yield* currentPaths;
        const { session, sessionId } = yield* sessionOf(threadId);
        const { blocks, labels } = yield* attachmentBlocks(input, paths);
        yield* store.push(threadId, {
          at: yield* Clock.currentTimeMillis,
          attachments: labels,
          id: yield* newItemId,
          kind: "user",
          text: input.text,
        });
        const snapshot = yield* project
          .use(Effect.flatMap(GitService, (git) => git.snapshot))
          .pipe(Effect.orElseSucceed((): GitSnapshot => new Map()));
        session.turn = emptyCursor();
        yield* checkpoints.create(
          threadId,
          `Before: ${input.text.slice(0, 60)}`
        );
        yield* store.update(threadId, { status: "running" });
        // The request returns now; the turn reports through the transcript.
        yield* Effect.forkIn(
          runTurn(threadId, session, sessionId, blocks, snapshot),
          session.scope
        );
      });

      const resolvePermission = Effect.fn("ThreadService.resolvePermission")(
        function* (
          threadId: string,
          requestId: string,
          optionId: string,
          remember: boolean
        ) {
          const session = live.get(threadId);
          const pending = session?.pending.get(requestId);
          if (!(session && pending)) {
            return yield* new NotFound({
              message: "permission request is no longer pending",
            });
          }
          if (remember) {
            session.remembered.set(pending.rememberKey, optionId);
          }
          yield* Deferred.succeed(pending.decision, {
            outcome: { optionId, outcome: "selected" },
          });
        }
      );

      const create = Effect.fn("ThreadService.create")(function* (
        agentId: string,
        title?: string
      ) {
        const agent = yield* agents.get(agentId);
        const now = yield* Clock.currentTimeMillis;
        const thread: Thread = {
          agentId,
          createdAt: now,
          id: yield* makeId("thread"),
          status: "starting",
          title: title ?? `${agent.name} thread`,
          updatedAt: now,
        };
        yield* store.add(thread);
        // The editor gets the thread at once; the session comes up behind it.
        yield* ensureLive(thread.id).pipe(
          Effect.catch((error) =>
            store.update(thread.id, { error: error.message, status: "error" })
          ),
          Effect.forkIn(serviceScope)
        );
        return thread;
      });

      return ThreadService.of({
        cancel: Effect.fn("ThreadService.cancel")(function* (threadId: string) {
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          if (!(session && sessionId)) {
            return;
          }
          yield* store.update(threadId, { status: "cancelling" });
          // The agent ends the turn itself and answers the prompt with `cancelled`.
          yield* Effect.mapError(session.agent.cancel(sessionId), agentFailure);
        }),
        create,
        delete: (threadId) =>
          Effect.andThen(stop(threadId), store.remove(threadId)),
        prompt,
        resolvePermission,
        setConfigOption: Effect.fn("ThreadService.setConfigOption")(function* (
          threadId: string,
          optionId: string,
          value: string
        ) {
          const { session, sessionId } = yield* sessionOf(threadId);
          const parsed = BOOLEAN_VALUES[value] ?? value;
          const response = (yield* Effect.mapError(
            session.agent.setConfigOption(sessionId, optionId, parsed),
            agentFailure
          )) as { configOptions?: unknown } | undefined;
          const current = (yield* store.get(threadId))?.configOptions;
          yield* store.update(threadId, {
            configOptions:
              mapConfigOptions(response?.configOptions) ??
              current?.map((o) =>
                o.id === optionId ? { ...o, currentValue: value } : o
              ),
          });
        }),
        setMode: Effect.fn("ThreadService.setMode")(function* (
          threadId: string,
          modeId: string
        ) {
          const { session, sessionId } = yield* sessionOf(threadId);
          yield* Effect.mapError(
            session.agent.setMode(sessionId, modeId),
            agentFailure
          );
          yield* store.update(threadId, { currentModeId: modeId });
        }),
      });
    })
  );
}
