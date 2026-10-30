/**
 * A thread's session: what a thread is while the server runs, owned in one place. It keeps the
 * live ACP session (started with the first prompt that needs one, in a scope forked from the
 * open project, with the agent sandboxed, given its terminals and the editor's MCP server), the
 * turn (`turn.ts`: on its way to the agent, at it, or none), the queue of
 * prompts, the cards the agent waits on (`pending-cards.ts`) and the thread's status, which
 * changes only through `statusAfter`. Closing the live scope, whoever does it, ends the agent
 * process, its terminals and any card it still waits on.
 *
 * `ThreadSessions` keeps one per thread, made the first time the thread is asked for.
 */
import type {
  AcpAgent,
  ContentBlock,
  McpServerConfig,
} from "@ultrapaint/acp/acp-agent";
import {
  BASELINE,
  type Negotiated,
  promptBlock,
} from "@ultrapaint/acp/negotiated";
import {
  AgentFailure,
  Conflict,
  type ForbiddenPath,
  type NotConfigured,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type Answers,
  EDITOR_MCP_SERVER,
  isBusy,
  type PromptInput,
  type QueuedPrompt,
  type Thread,
  type ThreadItem,
  type ThreadPurpose,
  type ThreadStatus,
} from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Path,
  Queue,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { EventBus } from "../../events.ts";
import { makeId } from "../../ids.ts";
import { OpenProject } from "../../project.ts";
import { DesignFiles } from "../design-files.ts";
import { McpAccess } from "../mcp/access.ts";
import { RepoPaths } from "../repo-paths.ts";
import { type TreeStamp, WorkingTree } from "../working-tree.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentDiscovery } from "./agent-discovery.ts";
import { AgentLauncher } from "./agent-launcher.ts";
import { agentFailure, makeSessionOpener } from "./agent-session.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { Checkpoints } from "./checkpoints.ts";
import { makePendingCards, type PendingCards } from "./pending-cards.ts";
import {
  makePromptContent,
  purposeFor,
  scopeOf,
  titleOf,
  UNTITLED,
} from "./prompt-content.ts";
import { ThreadStore } from "./thread-store.ts";
import {
  mapConfigOptions,
  modeSet,
  optionsSet,
  optionValue,
} from "./transcript.ts";
import { makeTurn } from "./turn.ts";

export type ThreadFailure =
  | NotFound
  | NotConfigured
  | Conflict
  | ForbiddenPath
  | AgentFailure;

/** How long a stopped turn is waited for before what comes next goes ahead without it. */
const TURN_END_WAIT = "10 seconds";

// ---- status ----

/** What moves a thread's status. */
export type StatusEvent =
  /** A prompt opens a turn: the thread runs from here, its agent's start included. */
  | { readonly _tag: "Prompted" }
  /** The user stops the turn the agent works on; the agent ends it. */
  | { readonly _tag: "CancelAsked" }
  /** The agent was asked to stop a turn that had already ended. */
  | { readonly _tag: "CancelOutlived" }
  /** A turn is over: its end is in the transcript. */
  | { readonly _tag: "TurnEnded" }
  /** A turn, or the session it needed, went wrong. */
  | { readonly _tag: "Failed"; readonly message: string }
  /** The agent's process exited without being asked to. */
  | { readonly _tag: "AgentExited"; readonly reason: string }
  /** The session's scope closed, whoever closed it. */
  | { readonly _tag: "SessionClosed" }
  /** The thread's agent changed: the next prompt starts a session of the new one. */
  | { readonly _tag: "AgentSwitched" };

type StatusPatch = Pick<Thread, "status"> & Partial<Pick<Thread, "error">>;

/**
 * The status after an event, and the error with it; null leaves the thread as it is. A cancel
 * stops only a turn under way. A cancel that outlived its turn takes the thread out of
 * "cancelling", which nothing else would. An exit while the user stops the turn, or a session
 * closing, is not a failure, and leaves a failure shown.
 */
export const statusAfter = (
  status: ThreadStatus,
  event: StatusEvent
): StatusPatch | null => {
  switch (event._tag) {
    case "Prompted":
      return { error: undefined, status: "running" };
    case "CancelAsked":
      return isBusy(status) ? { status: "cancelling" } : null;
    case "CancelOutlived":
      return status === "cancelling" ? { status: "idle" } : null;
    case "TurnEnded":
      return { status: "idle" };
    case "Failed":
      return { error: event.message, status: "error" };
    case "AgentExited":
      return status === "running"
        ? { error: `agent exited (${event.reason})`, status: "error" }
        : null;
    case "SessionClosed":
      return status === "error" ? null : { status: "idle" };
    case "AgentSwitched":
      return { error: undefined, status: "idle" };
    default:
      return null;
  }
};

/**
 * What a prompt changes of its thread besides its status: the first one names it and says what
 * it works on, and a task that implements, in a thread whose agent has not started, makes it an
 * implement thread.
 */
const prompted = (
  thread: Thread,
  input: PromptInput,
  earlier: readonly ThreadItem[],
  purpose: ThreadPurpose | undefined
): Partial<Thread> => {
  const first = !earlier.some((i) => i.kind === "user");
  const scope = first && !thread.scope ? scopeOf(input.attachments) : null;
  return {
    ...(thread.title === UNTITLED && first
      ? { title: titleOf(input.text) }
      : {}),
    ...(scope ? { scope } : {}),
    ...(purpose && purpose !== (thread.purpose ?? "design") ? { purpose } : {}),
  };
};

// ---- the session ----

/** The live ACP session, while there is one. */
interface Live {
  readonly agent: AcpAgent;
  /** The briefing, and the recap of what came before, go out once, with the first prompt. */
  briefed: boolean;
  /** Whether the session was given the editor's MCP server: its tools are this agent's way. */
  editorMcp: boolean;
  /** What the agent said it can do, once it has. */
  negotiated: Negotiated;
  /** The session was reopened, so the agent has the conversation back. */
  resumed: boolean;
  readonly scope: Scope.Closeable;
}

export interface ThreadSession {
  /**
   * The user's answers to a question card: back to the agent waiting on its form, or, for a
   * card it did not wait on, sent as a prompt of their own, which is how any ACP agent hears.
   */
  readonly answer: (
    itemId: string,
    answers: Answers
  ) => Effect.Effect<void, ThreadFailure>;
  /** Stops the turn: one on its way to the agent there, one the agent works on by asking it. */
  readonly cancel: Effect.Effect<void, ThreadFailure>;
  /** The cards the thread's agent waits on. */
  readonly cards: PendingCards;
  /** Removes the thread: a turn on its way, an agent booting and the live session stop. */
  readonly delete: Effect.Effect<void>;
  /** Sends a prompt; while the agent works, it waits in the thread's queue instead. */
  readonly prompt: (input: PromptInput) => Effect.Effect<void, ThreadFailure>;
  /** Sends the oldest queued prompt, unless the agent works. */
  readonly sendQueued: Effect.Effect<void, ThreadFailure>;
  /** On the live session when there is one, else kept for the one the next prompt starts. */
  readonly setConfigOption: (
    optionId: string,
    value: string
  ) => Effect.Effect<void, ThreadFailure>;
  readonly setMode: (modeId: string) => Effect.Effect<void, ThreadFailure>;
  /**
   * Stops the turn and waits for it to end, `TURN_END_WAIT` at most: what comes next must not
   * run under an agent still writing. A thread without a turn is left as it is.
   */
  readonly stop: Effect.Effect<void>;
  /**
   * The agent the next prompt goes to. The session ends with the agent it belongs to; the
   * thread takes the new agent's options as its last session offered them, is idle, and its
   * transcript says it was switched. Refused while a prompt is being accepted or a turn runs:
   * the turn would lose its session, or run on a thread shown idle.
   */
  readonly switchAgent: (agentId: string) => Effect.Effect<void, ThreadFailure>;
  /** Takes a queued prompt back out; null when it was already sent. */
  readonly unqueue: (
    id: string
  ) => Effect.Effect<QueuedPrompt | null, ThreadFailure>;
}

const makeSessionFactory = Effect.fnUntraced(function* (deps: {
  /** Runs work to completion even if the caller goes away. */
  readonly detached: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly serviceScope: Scope.Scope;
}) {
  const { detached, serviceScope } = deps;
  const store = yield* ThreadStore;
  const agents = yield* AgentConfigs;
  const preferences = yield* ChatPreferences;
  const discovery = yield* AgentDiscovery;
  const launcher = yield* AgentLauncher;
  const access = yield* McpAccess;
  const checkpoints = yield* Checkpoints;
  const { mcp: mcpEnabled } = yield* ServerConfig;
  const project = yield* OpenProject;
  const events = yield* EventBus;
  const log = yield* AppLog;
  const path = yield* Path.Path;
  const opener = yield* makeSessionOpener();
  const content = yield* makePromptContent();
  const newItemId = makeId("item");
  const currentPaths = project.use(Effect.map(RepoPaths, (paths) => paths));

  return (threadId: string): ThreadSession => {
    let live: Live | null = null;
    /** The session's start under way: deleting the thread stops its agent mid-boot. */
    let booting: Fiber.Fiber<unknown, unknown> | null = null;
    // One session start, however many calls ask for it at once.
    const starting = Semaphore.makeUnsafe(1);
    // One prompt at a time, so two cannot both find the thread idle.
    const prompting = Semaphore.makeUnsafe(1);
    // Taking from the queue, one at a time: a prompt is sent once.
    const taking = Semaphore.makeUnsafe(1);
    const cards = makePendingCards(threadId, { log, newItemId, store });

    /** The only way the thread's status changes; `extra` goes with it when it does. */
    const transition = Effect.fnUntraced(function* (
      event: StatusEvent,
      extra: Partial<Thread> = {}
    ) {
      const thread = yield* store.get(threadId);
      const patch = thread ? statusAfter(thread.status, event) : null;
      if (patch) {
        yield* store.update(threadId, { ...extra, ...patch });
      }
    });
    const turn = makeTurn(threadId, {
      log,
      newItemId,
      project,
      store,
      transition: (event) => transition(event),
    });

    // ---- the live session ----
    const stopLive = Effect.suspend(() => {
      const session = live;
      live = null;
      return session ? Scope.close(session.scope, Exit.void) : Effect.void;
    });

    const startIn = Effect.fnUntraced(function* (opened: {
      scope: Scope.Closeable | null;
    }) {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      const projectScope = yield* project.scope;
      const paths = yield* currentPaths;
      const config = yield* agents.get(thread.agentId);

      const scope = yield* Scope.fork(projectScope);
      opened.scope = scope;
      // A design thread writes its designs only; an implement thread, the repository (ADR 0030).
      const writable =
        thread.purpose === "implement" ? undefined : paths.designsDir;
      // An agent names a file by absolute path; the editor knows it by its path in the
      // repository, and a path outside it is left as it came.
      const relative = (file: string) =>
        path.isAbsolute(file) ? paths.relative(file) : file;
      const agent = yield* launcher
        .launch({
          config,
          host: {
            cards: {
              onElicitation: cards.elicitation,
              onPermission: cards.permission,
            },
            onTerminalEnd: turn.keepTerminal,
            onTerminalOutput: (terminalId, chunk) =>
              events.publish("agent.terminal", { chunk, terminalId, threadId }),
            onUpdate: (n) => turn.place(n.update, relative),
            paths,
            // A project closed meanwhile has nobody following its files.
            wrote: (file, text) =>
              project
                .use(
                  Effect.flatMap(DesignFiles, (files) =>
                    files.report(file, text)
                  )
                )
                .pipe(Effect.catchTag("NotConfigured", () => Effect.void)),
          },
          root: paths.root,
          writable,
        })
        .pipe(
          Scope.provide(scope),
          Effect.mapError(agentFailure),
          Effect.onError(() => Scope.close(scope, Exit.void))
        );
      const session: Live = {
        agent,
        briefed: false,
        editorMcp: false,
        negotiated: BASELINE,
        resumed: false,
        scope,
      };
      live = session;

      // Whoever closes the scope: nobody waits on a card forever, and a thread that was
      // mid-turn does not stay "running".
      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          // The project scope can close this one directly, without going through `stopLive`.
          if (live === session) {
            live = null;
          }
          yield* cards.releaseAll;
          yield* transition({ _tag: "SessionClosed" });
        })
      );
      // An exit we did not ask for. Forked outside the session scope because it closes it.
      yield* agent.exited.pipe(
        Effect.flatMap(({ code, signal }) =>
          Effect.gen(function* () {
            if (live !== session) {
              return;
            }
            yield* transition({
              _tag: "AgentExited",
              reason: String(signal ?? code),
            });
            yield* stopLive;
          })
        ),
        Effect.forkIn(projectScope)
      );

      // The editor's own MCP server, with a token that dies with the session; the opener offers
      // it to an agent that says it reaches one over http.
      let editorMcp: McpServerConfig | null = null;
      if (mcpEnabled) {
        const token = yield* Scope.provide(access.issue(threadId), scope);
        const { header, url } = yield* access.endpoint;
        editorMcp = {
          headers: [{ name: header, value: token }],
          name: EDITOR_MCP_SERVER,
          type: "http",
          url,
        };
      }

      const ready = yield* opener.open({
        agent,
        config,
        editorMcp,
        root: paths.root,
        thread,
      });
      session.resumed = ready.resumed;
      session.negotiated = ready.negotiated;
      session.editorMcp = ready.editorMcp;
      // The status is the prompt's: the session starts inside its turn.
      yield* store.update(threadId, ready.patch);
      return session;
    });

    /**
     * Starts the session. A start that does not finish (it failed, broke, or was stopped
     * because the thread was deleted while its agent booted) closes what it opened: the agent
     * process, its terminals and its MCP token.
     */
    const start = Effect.suspend(() => {
      const opened: { scope: Scope.Closeable | null } = { scope: null };
      return startIn(opened).pipe(
        Effect.onError(() =>
          Effect.suspend(() => {
            const { scope } = opened;
            if (scope === null) {
              return Effect.void;
            }
            if (live?.scope === scope) {
              live = null;
            }
            return Scope.close(scope, Exit.void);
          })
        )
      );
    });

    const ensureLive = detached(
      starting.withPermit(
        Effect.suspend(() =>
          live
            ? Effect.succeed(live)
            : Effect.withFiber((self) => {
                booting = self;
                return start.pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      if (booting === self) {
                        booting = null;
                      }
                    })
                  )
                );
              })
        )
      )
    ).pipe(Effect.withSpan("ThreadService.ensureLive"));

    const liveSession = Effect.gen(function* () {
      const session = yield* ensureLive;
      const sessionId = (yield* store.get(threadId))?.sessionId;
      if (!sessionId) {
        return yield* new AgentFailure({ message: "no session" });
      }
      return { session, sessionId };
    });

    /** The live session and its id, when the thread has one now; nothing is started. */
    const current = Effect.map(store.get(threadId), (thread) =>
      live && thread?.sessionId
        ? { session: live, sessionId: thread.sessionId }
        : null
    );

    // ---- turns ----

    /** The agent's answer ends the turn; a turn that ended by itself sends what was queued. */
    const runTurn = (
      session: Live,
      sessionId: string,
      blocks: ContentBlock[]
    ) =>
      session.agent.prompt(sessionId, blocks).pipe(
        Effect.matchEffect({
          onFailure: (error) => turn.fail(error.message),
          onSuccess: (response) =>
            Effect.gen(function* () {
              yield* turn.end(response);
              // A turn the user stopped leaves the queue for them to send or drop.
              if (response.stopReason !== "cancelled") {
                yield* Effect.forkIn(
                  Effect.ignore(
                    Effect.suspend(() => sendQueued),
                    { log: true }
                  ),
                  serviceScope
                );
              }
            }),
        }),
        Effect.catchDefect(turn.broke),
        // Its session closed under it: nothing more of it comes.
        Effect.onInterrupt(() => turn.drop)
      );

    /**
     * A turn from the prompt to the agent: the session is started or resumed, told what it
     * needs, and the designs are checkpointed. The thread already shows as running.
     */
    const openTurn = Effect.fnUntraced(function* (
      thread: Thread,
      input: PromptInput,
      earlier: readonly ThreadItem[],
      blocks: ContentBlock[]
    ) {
      const { session, sessionId } = yield* liveSession;
      // `/init`, `/implement`: the agent is given the task, the transcript keeps what was typed.
      // Written once the session is open, for the ways this agent has (ADR 0039): the editor's
      // tools when it was given them.
      const task = yield* content.taskFor(
        thread,
        input.text,
        session.editorMcp
      );
      if (task !== null) {
        blocks[0] = { text: task, type: "text" };
      }
      if (!session.briefed) {
        session.briefed = true;
        const purpose = (yield* store.get(threadId))?.purpose ?? "design";
        blocks.unshift(
          ...(yield* content.sessionContext(
            session.resumed,
            earlier,
            purpose,
            session.editorMcp
          ))
        );
      }
      // The folder's files before the turn, by time and size, to tell after it what it changed.
      const before = yield* project
        .use(Effect.flatMap(WorkingTree, (tree) => tree.stamp))
        .pipe(Effect.orElseSucceed((): TreeStamp => new Map()));
      // Not cut short by a cancel: a checkpoint half written is worse than a late cancel.
      yield* Effect.uninterruptible(
        checkpoints.create(threadId, `Before: ${input.text.slice(0, 60)}`)
      );
      yield* turn.atAgent(before);
      yield* Effect.forkIn(
        runTurn(
          session,
          sessionId,
          // What the agent cannot take is sent as it can: a link, a note.
          blocks.map((block) => promptBlock(session.negotiated, block))
        ),
        session.scope
      );
    });

    /** Sent when the turn ends: the user need not wait to say what comes next. */
    const enqueue = Effect.fnUntraced(function* (
      thread: Thread,
      input: PromptInput
    ) {
      const queued: QueuedPrompt = {
        at: yield* Clock.currentTimeMillis,
        attachments: input.attachments,
        id: yield* newItemId,
        text: input.text,
      };
      yield* store.update(threadId, {
        queued: [...(thread.queued ?? []), queued],
      });
    });

    /** A prompt, under `prompting`. */
    const promptNow = Effect.fn("ThreadService.prompt")(function* (
      input: PromptInput
    ) {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      if (isBusy(thread.status)) {
        return yield* enqueue(thread, input);
      }
      const projectScope = yield* project.scope;
      const paths = yield* currentPaths;
      const { blocks, labels } = yield* content.attachmentBlocks(input, paths);
      // `/init`, `/implement`: the agent is given the task, the transcript keeps what was typed.
      // What a command makes the thread for is known before its session starts, which it decides.
      const purpose = purposeFor(thread, input.text);
      // A copy: the store's own list grows with the prompt about to be pushed.
      const earlier = [...(yield* store.items(threadId))];
      yield* store.push(threadId, {
        at: yield* Clock.currentTimeMillis,
        attachments: labels,
        id: yield* newItemId,
        kind: "user",
        text: input.text,
      });
      yield* transition(
        { _tag: "Prompted" },
        prompted(thread, input, earlier, purpose ?? undefined)
      );
      // The request returns now. Whatever the agent takes to start is part of the turn, and
      // the turn reports through the transcript.
      yield* turn.begin(openTurn(thread, input, earlier, blocks), projectScope);
    });

    // ---- the queue ----
    const takeQueued = Effect.fnUntraced(function* (id: string | null) {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      const queue = thread.queued ?? [];
      const taken = id === null ? queue[0] : queue.find((q) => q.id === id);
      if (!taken) {
        return null;
      }
      yield* store.update(threadId, {
        queued: queue.filter((q) => q.id !== taken.id),
      });
      return taken;
    });

    // Typed: a turn that ends sends the next prompt, which opens a turn.
    const sendQueued: Effect.Effect<void, ThreadFailure> = taking.withPermit(
      Effect.gen(function* () {
        const thread = yield* store.get(threadId);
        if (isBusy(thread?.status)) {
          return;
        }
        const next = yield* takeQueued(null);
        if (next) {
          yield* prompting.withPermit(
            promptNow({
              attachments: next.attachments,
              text: next.text,
              threadId,
            })
          );
        }
      })
    );

    // ---- what the user does ----
    const answer = Effect.fn("ThreadService.answer")(function* (
      itemId: string,
      answers: Answers
    ) {
      const text = yield* cards.answer(itemId, answers);
      if (text !== null) {
        yield* promptNow({ attachments: [], text, threadId });
      }
    });

    const cancel = Effect.gen(function* () {
      if (yield* turn.stopOpening) {
        return;
      }
      const now = yield* current;
      // Only a turn the agent is working on is stopped. One that has ended leaves the thread
      // as it is: nothing would take it out of "cancelling" again.
      if (now === null || (yield* turn.state)._tag !== "AtAgent") {
        return;
      }
      const { session, sessionId } = now;
      yield* transition({ _tag: "CancelAsked" });
      // The client answers every permission request still open with `cancelled` (ACP), and
      // will not wait for the forms it asked with either.
      yield* cards.releaseAll;
      // The agent ends the turn itself and answers the prompt with `cancelled`.
      yield* Effect.mapError(session.agent.cancel(sessionId), agentFailure);
      // Unless the turn ended on its own meanwhile, and its end has already been written.
      if ((yield* turn.state)._tag !== "AtAgent") {
        yield* transition({ _tag: "CancelOutlived" });
      }
    }).pipe(Effect.withSpan("ThreadService.cancel"));

    /** Until the thread no longer works on a turn, looked at again whenever the store changes. */
    const turnEnded = Effect.scoped(
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
        while (isBusy((yield* store.get(threadId))?.status)) {
          yield* Queue.take(changed);
        }
      })
    );

    const stop = Effect.gen(function* () {
      // An agent that cannot be asked to stop may still end its turn: it is waited for alike.
      yield* Effect.ignore(cancel, { log: true });
      yield* Effect.timeoutOption(turnEnded, TURN_END_WAIT);
    }).pipe(Effect.withSpan("ThreadService.stop"));

    const busy = () =>
      new Conflict({
        message: "the agent is still working on the previous prompt",
      });

    /** Under `prompting`, so that no prompt is half accepted while the agent changes. */
    const switchAgent = Effect.fnUntraced(function* (agentId: string) {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      if (thread.agentId === agentId) {
        return;
      }
      if (isBusy(thread.status)) {
        return yield* busy();
      }
      const agent = yield* agents.get(agentId);
      const options = yield* preferences.optionsFor(agentId);
      // A session belongs to its agent: the next one starts with the next prompt, and is told
      // what was said before it.
      yield* stopLive;
      yield* transition(
        { _tag: "AgentSwitched" },
        {
          agentCommands: undefined,
          configOptions: undefined,
          context: undefined,
          currentModeId: undefined,
          modes: undefined,
          sandboxed: undefined,
          sandboxProblem: undefined,
          ...options,
          agentId,
          sessionId: undefined,
        }
      );
      const note = {
        switchedTo: agentId,
        text: `Switched to ${agent.name}`,
      };
      const last = (yield* store.items(threadId)).at(-1);
      // Switching again before a prompt replaces the note rather than stacking another.
      if (last?.kind === "status" && last.switchedTo !== undefined) {
        yield* store.patchItem(threadId, last.id, (item) =>
          item.kind === "status" ? { ...item, ...note } : item
        );
      } else if (last) {
        yield* store.push(threadId, {
          at: yield* Clock.currentTimeMillis,
          id: yield* newItemId,
          kind: "status",
          ...note,
        });
      }
      // Its models are not known yet: they reach the thread when the agent has said.
      if (options.configOptions === undefined) {
        yield* discovery.discoverInBackground(agentId);
      }
    });

    const setConfigOption = Effect.fn("ThreadService.setConfigOption")(
      function* (optionId: string, value: string) {
        const thread = yield* store.get(threadId);
        const options = thread?.configOptions ?? [];
        const chosen = options.map((o) =>
          o.id === optionId ? { ...o, currentValue: value } : o
        );
        const now = yield* current;
        // No session yet: the choice waits for the one the next prompt starts.
        if (now === null || thread === undefined) {
          yield* store.update(threadId, { configOptions: chosen });
          return;
        }
        const response = yield* Effect.mapError(
          now.session.agent.setConfigOption(
            now.sessionId,
            optionId,
            optionValue(
              options.find((o) => o.id === optionId),
              value
            )
          ),
          agentFailure
        );
        yield* store.update(
          threadId,
          optionsSet(thread, mapConfigOptions(response.configOptions) ?? chosen)
        );
      }
    );

    const setMode = Effect.fn("ThreadService.setMode")(function* (
      modeId: string
    ) {
      const now = yield* current;
      if (now !== null) {
        yield* Effect.mapError(
          now.session.agent.setMode(now.sessionId, modeId),
          agentFailure
        );
      }
      const thread = yield* store.get(threadId);
      if (thread) {
        yield* store.update(threadId, modeSet(thread, modeId));
      }
    });

    return {
      answer: (itemId, answers) =>
        detached(prompting.withPermit(answer(itemId, answers))),
      cancel,
      cards,
      delete: Effect.gen(function* () {
        yield* turn.stopOpening;
        // Gone first, so that no session starts for it from here on.
        yield* store.remove(threadId);
        // An agent still booting is stopped there, with what its start opened.
        if (booting) {
          yield* Fiber.interrupt(booting);
        }
        yield* stopLive;
      }),
      prompt: (input) => detached(prompting.withPermit(promptNow(input))),
      sendQueued: detached(sendQueued),
      setConfigOption,
      setMode,
      stop,
      switchAgent: (agentId) =>
        detached(
          prompting
            .withPermitsIfAvailable(1)(switchAgent(agentId))
            .pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(busy()),
                  onSome: Effect.succeed,
                })
              ),
              Effect.withSpan("ThreadService.switchAgent")
            )
        ),
      unqueue: (id) => detached(taking.withPermit(takeQueued(id))),
    };
  };
});

/**
 * Agent threads. A thread has at most one ACP session at a time, with the target repository as
 * working directory, and starts it with the first prompt that needs one: creating a thread
 * spawns nothing, and the agent boots while the prompt already shows as running. The agent is
 * the thread's to change between prompts; the next session is then told what was said.
 *
 * Every thread's session, by thread, each made the first time its thread is asked for: what a
 * thread does is its session's.
 */
export class ThreadSessions extends Context.Service<
  ThreadSessions,
  {
    /** A new thread, with the chat's default agent unless one is named. Nothing is started. */
    readonly create: (options?: {
      readonly agentId?: string | undefined;
      readonly purpose?: ThreadPurpose | undefined;
      readonly title?: string | undefined;
    }) => Effect.Effect<Thread, ThreadFailure>;
    /** Deletes the thread: its session stops what it has under way, and is forgotten. */
    readonly delete: (threadId: string) => Effect.Effect<void>;
    /** The thread's session. */
    readonly of: (threadId: string) => Effect.Effect<ThreadSession>;
  }
>()("ultrapaint/server/ThreadSessions") {
  static readonly layer = Layer.effect(
    ThreadSessions,
    Effect.gen(function* () {
      const serviceScope = yield* Effect.scope;
      /**
       * Runs work to completion even if the caller goes away. RPC handlers are interrupted when
       * their socket closes (a page reload is enough), and a session start or the opening of a
       * turn that stops half way leaves the thread in a state nothing recovers from.
       */
      const detached = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.flatMap(Effect.forkIn(effect, serviceScope), Fiber.join);
      const make = yield* makeSessionFactory({ detached, serviceScope });
      const sessions = new Map<string, ThreadSession>();
      const of = (threadId: string) =>
        Effect.sync(() => {
          const known = sessions.get(threadId);
          if (known) {
            return known;
          }
          const made = make(threadId);
          sessions.set(threadId, made);
          return made;
        });
      const store = yield* ThreadStore;
      const agents = yield* AgentConfigs;
      const preferences = yield* ChatPreferences;
      const discovery = yield* AgentDiscovery;

      const create = Effect.fn("ThreadSessions.create")(function* (
        options: {
          readonly agentId?: string | undefined;
          readonly purpose?: ThreadPurpose | undefined;
          readonly title?: string | undefined;
        } = {}
      ) {
        const { agentId, purpose, title } = options;
        const known = yield* agents.list;
        const defaults = yield* preferences.defaults;
        const agent =
          agentId === undefined
            ? (known.find((a) => a.id === defaults.agentId) ?? known[0])
            : yield* agents.get(agentId);
        if (!agent) {
          return yield* new NotFound({ message: "no agent is configured" });
        }
        const now = yield* Clock.currentTimeMillis;
        const offered = yield* preferences.optionsFor(agent.id);
        // Its models are not known yet: they reach the thread when the agent has said.
        if (offered.configOptions === undefined) {
          yield* discovery.discoverInBackground(agent.id);
        }
        const thread: Thread = {
          ...offered,
          agentId: agent.id,
          createdAt: now,
          id: yield* makeId("thread"),
          ...(purpose === "implement" && { purpose }),
          status: "idle",
          title: title ?? UNTITLED,
          updatedAt: now,
        };
        // Nothing is started: the first prompt brings the agent up.
        yield* store.add(thread);
        return thread;
      });

      return ThreadSessions.of({
        create,
        delete: (threadId) =>
          Effect.flatMap(of(threadId), (session) => session.delete).pipe(
            Effect.ensuring(Effect.sync(() => sessions.delete(threadId)))
          ),
        of,
      });
    })
  );
}
