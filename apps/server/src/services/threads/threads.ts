/**
 * Agent threads. A thread has at most one ACP session at a time, with the target repository as
 * working directory, and starts it with the first prompt that needs one: creating a thread
 * spawns nothing, and the agent boots while the prompt already shows as running. The agent is
 * the thread's to change between prompts; the next session is then told what was said.
 *
 * What a thread does while the server runs (its session, turns, queue, status and the cards its
 * agent waits on) is its session's (`thread-session.ts`); this service makes and lists threads
 * and routes each call to the thread's session.
 */
import { NotFound } from "@ultrapaint/contracts/errors";
import type {
  Answers,
  PromptInput,
  Question,
  QueuedPrompt,
  Thread,
  ThreadPurpose,
} from "@ultrapaint/contracts/threads";
import { Clock, Context, Effect, Layer } from "effect";
import { makeId } from "../../ids.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentDiscovery } from "./agent-discovery.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import {
  SWITCHED,
  type ThreadFailure,
  type ThreadSession,
  ThreadSessions,
} from "./thread-session.ts";
import { ThreadStore } from "./thread-store.ts";
import { UNTITLED } from "./turns.ts";

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
      title?: string,
      purpose?: ThreadPurpose
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
    /**
     * Stops the thread's turn and waits for it to end, briefly: what comes next must not run
     * under an agent still writing.
     */
    readonly stop: (threadId: string) => Effect.Effect<void>;
    /** The agent the next prompt goes to; refused while a prompt is accepted or a turn runs. */
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
      const sessions = yield* ThreadSessions;

      /** What the thread's session does. */
      const on = <A, E>(
        threadId: string,
        call: (session: ThreadSession) => Effect.Effect<A, E>
      ) => Effect.flatMap(sessions.of(threadId), call);

      const create = Effect.fn("ThreadService.create")(function* (
        agentId?: string,
        title?: string,
        purpose?: ThreadPurpose
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
          ...(purpose === "implement" && { purpose }),
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
        const agent = yield* agents.get(agentId);
        const options = yield* preferences.optionsFor(agentId);
        // A session belongs to its agent. The next one starts with the next prompt, and is
        // told what was said before it.
        yield* on(threadId, (session) =>
          session.switchAgent(
            {
              configOptions: undefined,
              currentModeId: undefined,
              modes: undefined,
              sandboxed: undefined,
              sandboxProblem: undefined,
              ...options,
              agentId,
              sessionId: undefined,
            },
            `${SWITCHED} ${agent.name}`
          )
        );
        if (options.configOptions === undefined) {
          yield* discovery.discoverInBackground(agentId);
        }
      });

      return ThreadService.of({
        answer: (threadId, itemId, answers) =>
          on(threadId, (session) => session.answer(itemId, answers)),
        ask: (threadId, questions) =>
          on(threadId, (session) => session.cards.ask(questions)),
        cancel: (threadId) => on(threadId, (session) => session.cancel),
        create,
        decline: (threadId, itemId) =>
          on(threadId, (session) => session.cards.decline(itemId)),
        delete: sessions.delete,
        prompt: (input) =>
          on(input.threadId, (session) => session.prompt(input)),
        resolvePermission: (threadId, requestId, optionId, remember) =>
          on(threadId, (session) =>
            session.cards.choose(requestId, optionId, remember)
          ),
        sendQueued: (threadId) => on(threadId, (session) => session.sendQueued),
        setAgent,
        setConfigOption: (threadId, optionId, value) =>
          on(threadId, (session) => session.setConfigOption(optionId, value)),
        setMode: (threadId, modeId) =>
          on(threadId, (session) => session.setMode(modeId)),
        stop: (threadId) => on(threadId, (session) => session.stop),
        unqueue: (threadId, id) =>
          on(threadId, (session) => session.unqueue(id)),
      });
    })
  );
}
