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
  isStopping,
  modelNameOf,
  type PromptInput,
  type QueuedEdit,
  type QueuedPrompt,
  type Thread,
  type ThreadItem,
  type ThreadPurpose,
  type ThreadStatus,
} from "@ultrapaint/contracts/threads";
import { plural } from "@ultrapaint/shared/text";
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
import { History } from "../history.ts";
import { McpAccess } from "../mcp/access.ts";
import { RepoPaths } from "../repo-paths.ts";
import { ReviewLoop, type ToDesigner } from "../review/review-loop.ts";
import { VariationRounds } from "../variation-rounds.ts";
import { type TreeStamp, WorkingTree } from "../working-tree.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentDiscovery } from "./agent-discovery.ts";
import { AgentLauncher } from "./agent-launcher.ts";
import { agentFailure, makeSessionOpener } from "./agent-session.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { makeCommandReceipts } from "./command-receipts.ts";
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
import { makeTurnWitnesses } from "./turn-witness.ts";

export type ThreadFailure =
  | NotFound
  | NotConfigured
  | Conflict
  | ForbiddenPath
  | AgentFailure;

/** How long a stopped turn is waited for before what comes next goes ahead without it. */
const TURN_END_WAIT = "10 seconds";

/**
 * How long the agent has to confirm a stop, by ending its turn, before the thread says it is not
 * responding and the person may force stop it (ADR 0124): the reference product's wait.
 */
const STOP_CONFIRM_WAIT = "10 seconds";

/** How much of a prompt a turn's point of the history keeps as its words. */
const PROMPT_WORDS = 200;

// ---- status ----

/** What moves a thread's status. */
type StatusEvent =
  /** A prompt opens a turn: the thread runs from here, its agent's start included. */
  | { readonly _tag: "Prompted" }
  /** The user stops the turn the agent works on; the agent ends it. */
  | { readonly _tag: "CancelAsked" }
  /** The agent was asked to stop a turn that had already ended. */
  | { readonly _tag: "CancelOutlived" }
  /** The agent has not ended the turn it was asked to stop, `STOP_CONFIRM_WAIT` later. */
  | { readonly _tag: "StopUnconfirmed" }
  /** A turn is over: its end is in the transcript. */
  | { readonly _tag: "TurnEnded" }
  /** A turn, or the session it needed, went wrong. */
  | { readonly _tag: "Failed"; readonly message: string }
  /** The agent's process exited without being asked to. */
  | { readonly _tag: "AgentExited"; readonly reason: string }
  /** The session's scope closed, whoever closed it. */
  | { readonly _tag: "SessionClosed" }
  /** The thread's agent changed: the next prompt starts a session of the new one. */
  | { readonly _tag: "AgentSwitched" }
  /** The review models look at what the turn made (ADR 0063); the designer waits. */
  | { readonly _tag: "ReviewStarted" }
  /** The review's round is over, or was stopped. */
  | { readonly _tag: "ReviewEnded" };

type StatusPatch = Pick<Thread, "status"> & Partial<Pick<Thread, "error">>;

/**
 * The status after an event, and the error with it; null leaves the thread as it is. A cancel
 * stops only a turn under way, once. A cancel that outlived its turn takes the thread out of
 * "cancelling", which nothing else would. A stop the agent has not confirmed in time leaves it
 * "unresponsive" until the turn ends, by the agent or by force (ADR 0124). An exit while the
 * user stops the turn, or a session closing, is not a failure, and leaves a failure shown.
 */
export const statusAfter = (
  status: ThreadStatus,
  event: StatusEvent
): StatusPatch | null => {
  switch (event._tag) {
    case "Prompted":
      return { error: undefined, status: "running" };
    case "CancelAsked":
      return status === "running" || status === "reviewing"
        ? { status: "cancelling" }
        : null;
    case "CancelOutlived":
      return isStopping(status) ? { status: "idle" } : null;
    case "StopUnconfirmed":
      return status === "cancelling" ? { status: "unresponsive" } : null;
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
    case "ReviewStarted":
      return status === "running" || status === "idle"
        ? { status: "reviewing" }
        : null;
    case "ReviewEnded":
      return status === "reviewing" || status === "cancelling"
        ? { status: "idle" }
        : null;
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

/**
 * The queued prompt Send now sends: the one named, or the first not being edited; null when
 * there is none, or why it cannot go now (ADR 0137).
 */
const queuedToSend = (
  thread: Thread,
  id: string | undefined
): QueuedPrompt | Conflict | null => {
  const queue = thread.queued ?? [];
  const chosen =
    id === undefined
      ? queue.find((q) => !q.editing)
      : queue.find((q) => q.id === id);
  if (!chosen) {
    return null;
  }
  if (chosen.editing) {
    return new Conflict({
      message: "the prompt is being edited: save it first",
    });
  }
  return isStopping(thread.status)
    ? new Conflict({ message: "the agent is being stopped" })
    : chosen;
};

/**
 * Whether the last turn a transcript holds was stopped or failed, so its queue waits for the
 * person (ADR 0137): read at start, when no turn has ended since the server started.
 */
export const heldAtStart = (items: readonly ThreadItem[]): boolean => {
  const last = items.findLast(
    (i) =>
      i.kind === "turn_end" ||
      (i.kind === "status" && i.text.startsWith("Turn failed:"))
  );
  return last?.kind === "turn_end"
    ? last.stopReason === "cancelled"
    : last !== undefined;
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
  /**
   * A queued prompt edited in the composer (ADR 0137): `start` holds the whole queue, `save`
   * gives the prompt its new words, and `save` or `cancel` lets the queue go on. The prompt as
   * it is now; null when it is no longer queued.
   */
  readonly editQueued: (
    id: string,
    edit: QueuedEdit
  ) => Effect.Effect<QueuedPrompt | null, ThreadFailure>;
  /**
   * Ends a turn whose agent has not confirmed its stop (the thread is `unresponsive`, ADR 0124):
   * the turn ends cancelled, its cards are let go and the session's scope closes, which stops
   * the agent's process through the handle that spawned it. The queue stays, and the next
   * prompt starts a session that reopens the conversation. Any other thread is left as it is.
   */
  readonly forceStop: Effect.Effect<void, ThreadFailure>;
  /** Moves a queued prompt before another, or to the end (`null`). */
  readonly moveQueued: (
    id: string,
    before: string | null
  ) => Effect.Effect<void, ThreadFailure>;
  /**
   * Sends a prompt; while the agent works, it waits in the thread's queue, or goes into the turn
   * when it says `followUp: "steer"` (ADR 0137).
   */
  readonly prompt: (input: PromptInput) => Effect.Effect<void, ThreadFailure>;
  /**
   * Sends a queued prompt now, the first one without an id (ADR 0137): into the turn the agent
   * works on once its running step ends (an agent that cannot take it has its turn stopped, and
   * the prompt starts the next), in place of a review round, which stops, or as a turn of its
   * own. Refused while the agent is being stopped, or while the prompt is being edited.
   */
  readonly sendNow: (id?: string) => Effect.Effect<void, ThreadFailure>;
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
  /** Takes a queued prompt off the queue; null when it was already sent. */
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
  const reviews = yield* ReviewLoop;
  const { mcp: mcpEnabled } = yield* ServerConfig;
  const project = yield* OpenProject;
  /**
   * The open project's history, told of a turn (ADR 0087). Telling it is a nicety: a project
   * closed meanwhile must not fail the turn.
   */
  const historyOf = (
    tell: (history: History["Service"]) => Effect.Effect<void>
  ) =>
    project
      .use(
        Effect.flatMap(Effect.serviceOption(History), (history) =>
          history._tag === "Some" ? tell(history.value) : Effect.void
        )
      )
      .pipe(Effect.ignore);
  const events = yield* EventBus;
  const log = yield* AppLog;
  const path = yield* Path.Path;
  const opener = yield* makeSessionOpener();
  const content = yield* makePromptContent();
  // One for every thread: a turn's witness knows whether another thread's turn was open with it.
  const witnesses = makeTurnWitnesses(project);
  const newItemId = makeId("item");
  const currentPaths = project.use(Effect.map(RepoPaths, (paths) => paths));

  return (threadId: string): ThreadSession => {
    let live: Live | null = null;
    /** The session's start under way: deleting the thread stops its agent mid-boot. */
    let booting: Fiber.Fiber<unknown, unknown> | null = null;
    /** The review's round under way: Stop interrupts it (ADR 0063). */
    let reviewing: Fiber.Fiber<unknown> | null = null;
    /** The wait for the agent to confirm a stop, while the thread is being stopped (ADR 0124). */
    let confirming: Fiber.Fiber<void> | null = null;
    /**
     * The queued prompt the stopped turn's end sends: an agent that cannot take a prompt into
     * its turn has the turn stopped for it (ADR 0137).
     */
    let restartWith: string | null = null;
    /** The queued prompt sent in place of the review round stopped for it (ADR 0137). */
    let afterReviewWith: string | null = null;
    /**
     * The last turn was stopped or failed: its queue waits for the person's Send now, an edit
     * finished meanwhile included (ADR 0018, 0137). A prompt that opens a turn lets it go.
     */
    let heldByStop: boolean | null = null;
    /**
     * The queued prompt whose steer is on its way to the agent: it is neither sent as a turn nor
     * edited until the agent has answered, so it reaches the agent once.
     */
    let delivering: string | null = null;
    // Prompts go into the turn one at a time, in the order they were sent now.
    const steering = Semaphore.makeUnsafe(1);
    // One session start, however many calls ask for it at once.
    const starting = Semaphore.makeUnsafe(1);
    // One prompt at a time, so two cannot both find the thread idle.
    const prompting = Semaphore.makeUnsafe(1);
    // Taking from the queue, one at a time: a prompt is sent once.
    const taking = Semaphore.makeUnsafe(1);
    const cards = makePendingCards(threadId, { log, newItemId, store });
    /** A queued prompt, as the prompt it is sent as. */
    const fromQueue = (queued: QueuedPrompt): PromptInput => ({
      attachments: queued.attachments,
      text: queued.text,
      threadId,
    });

    /**
     * The only way the thread's status changes; `extra` goes with it when it does. A thread out of
     * "cancelling" no longer waits for its stop to be confirmed: the wait is the turn's it began
     * in, and must not say the next one's stop was ignored. The patch, when there was one.
     */
    const transition = Effect.fnUntraced(function* (
      event: StatusEvent,
      extra: Partial<Thread> = {}
    ) {
      const thread = yield* store.get(threadId);
      const patch = thread ? statusAfter(thread.status, event) : null;
      if (patch) {
        yield* store.update(threadId, { ...extra, ...patch });
        const wait = confirming;
        if (wait !== null && patch.status !== "cancelling") {
          confirming = null;
          yield* Fiber.interrupt(wait);
        }
      }
      return patch;
    });
    /**
     * A turn of variations is over (ADR 0098): the takes not handed in failed, and the chat says
     * so in a line of its own; the editor draws each as a red box with Try again.
     */
    const takesEnded = project
      .use(
        Effect.flatMap(Effect.serviceOption(VariationRounds), (rounds) =>
          rounds._tag === "Some"
            ? rounds.value.turnEnded(threadId)
            : Effect.succeed({ asked: 0, failed: 0 })
        )
      )
      .pipe(
        Effect.flatMap(({ asked, failed }) =>
          failed === 0
            ? Effect.void
            : Effect.gen(function* () {
                yield* store.push(threadId, {
                  at: yield* Clock.currentTimeMillis,
                  id: yield* newItemId,
                  kind: "status",
                  text: `${failed} of ${plural(asked, "variation")} did not come back: Try again under ${failed === 1 ? "it" : "them"} on the canvas.`,
                });
              })
        ),
        // A project closed meanwhile has no rounds, and a line not written loses only the
        // telling: the editor still draws the failed takes. Neither may fail the turn's end.
        Effect.ignore
      );
    const turn = makeTurn(threadId, {
      // The turn's takes, then its point of the history, whichever way it ended.
      ended: Effect.andThen(
        takesEnded,
        historyOf((h) => h.turnEnded(threadId))
      ),
      log,
      newItemId,
      project,
      store,
      // A turn's end may start its review instead of leaving the thread idle. One that failed
      // or was stopped before it reached the agent settles its takes too: `ended` is told only
      // of one that did, and settling them twice changes nothing.
      transition: (event) => {
        if (event._tag === "TurnEnded") {
          return Effect.andThen(takesEnded, turnOver);
        }
        if (event._tag === "Failed") {
          heldByStop = true;
          return Effect.andThen(takesEnded, transition(event));
        }
        return transition(event);
      },
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
                    files.report(file, text, { _tag: "Thread", threadId })
                  )
                )
                .pipe(Effect.catchTag("NotConfigured", () => Effect.void)),
          },
          // Every thread writes the repository, a design thread too (ADR 0118).
          root: paths.root,
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
    ).pipe(Effect.withSpan("ThreadSession.ensureLive"));

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

    /**
     * After a review's round: the findings go to the designer as its next prompt unless the
     * review ended, when what was queued is sent; a review the user stopped leaves the queue for
     * them to send or drop.
     */
    const afterReview = (fiber: Fiber.Fiber<ToDesigner | null>) =>
      Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber);
        if (reviewing === fiber) {
          reviewing = null;
        }
        // Stopped for a queued prompt sent now: it goes in the round's place.
        const chosen = afterReviewWith;
        afterReviewWith = null;
        // One edited meanwhile, in another window, stays for its edit.
        const sentNow =
          chosen === null
            ? null
            : yield* taking.withPermit(
                Effect.flatMap(queueOf, (queue) =>
                  queue.find((q) => q.id === chosen)?.editing
                    ? Effect.succeed(null)
                    : takeQueued(chosen)
                )
              );
        const ended = yield* prompting.withPermit(
          Effect.gen(function* () {
            yield* transition({ _tag: "ReviewEnded" });
            if (sentNow !== null) {
              yield* promptNow(fromQueue(sentNow));
              return false;
            }
            const findings = Exit.isSuccess(exit) ? exit.value : undefined;
            if (findings) {
              yield* promptNow(
                { attachments: [], text: findings.text, threadId },
                findings.review
              );
            }
            return findings === null;
          })
        );
        if (ended) {
          yield* sendQueued;
        }
      });

    /**
     * A turn is over (`turn.ts` wrote its end): its pages wait for review and a round's answer is
     * read; then, unless it was stopped or a prompt waits, a design's review round when one is
     * due (ADR 0063). The thread goes from running to reviewing, never idle between, so that no
     * prompt starts a turn under the review.
     */
    const turnOver = Effect.gen(function* () {
      const end = (yield* store.items(threadId)).findLast(
        (i) => i.kind === "turn_end"
      );
      const cancelled =
        end?.kind === "turn_end" && end.stopReason === "cancelled";
      heldByStop = cancelled;
      yield* reviews.turnEnded(threadId, { cancelled });
      const thread = yield* store.get(threadId);
      const due =
        !cancelled && thread !== undefined && (thread.queued ?? []).length === 0
          ? yield* reviews.due(threadId)
          : null;
      if (due === null) {
        return yield* transition({ _tag: "TurnEnded" });
      }
      const projectScope = yield* project.scope;
      yield* transition({ _tag: "ReviewStarted" });
      const fiber = yield* Effect.forkIn(
        reviews.run(threadId, due),
        projectScope
      );
      reviewing = fiber;
      yield* Effect.forkIn(
        Effect.ignore(afterReview(fiber), { log: true }),
        serviceScope
      );
    }).pipe(
      // A project closed meanwhile has nothing to review.
      Effect.catchTag("NotConfigured", () => transition({ _tag: "TurnEnded" }))
    );

    /** Whether a turn is at the agent now. */
    const atAgent = Effect.map(turn.state, (now) => now._tag === "AtAgent");

    /**
     * The agent's answer ends the turn; what follows it runs on its own. A turn force stopped
     * meanwhile is over already (ADR 0124): the agent's late answer changes nothing.
     */
    const runTurn = (
      session: Live,
      sessionId: string,
      blocks: ContentBlock[]
    ) =>
      session.agent.prompt(sessionId, blocks).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.flatMap(atAgent, (at) => {
              // The prompt a stop was asked for stays queued, the turn having failed instead.
              restartWith = null;
              return at
                ? turn.fail(error.message)
                : // Force stopped meanwhile: the turn ended cancelled, and its prompt failing
                  // after says nothing more of it.
                  Effect.void;
            }),
          onSuccess: (response) =>
            Effect.gen(function* () {
              if (!(yield* turn.endAtAgent(response))) {
                return;
              }
              // Stopped for a queued prompt sent now: it starts the next turn.
              const restart = restartWith;
              restartWith = null;
              if (restart !== null) {
                yield* Effect.forkIn(
                  Effect.ignore(
                    Effect.suspend(() => sendNow(restart)),
                    { log: true }
                  ),
                  serviceScope
                );
                return;
              }
              // A turn the user stopped leaves the queue for them to send or drop; one under
              // review sends it when the review is over.
              if (response.stopReason !== "cancelled" && reviewing === null) {
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
      const now = (yield* store.get(threadId)) ?? thread;
      const reviewed = yield* reviews.enabled(threadId);
      let briefedNow = false;
      if (!session.briefed) {
        session.briefed = true;
        const context = yield* content.sessionContext(
          session.resumed,
          earlier,
          now.purpose ?? "design",
          session.editorMcp,
          input.text,
          reviewed,
          now.skills,
          now.sandboxed === true
        );
        blocks.unshift(...context.blocks);
        if (context.briefed) {
          briefedNow = true;
          yield* store.update(threadId, { toldSkills: context.told });
        }
      }
      // The chat's design skills changed since its agent was told them: said on this prompt.
      const change = briefedNow
        ? null
        : yield* content.skillsChange(now, session.editorMcp, reviewed);
      if (change !== null) {
        blocks.unshift(change.block);
        yield* store.update(threadId, { toldSkills: change.told });
      }
      // Who else writes from now on, and the folder's files before the turn, by time and size,
      // to tell after it what it changed. The witness is the turn's once it is at the agent.
      const witness = yield* witnesses.witness(threadId);
      yield* Effect.gen(function* () {
        const before = yield* project
          .use(Effect.flatMap(WorkingTree, (tree) => tree.stamp))
          .pipe(Effect.orElseSucceed((): TreeStamp => new Map()));
        // The person's edits closed first; what changes from now on is the turn's (ADR 0087).
        // Not cut short by a cancel: a point half written is worse than a late cancel.
        yield* Effect.uninterruptible(
          historyOf((h) =>
            h.turnStarted(threadId, {
              agentId: thread.agentId,
              label: input.text.slice(0, PROMPT_WORDS),
              model: modelNameOf(thread.configOptions),
            })
          )
        );
        yield* turn.atAgent(before, witness);
      }).pipe(
        Effect.onError(() =>
          Effect.andThen(
            witness.close,
            historyOf((h) => h.turnEnded(threadId))
          )
        )
      );
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

    /**
     * Sent when the turn ends: the user need not wait to say what comes next. Last in the queue,
     * or `first`, for a prompt sent now. Its id.
     */
    const enqueue = Effect.fnUntraced(function* (
      thread: Thread,
      input: PromptInput,
      first = false
    ) {
      const queued: QueuedPrompt = {
        at: yield* Clock.currentTimeMillis,
        attachments: input.attachments,
        id: yield* newItemId,
        text: input.text,
      };
      const queue = thread.queued ?? [];
      yield* store.update(threadId, {
        queued: first ? [queued, ...queue] : [...queue, queued],
      });
      return queued.id;
    });

    /** A prompt, under `prompting`; `review` when it carries a review round's findings. */
    const promptNow = Effect.fn("ThreadSession.prompt")(function* (
      input: PromptInput,
      review?: string
    ) {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      // A prompt brings a settled chat back to the list, whether it starts a turn or waits in the
      // queue behind one (ADR 0141).
      if (thread.settledAt !== undefined) {
        yield* store.update(threadId, { settledAt: undefined });
      }
      if (isBusy(thread.status)) {
        // Sent into the turn from the composer, as a queued prompt sent now is, unless the turn
        // is being stopped: then it waits its turn as any other.
        const now = input.followUp === "steer" && !isStopping(thread.status);
        const id = yield* enqueue(thread, input, now);
        if (now) {
          yield* sendNowBusy(id);
        }
        return;
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
        ...(review !== undefined && { review }),
        text: input.text,
      });
      heldByStop = false;
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

    /** The queue as the store has it now. */
    const queueOf = Effect.map(
      store.get(threadId),
      (thread): readonly QueuedPrompt[] => thread?.queued ?? []
    );

    /** One queued prompt changed by `change`; the rest as they are. */
    const changeQueued = (
      id: string,
      change: (queued: QueuedPrompt) => QueuedPrompt
    ) =>
      Effect.flatMap(queueOf, (queue) =>
        store.update(threadId, {
          queued: queue.map((q) => (q.id === id ? change(q) : q)),
        })
      );

    /** A queued prompt first in the queue, `change`d; the rest in their order. */
    const toFront = (
      id: string,
      change: (queued: QueuedPrompt) => QueuedPrompt = (q) => q
    ) =>
      Effect.flatMap(queueOf, (queue) => {
        const chosen = queue.find((q) => q.id === id);
        return chosen
          ? store.update(threadId, {
              queued: [change(chosen), ...queue.filter((q) => q.id !== id)],
            })
          : Effect.void;
      });

    // Typed: a turn that ends sends the next prompt, which opens a turn. Nothing goes while a
    // queued prompt is being edited: the person has not said yet what it is (ADR 0137).
    const sendQueued: Effect.Effect<void, ThreadFailure> = taking.withPermit(
      Effect.gen(function* () {
        const thread = yield* store.get(threadId);
        const queue = thread?.queued ?? [];
        if (
          isBusy(thread?.status) ||
          queue.some((q) => q.editing) ||
          // Its steer's answer decides: the agent has it, or the queue goes on from there.
          queue[0]?.id === delivering
        ) {
          return;
        }
        const next = yield* takeQueued(null);
        if (next) {
          yield* prompting.withPermit(promptNow(fromQueue(next)));
        }
      })
    );

    /**
     * The queue goes on where it was only held by an edit, or by a prompt that could not go
     * into a turn: never after a turn that was stopped or failed, which waits for the person.
     */
    const resumeQueue: Effect.Effect<void, ThreadFailure> = Effect.gen(
      function* () {
        const thread = yield* store.get(threadId);
        if (thread?.status !== "idle" || reviewing !== null) {
          return;
        }
        // No turn ended since the server started: the transcript says how the last one did.
        const held = heldByStop ?? heldAtStart(yield* store.items(threadId));
        if (held) {
          return;
        }
        yield* sendQueued;
      }
    );

    /** A queued prompt sent into the turn waits its turn again, first in the queue. */
    const steerWaits = (id: string) =>
      changeQueued(id, (q) => ({ ...q, steering: undefined }));

    /**
     * A queued prompt sent now goes into the turn once the agent's running step ends: a tool
     * call in flight is never cut off (ADR 0137). A turn that ends first leaves it first in the
     * queue, which the turn's end sends, or which waits for the person after a stop. An agent
     * that cannot take it has its turn stopped, and the prompt starts the next.
     */
    /**
     * A queued prompt put into the agent's turn: on its way, the turn's end does not send it as a
     * turn of its own; once the agent has it, it leaves the queue for the transcript, and an agent
     * that had no turn leaves it first in the queue.
     */
    const steerInto = Effect.fnUntraced(function* (
      session: Live,
      sessionId: string,
      queued: QueuedPrompt
    ): Effect.fn.Return<void, ThreadFailure> {
      const { blocks, labels } = yield* content.attachmentBlocks(
        fromQueue(queued),
        yield* currentPaths
      );
      delivering = queued.id;
      const steered = yield* Effect.mapError(
        session.agent.steer(
          sessionId,
          blocks.map((block) => promptBlock(session.negotiated, block))
        ),
        agentFailure
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            delivering = null;
          })
        )
      );
      if (steered === "noTurn") {
        yield* steerWaits(queued.id);
        return yield* resumeQueue;
      }
      // Sent as a turn of its own already: recorded there, not twice.
      if ((yield* taking.withPermit(takeQueued(queued.id))) === null) {
        return;
      }
      yield* store.push(threadId, {
        at: yield* Clock.currentTimeMillis,
        attachments: labels,
        id: yield* newItemId,
        kind: "user",
        steer: true,
        text: queued.text,
      });
      // Its turn may have ended while the agent answered, the queue held for it meanwhile.
      yield* resumeQueue;
    });

    const steerAfterStep = (id: string): Effect.Effect<void, ThreadFailure> =>
      steering.withPermit(
        Effect.gen(function* () {
          const between = yield* turn.stepEnded;
          const queued = (yield* queueOf).find((q) => q.id === id);
          // Sent as the next turn meanwhile, taken off, or being edited.
          if (!queued?.steering || queued.editing) {
            return yield* steerWaits(id);
          }
          const now = yield* current;
          // A turn being stopped takes nothing more: it waits for the person, first.
          const stopping = isStopping((yield* store.get(threadId))?.status);
          if (!between || now === null || stopping) {
            return yield* steerWaits(id);
          }
          const { session, sessionId } = now;
          if (!session.negotiated.steering) {
            yield* steerWaits(id);
            restartWith = id;
            return yield* cancel;
          }
          yield* steerInto(session, sessionId, queued);
        }).pipe(Effect.onError(() => steerWaits(id)))
      );

    /**
     * A queued prompt sent now while the agent works: into its turn, or in place of the review
     * round, which stops. First in the queue meanwhile.
     */
    const sendNowBusy = Effect.fnUntraced(function* (
      id: string
    ): Effect.fn.Return<void, ThreadFailure> {
      const thread = yield* store.get(threadId);
      if (thread?.status === "reviewing") {
        yield* toFront(id);
        afterReviewWith = id;
        const round = reviewing;
        if (round !== null) {
          yield* Fiber.interrupt(round);
        }
        return;
      }
      yield* toFront(id, (q) => ({ ...q, steering: true }));
      yield* Effect.forkIn(
        Effect.ignore(steerAfterStep(id), { log: true }),
        serviceScope
      );
    });

    const sendNow = Effect.fn("ThreadSession.sendNow")(function* (
      id?: string
    ): Effect.fn.Return<void, ThreadFailure> {
      const thread = yield* store.get(threadId);
      if (!thread) {
        return yield* new NotFound({ message: `unknown thread ${threadId}` });
      }
      const chosen = queuedToSend(thread, id);
      if (chosen === null) {
        return;
      }
      if (chosen instanceof Conflict) {
        return yield* chosen;
      }
      if (isBusy(thread.status)) {
        return yield* sendNowBusy(chosen.id);
      }
      // No turn: a turn of its own, after a stop or a failure as at any time.
      const taken = yield* taking.withPermit(takeQueued(chosen.id));
      if (taken) {
        yield* prompting.withPermit(promptNow(fromQueue(taken)));
      }
    });

    const editQueued = Effect.fn("ThreadSession.editQueued")(function* (
      id: string,
      edit: QueuedEdit
    ) {
      const edited = yield* taking.withPermit(
        Effect.gen(function* () {
          const queued = (yield* queueOf).find((q) => q.id === id);
          if (!queued) {
            return null;
          }
          if (id === delivering && edit.action === "start") {
            return yield* new Conflict({
              message: "the prompt is on its way to the agent",
            });
          }
          // Its hold let go meanwhile, by another window: this edit no longer has it.
          if (edit.action === "save" && !queued.editing) {
            return yield* new Conflict({
              message: "the prompt is no longer being edited here",
            });
          }
          const next: QueuedPrompt =
            edit.action === "start"
              ? { ...queued, editing: true, steering: undefined }
              : {
                  ...queued,
                  ...(edit.action === "save" && {
                    attachments: edit.attachments,
                    text: edit.text,
                  }),
                  editing: undefined,
                };
          // One edit a thread at a time: opening one lets any other go, so no hold is left
          // behind that no window has open.
          const queue = yield* queueOf;
          yield* store.update(threadId, {
            queued: queue.map((q) => {
              if (q.id === id) {
                return next;
              }
              return edit.action === "start" && q.editing
                ? { ...q, editing: undefined }
                : q;
            }),
          });
          return next;
        })
      );
      if (edited !== null && edit.action !== "start") {
        yield* resumeQueue;
      }
      return edited;
    });

    const moveQueued = Effect.fn("ThreadSession.moveQueued")(function* (
      id: string,
      before: string | null
    ) {
      const queue = yield* queueOf;
      const moved = queue.find((q) => q.id === id);
      if (!moved || id === before) {
        return;
      }
      const rest = queue.filter((q) => q.id !== id);
      const at = rest.findIndex((q) => q.id === before);
      rest.splice(at === -1 ? rest.length : at, 0, moved);
      yield* store.update(threadId, { queued: rest });
    });

    // ---- what the user does ----
    const answer = Effect.fn("ThreadSession.answer")(function* (
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
      // A review under way ends there: its round says it was stopped.
      const round = reviewing;
      if (round !== null) {
        // Stopped by the person: what is queued waits for them, as after a stopped turn.
        heldByStop = true;
        yield* Fiber.interrupt(round);
        return;
      }
      const now = yield* current;
      // Only a turn the agent is working on is stopped. One that has ended leaves the thread
      // as it is: nothing would take it out of "cancelling" again.
      if (now === null || !(yield* atAgent)) {
        return;
      }
      const { session, sessionId } = now;
      // Asked for the first time: the agent has `STOP_CONFIRM_WAIT` to end the turn before the
      // thread says it is not responding. The wait goes with the session; asking again does not
      // put it off.
      if ((yield* transition({ _tag: "CancelAsked" })) !== null) {
        confirming = yield* Effect.forkIn(
          Effect.andThen(
            Effect.sleep(STOP_CONFIRM_WAIT),
            Effect.suspend(() => {
              confirming = null;
              return Effect.asVoid(transition({ _tag: "StopUnconfirmed" }));
            })
          ),
          session.scope
        );
      }
      // The client answers every permission request still open with `cancelled` (ACP), and
      // will not wait for the forms it asked with either.
      yield* cards.releaseAll;
      // The agent ends the turn itself and answers the prompt with `cancelled`.
      yield* Effect.mapError(session.agent.cancel(sessionId), agentFailure);
      // Unless the turn ended on its own meanwhile, and its end has already been written.
      if (!(yield* atAgent)) {
        yield* transition({ _tag: "CancelOutlived" });
      }
    }).pipe(Effect.withSpan("ThreadSession.cancel"));

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

    const forceStop = Effect.gen(function* () {
      if ((yield* store.get(threadId))?.status !== "unresponsive") {
        return;
      }
      // Asked since the stop, too: nobody answers them now.
      yield* cards.releaseAll;
      // Ended as the agent would have: stopped, with the files it changed. The turn is taken
      // first, so a late answer of the agent's changes nothing; its process then ends with the
      // session's scope, through the handle that spawned it, before the files are read, so a
      // write on its way out is counted. The thread is idle.
      const ended = yield* turn.endAtAgent(
        { stopReason: "cancelled" },
        stopLive
      );
      if (!ended) {
        yield* stopLive;
      }
    }).pipe(Effect.withSpan("ThreadSession.forceStop"));

    const stop = Effect.gen(function* () {
      // An agent that cannot be asked to stop may still end its turn: it is waited for alike.
      yield* Effect.ignore(cancel, { log: true });
      yield* Effect.timeoutOption(turnEnded, TURN_END_WAIT);
    }).pipe(Effect.withSpan("ThreadSession.stop"));

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

    const setConfigOption = Effect.fn("ThreadSession.setConfigOption")(
      function* (optionId: string, value: string) {
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        const options = thread.configOptions ?? [];
        const chosen = options.map((o) =>
          o.id === optionId ? { ...o, currentValue: value } : o
        );
        const now = yield* current;
        // No session yet: the choice waits for the one the next prompt starts.
        if (now === null) {
          yield* store.update(threadId, optionsSet(thread, chosen));
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

    const setMode = Effect.fn("ThreadSession.setMode")(function* (
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
        if (reviewing) {
          yield* Fiber.interrupt(reviewing);
        }
        yield* stopLive;
        // Last: a review stopped just now left its pages waiting for the next round.
        yield* reviews.forget(threadId);
      }),
      editQueued: (id, edit) => detached(editQueued(id, edit)),
      // Under `prompting`: no prompt takes the session it is about to close.
      forceStop: detached(prompting.withPermit(forceStop)),
      moveQueued: (id, before) =>
        detached(taking.withPermit(moveQueued(id, before))),
      prompt: (input) => detached(prompting.withPermit(promptNow(input))),
      sendNow: (id) => detached(sendNow(id)),
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
              Effect.withSpan("ThreadSession.switchAgent")
            )
        ),
      unqueue: (id) =>
        detached(
          Effect.tap(
            Effect.suspend(
              (): Effect.Effect<QueuedPrompt | null, ThreadFailure> =>
                id === delivering
                  ? Effect.fail(
                      new Conflict({
                        message: "the prompt is on its way to the agent",
                      })
                    )
                  : taking.withPermit(takeQueued(id))
            ),
            (taken) => (taken?.editing ? resumeQueue : Effect.void)
          )
        ),
    };
  };
});

/** What a new thread is made with: its agent, what it is for and its title, each optional. */
interface NewThread {
  readonly agentId?: string | undefined;
  readonly purpose?: ThreadPurpose | undefined;
  readonly title?: string | undefined;
}

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
    /**
     * A request that changes a thread, by the command id the editor made for it (ADR 0130):
     * done once, and one sent again with the same id is answered with the first one's result.
     * Without an id, it is done each time.
     */
    readonly command: <A, E>(
      commandId: string | undefined,
      act: Effect.Effect<A, E>
    ) => Effect.Effect<A, E>;
    /** A new thread, with the chat's default agent unless one is named. Nothing is started. */
    readonly create: (
      options?: NewThread
    ) => Effect.Effect<Thread, ThreadFailure>;
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
      const store = yield* ThreadStore;
      const sessions = new Map<string, ThreadSession>();
      // A thread the store does not have (deleted, or never there) is answered by a session of
      // its own, which says so, and is not kept: nothing would ever forget it.
      const of = (threadId: string) =>
        Effect.map(store.get(threadId), (thread) => {
          const known = sessions.get(threadId);
          if (known) {
            return known;
          }
          const made = make(threadId);
          if (thread !== undefined) {
            sessions.set(threadId, made);
          }
          return made;
        }).pipe(Effect.withSpan("ThreadSessions.of"));
      const agents = yield* AgentConfigs;
      const preferences = yield* ChatPreferences;
      const discovery = yield* AgentDiscovery;

      const create = Effect.fn("ThreadSessions.create")(function* (
        options: NewThread = {}
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
          ...(title !== undefined && { named: true }),
          status: "idle",
          title: title ?? UNTITLED,
          updatedAt: now,
        };
        // Nothing is started: the first prompt brings the agent up.
        yield* store.add(thread);
        return thread;
      });

      return ThreadSessions.of({
        command: makeCommandReceipts((effect) =>
          Effect.forkIn(effect, serviceScope)
        ),
        create,
        delete: Effect.fn("ThreadSessions.delete")(
          function* (threadId) {
            const session = yield* of(threadId);
            yield* session.delete;
          },
          // Detached, as a prompt is: cut short by its request's socket closing, a delete would
          // forget the session while its agent still ran.
          (effect, threadId) =>
            detached(
              Effect.ensuring(
                effect,
                Effect.sync(() => sessions.delete(threadId))
              )
            )
        ),
        of,
      });
    })
  );
}
