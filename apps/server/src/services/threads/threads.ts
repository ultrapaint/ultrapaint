/**
 * Agent threads. A thread has at most one ACP session at a time, with the target repository as
 * working directory, and starts it with the first prompt that needs one: creating a thread
 * spawns nothing, and the agent boots while the prompt already shows as running. The agent is
 * the thread's to change between prompts; the next session is then told what was said. Updates are projected into a transcript that the editor renders, permission
 * requests are routed to the UI, and every filesystem or terminal call the agent makes is
 * confined to the repository.
 *
 * A live session is a scope forked from the open project: closing the project, deleting the
 * thread or shutting down ends the agent process, its terminals and any pending permission.
 */
import { Conflict, NotFound } from "@ultrapaint/contracts/errors";
import type {
  Answers,
  PromptInput,
  Question,
  QueuedPrompt,
  Thread,
} from "@ultrapaint/contracts/threads";
import { Clock, Context, Deferred, Effect, Fiber, Layer } from "effect";
import { makeId } from "../../ids.ts";
import { ProjectManager } from "../../project.ts";
import { RepoPaths } from "../repo-paths.ts";
import { DECLINE, makeAgentClient } from "./agent-client.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentDiscovery } from "./agent-discovery.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { answersText, contentOf } from "./elicitation.ts";
import {
  agentFailure,
  BOOLEAN_VALUES,
  CANCELLED,
  makeLiveSessions,
  type ThreadFailure,
} from "./live-sessions.ts";
import { ThreadStore } from "./thread-store.ts";
import { mapConfigOptions } from "./transcript.ts";
import { makeTurns, UNTITLED } from "./turns.ts";

const SWITCHED = "Switched to";

export class ThreadService extends Context.Service<
  ThreadService,
  {
    /**
     * The user's answers to a question card: recorded on the card, then sent to the agent as a
     * prompt of their own, which is how any ACP agent hears them.
     */
    readonly answer: (
      threadId: string,
      itemId: string,
      answers: Answers
    ) => Effect.Effect<void, ThreadFailure>;
    /**
     * How many cards the thread's agent has waited on so far. A tool that asked and hears
     * "declined" without this moving knows the user never saw its questions: the agent's own
     * client turned them down.
     */
    readonly cardsShown: (threadId: string) => Effect.Effect<number>;
    /** The user will not answer a card the agent waits on. */
    readonly decline: (
      threadId: string,
      itemId: string
    ) => Effect.Effect<void, ThreadFailure>;
    /** Puts an agent's questions to the user as a card in the thread. */
    readonly ask: (
      threadId: string,
      questions: readonly Question[]
    ) => Effect.Effect<void, NotFound>;
    readonly cancel: (threadId: string) => Effect.Effect<void, ThreadFailure>;
    /** Without an agent, the chat's default one. */
    readonly create: (
      agentId?: string,
      title?: string
    ) => Effect.Effect<Thread, ThreadFailure>;
    readonly delete: (threadId: string) => Effect.Effect<void>;
    /** Sends a prompt; while the agent works, it waits in the thread's queue instead. */
    readonly prompt: (input: PromptInput) => Effect.Effect<void, ThreadFailure>;
    /** Takes a queued prompt back out, to drop it or to edit it; null when it was already sent. */
    readonly unqueue: (
      threadId: string,
      id: string
    ) => Effect.Effect<QueuedPrompt | null, ThreadFailure>;
    /** Sends the oldest queued prompt now: after a stopped or failed turn, nothing sends it. */
    readonly sendQueued: (
      threadId: string
    ) => Effect.Effect<void, ThreadFailure>;
    readonly resolvePermission: (
      threadId: string,
      requestId: string,
      optionId: string,
      remember: boolean
    ) => Effect.Effect<void, ThreadFailure>;
    /** The agent the next prompt goes to. */
    readonly setAgent: (
      threadId: string,
      agentId: string
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
      const preferences = yield* ChatPreferences;
      const discovery = yield* AgentDiscovery;
      const project = yield* ProjectManager;
      const serviceScope = yield* Effect.scope;

      /**
       * Runs work to completion even if the caller goes away. RPC handlers are interrupted when
       * their socket closes (a page reload is enough), and a session start or the opening of a
       * turn that stops half way leaves the thread in a state nothing recovers from.
       */
      const detached = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.flatMap(Effect.forkIn(effect, serviceScope), Fiber.join);

      const newItemId = makeId("item");
      const currentPaths = project.use(Effect.map(RepoPaths, (paths) => paths));
      const client = yield* makeAgentClient(newItemId);
      const { letGo, shown } = client;
      const sessions = yield* makeLiveSessions({
        client,
        currentPaths,
        detached,
      });
      const { booting, live, stop } = sessions;
      const { opening, prompt, sendQueued, stopOpening, unqueue } =
        yield* makeTurns({ currentPaths, newItemId, serviceScope, sessions });

      // ---- questions ----
      const ask = Effect.fn("ThreadService.ask")(function* (
        threadId: string,
        questions: readonly Question[]
      ) {
        if (!(yield* store.get(threadId))) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        yield* store.push(threadId, {
          answers: null,
          at: yield* Clock.currentTimeMillis,
          id: yield* newItemId,
          kind: "question",
          questions,
        });
      });

      const answer = Effect.fn("ThreadService.answer")(function* (
        threadId: string,
        itemId: string,
        answers: Answers
      ) {
        const card = (yield* store.items(threadId)).find(
          (item) => item.id === itemId
        );
        if (card?.kind !== "question") {
          return yield* new NotFound({
            message: "the question is no longer in the thread",
          });
        }
        if (card.answers !== null || card.outcome !== undefined) {
          return yield* new Conflict({
            message: "the questions were already answered",
          });
        }
        if (card.elicitation !== undefined) {
          // The agent waits within its turn: the answers go back to it, not as a prompt.
          const waiting = live.get(threadId)?.asking.get(itemId);
          if (waiting === undefined) {
            return yield* new Conflict({
              message: "the agent no longer waits for these answers",
            });
          }
          yield* store.patchItem(threadId, itemId, (item) =>
            item.kind === "question" ? { ...item, answers } : item
          );
          yield* Deferred.succeed(waiting.reply, {
            action: "accept",
            content: contentOf(waiting.questions, answers),
          });
          return;
        }
        yield* store.patchItem(threadId, itemId, (item) =>
          item.kind === "question" ? { ...item, answers } : item
        );
        yield* prompt({
          attachments: [],
          text: answersText(card.questions, answers),
          threadId,
        });
      });

      const decline = Effect.fn("ThreadService.decline")(function* (
        threadId: string,
        itemId: string
      ) {
        const waiting = live.get(threadId)?.asking.get(itemId);
        if (waiting === undefined) {
          return yield* new NotFound({
            message: "the agent no longer waits for these answers",
          });
        }
        yield* store.patchItem(threadId, itemId, (item) =>
          item.kind === "question"
            ? { ...item, outcome: "declined" as const }
            : item
        );
        yield* Deferred.succeed(waiting.reply, DECLINE);
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
        agentId?: string,
        title?: string
      ) {
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
        const options = yield* preferences.optionsFor(agent.id);
        // Its models are not known yet: they reach the thread when the agent has said.
        if (options.configOptions === undefined) {
          yield* discovery.discoverInBackground(agent.id);
        }
        const thread: Thread = {
          ...options,
          agentId: agent.id,
          createdAt: now,
          id: yield* makeId("thread"),
          status: "idle",
          title: title ?? UNTITLED,
          updatedAt: now,
        };
        // Nothing is started: the first prompt brings the agent up.
        yield* store.add(thread);
        return thread;
      });

      const setAgent = Effect.fn("ThreadService.setAgent")(function* (
        threadId: string,
        agentId: string
      ) {
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        if (thread.agentId === agentId) {
          return;
        }
        if (thread.status === "running" || thread.status === "cancelling") {
          return yield* new Conflict({
            message: "the agent is still working on the previous prompt",
          });
        }
        const agent = yield* agents.get(agentId);
        const options = yield* preferences.optionsFor(agentId);
        // A session belongs to its agent. The next one starts with the next prompt, and is
        // told what was said before it.
        yield* stop(threadId);
        yield* store.update(threadId, {
          configOptions: undefined,
          currentModeId: undefined,
          modes: undefined,
          sandboxed: undefined,
          sandboxProblem: undefined,
          ...options,
          agentId,
          error: undefined,
          sessionId: undefined,
          status: "idle",
        });
        if (options.configOptions === undefined) {
          yield* discovery.discoverInBackground(agentId);
        }
        const last = (yield* store.items(threadId)).at(-1);
        const text = `${SWITCHED} ${agent.name}`;
        // Switching again before a prompt replaces the note rather than stacking another.
        if (last?.kind === "status" && last.text.startsWith(SWITCHED)) {
          yield* store.patchItem(threadId, last.id, (item) =>
            item.kind === "status" ? { ...item, text } : item
          );
        } else if (last) {
          yield* store.push(threadId, {
            at: yield* Clock.currentTimeMillis,
            id: yield* newItemId,
            kind: "status",
            text,
          });
        }
      });

      return ThreadService.of({
        answer: (threadId, itemId, answers) =>
          detached(
            opening.withLock(threadId, answer(threadId, itemId, answers))
          ),
        ask,
        cancel: Effect.fn("ThreadService.cancel")(function* (threadId: string) {
          if (yield* stopOpening(threadId)) {
            return;
          }
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          // Only a turn the agent is working on is stopped. One that has ended leaves the thread
          // as it is: nothing would take it out of "cancelling" again.
          if (!(session && sessionId) || session.turn === null) {
            return;
          }
          yield* store.update(threadId, { status: "cancelling" });
          // The client answers every permission request still open with `cancelled` (ACP).
          for (const pending of session.pending.values()) {
            yield* Deferred.succeed(pending.decision, CANCELLED);
          }
          // It will not wait for the cards it asked with either.
          yield* letGo(threadId, session);
          // The agent ends the turn itself and answers the prompt with `cancelled`.
          yield* Effect.mapError(session.agent.cancel(sessionId), agentFailure);
          // Unless the turn ended on its own meanwhile, and its end has already been written.
          if (
            session.turn === null &&
            (yield* store.get(threadId))?.status === "cancelling"
          ) {
            yield* store.update(threadId, { status: "idle" });
          }
        }),
        cardsShown: (threadId) => Effect.sync(() => shown.get(threadId) ?? 0),
        create,
        decline,
        delete: Effect.fn("ThreadService.delete")(function* (threadId: string) {
          yield* stopOpening(threadId);
          // Gone first, so that no session starts for it from here on.
          yield* store.remove(threadId);
          shown.delete(threadId);
          // An agent still booting is stopped there, with what its start opened.
          const boot = booting.get(threadId);
          if (boot) {
            yield* Fiber.interrupt(boot);
          }
          yield* stop(threadId);
        }),
        prompt: (input) =>
          detached(opening.withLock(input.threadId, prompt(input))),
        resolvePermission,
        sendQueued: (threadId) => detached(sendQueued(threadId)),
        setAgent,
        setConfigOption: Effect.fn("ThreadService.setConfigOption")(function* (
          threadId: string,
          optionId: string,
          value: string
        ) {
          const current = (yield* store.get(threadId))?.configOptions;
          const chosen = current?.map((o) =>
            o.id === optionId ? { ...o, currentValue: value } : o
          );
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          // No session yet: the choice waits for the one the next prompt starts.
          if (!(session && sessionId)) {
            yield* store.update(threadId, { configOptions: chosen });
            return;
          }
          const parsed = BOOLEAN_VALUES[value] ?? value;
          const response = (yield* Effect.mapError(
            session.agent.setConfigOption(sessionId, optionId, parsed),
            agentFailure
          )) as { configOptions?: unknown } | undefined;
          yield* store.update(threadId, {
            configOptions: mapConfigOptions(response?.configOptions) ?? chosen,
          });
        }),
        setMode: Effect.fn("ThreadService.setMode")(function* (
          threadId: string,
          modeId: string
        ) {
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          if (session && sessionId) {
            yield* Effect.mapError(
              session.agent.setMode(sessionId, modeId),
              agentFailure
            );
          }
          yield* store.update(threadId, { currentModeId: modeId });
        }),
        unqueue: (threadId, id) => detached(unqueue(threadId, id)),
      });
    })
  );
}
