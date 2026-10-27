/**
 * The cards a thread's agent waits on, through their module's interface: each kind opened,
 * answered, declined and let go, the choices remembered for a session, and the mark a form
 * comes back with.
 */
import { assert, describe, it } from "@effect/vitest";
import type {
  CreateElicitationRequest,
  RequestPermissionRequest,
} from "@ultrapaint/acp/acp-agent";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, Fiber } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeId } from "../../ids.ts";
import {
  ThreadTest,
  type ThreadTestServices,
  threadWhen,
} from "../../testing/threads.ts";
import { makePendingCards } from "./pending-cards.ts";
import { ThreadStore } from "./thread-store.ts";

const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>
) => it.effect(name, () => Effect.provide(body(), ThreadTest));

/** A thread in the store, and its cards. */
const cardsOfNewThread = Effect.gen(function* () {
  const store = yield* ThreadStore;
  const threadId = yield* makeId("thread");
  yield* store.add({
    agentId: "scripted",
    createdAt: 0,
    id: threadId,
    status: "running",
    title: "Cards",
    updatedAt: 0,
  });
  const cards = makePendingCards(threadId, {
    log: yield* AppLog,
    newItemId: makeId("item"),
    store,
  });
  return { cards, store, threadId };
});

const EDIT_HOME = {
  options: [
    { kind: "allow_once", name: "Allow", optionId: "allow" },
    { kind: "reject_once", name: "Reject", optionId: "reject" },
  ],
  sessionId: "session_1",
  toolCall: { kind: "edit", title: "Edit home", toolCallId: "call_2" },
} as RequestPermissionRequest;

const PLAN_FORM = {
  message: "Pick a plan",
  mode: "form",
  requestedSchema: {
    properties: {
      plan: {
        oneOf: [
          { const: "free", title: "Free" },
          { const: "pro", title: "Pro" },
        ],
        title: "Which plan?",
        type: "string",
      },
    },
    required: ["plan"],
    type: "object",
  },
  sessionId: "session_1",
} as CreateElicitationRequest;

const QUESTIONS = [
  {
    id: "plan",
    options: [
      { id: "free", label: "Free" },
      { id: "pro", label: "Pro" },
    ],
    question: "Which plan?",
  },
];

/** The thread's cards of a kind, once there are `n` of them. */
const cardsWhen = (threadId: string, kind: "permission" | "question", n = 1) =>
  Effect.map(
    threadWhen(
      threadId,
      (_, items) => items.filter((i) => i.kind === kind).length >= n
    ),
    ({ items }) => items.filter((i) => i.kind === kind)
  );

const decisionOf = (item: ThreadItem | undefined) =>
  item?.kind === "permission" ? item.decision : undefined;

describe("a permission card", () => {
  test("waits for the user's pick, and the card records it", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const asking = yield* Effect.forkChild(cards.permission(EDIT_HOME));
      const [card] = yield* cardsWhen(threadId, "permission");
      assert.isNull(decisionOf(card));
      yield* cards.choose(card?.id ?? "", "reject", false);
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { optionId: "reject", outcome: "selected" },
      });
      const [after] = (yield* store.items(threadId)).filter(
        (i) => i.kind === "permission"
      );
      assert.strictEqual(decisionOf(after), "reject");
      // Answered once: it is no longer pending.
      const again = yield* Effect.flip(
        cards.choose(card?.id ?? "", "allow", false)
      );
      assert.strictEqual(again._tag, "NotFound");
    }));

  test("is answered by a choice remembered, until the session ends", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const asking = yield* Effect.forkChild(cards.permission(EDIT_HOME));
      const [card] = yield* cardsWhen(threadId, "permission");
      yield* cards.choose(card?.id ?? "", "allow", true);
      yield* Fiber.join(asking);
      // The same kind of tool: no second card.
      assert.deepStrictEqual(yield* cards.permission(EDIT_HOME), {
        outcome: { optionId: "allow", outcome: "selected" },
      });
      // A new session asks again.
      yield* cards.endSession;
      yield* Effect.forkChild(cards.permission(EDIT_HOME));
      const open = yield* cardsWhen(threadId, "permission", 2);
      assert.isNull(decisionOf(open.at(-1)));
    }));

  test("is answered cancelled when the cards are let go", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const asking = yield* Effect.forkChild(cards.permission(EDIT_HOME));
      yield* cardsWhen(threadId, "permission");
      yield* cards.releaseAll;
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { outcome: "cancelled" },
      });
      const [card] = (yield* store.items(threadId)).filter(
        (i) => i.kind === "permission"
      );
      assert.strictEqual(decisionOf(card), "cancelled");
    }));
});

describe("a form the agent waits on", () => {
  test("is answered within the turn: the answers go back typed, and no prompt follows", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const reply = yield* Effect.forkChild(cards.elicitation(PLAN_FORM));
      const [card] = yield* cardsWhen(threadId, "question");
      assert.isNull(yield* cards.answer(card?.id ?? "", { plan: "pro" }));
      assert.deepStrictEqual(yield* Fiber.join(reply), {
        action: "accept",
        content: { plan: "pro" },
      });
      const late = yield* Effect.flip(
        cards.answer(card?.id ?? "", { plan: "free" })
      );
      assert.include(late.message, "already answered");
    }));

  test("is declined by the user, and the agent hears so", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const reply = yield* Effect.forkChild(cards.elicitation(PLAN_FORM));
      const [card] = yield* cardsWhen(threadId, "question");
      yield* cards.decline(card?.id ?? "");
      assert.deepStrictEqual(yield* Fiber.join(reply), { action: "decline" });
      const [after] = (yield* store.items(threadId)).filter(
        (i) => i.kind === "question"
      );
      assert.strictEqual(
        after?.kind === "question" && after.outcome,
        "declined"
      );
    }));

  test("is let go with the cards: the agent hears cancel, and it cannot be answered after", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const reply = yield* Effect.forkChild(cards.elicitation(PLAN_FORM));
      const [card] = yield* cardsWhen(threadId, "question");
      yield* cards.releaseAll;
      assert.deepStrictEqual(yield* Fiber.join(reply), { action: "cancel" });
      const answered = yield* Effect.flip(
        cards.answer(card?.id ?? "", { plan: "free" })
      );
      assert.include(answered.message, "already answered");
      const declined = yield* Effect.flip(cards.decline(card?.id ?? ""));
      assert.strictEqual(declined._tag, "NotFound");
    }));

  test("that cannot be drawn is declined at once, and not counted", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const reply = yield* cards.elicitation({
        elicitationId: "el_1",
        message: "Sign in",
        mode: "url",
        sessionId: "session_1",
        url: "https://example.com/sign-in",
      });
      assert.deepStrictEqual(reply, { action: "decline" });
      assert.lengthOf(yield* store.items(threadId), 0);
      assert.strictEqual(yield* cards.formSent, "0");
    }));
});

describe("questions the next prompt answers", () => {
  test("give the prompt's text, and are not let go with the cards the agent waits on", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      yield* cards.ask(QUESTIONS);
      const [card] = yield* store.items(threadId);
      yield* cards.releaseAll;
      const text = yield* cards.answer(card?.id ?? "", { plan: "pro" });
      assert.include(text ?? "", "1. Which plan? — Pro [pro]");
      const [after] = yield* store.items(threadId);
      assert.deepStrictEqual(after?.kind === "question" && after.answers, {
        plan: "pro",
      });
      const twice = yield* Effect.flip(
        cards.answer(card?.id ?? "", { plan: "free" })
      );
      assert.strictEqual(twice._tag, "Conflict");
    }));

  test("are not put in a thread that is gone", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      yield* store.remove(threadId);
      const error = yield* Effect.flip(cards.ask(QUESTIONS));
      assert.strictEqual(error._tag, "NotFound");
    }));
});

describe("a form sent by a tool", () => {
  test("declined with no card shown since means the agent cannot wait on forms", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      assert.isTrue(yield* cards.canWait);
      // Shown: a card came between the form going out and its answer.
      const mark = yield* cards.formSent;
      const reply = yield* Effect.forkChild(cards.elicitation(PLAN_FORM));
      const [card] = yield* cardsWhen(threadId, "question");
      yield* cards.decline(card?.id ?? "");
      yield* Fiber.join(reply);
      assert.isTrue(yield* cards.declinedSeen(mark));
      assert.isTrue(yield* cards.canWait);
      // Not shown: the agent's own client turned it down.
      assert.isFalse(yield* cards.declinedSeen(yield* cards.formSent));
      assert.isFalse(yield* cards.canWait);
    }));
});
