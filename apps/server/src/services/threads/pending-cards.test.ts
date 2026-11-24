/**
 * The cards a thread's agent waits on, through their module's interface: each kind opened,
 * answered, declined and let go, and the mark a form comes back with.
 */
import { assert, describe } from "@effect/vitest";
import {
  type CreateElicitationRequest,
  type RequestPermissionRequest,
  writtenAtOnce,
} from "@ultrapaint/acp/acp-agent";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Deferred, Effect, Fiber } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeId } from "../../ids.ts";
import { perTest } from "../../testing/each-test.ts";
import {
  ThreadTest,
  type ThreadTestServices,
  threadWhen,
} from "../../testing/threads.ts";
import { makePendingCards } from "./pending-cards.ts";
import { ThreadStore } from "./thread-store.ts";

/** On the test clock from `TEST_EPOCH` (docs/TESTING.md rule 3). */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>
) => perTest(ThreadTest).effect(name, body);

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

/** How a card stopped waiting, as the thread keeps it. */
const settledOf = (item: ThreadItem | undefined) =>
  item?.kind === "permission" || item?.kind === "question"
    ? item.settled?.how
    : undefined;

const outcomeOf = (item: ThreadItem | undefined) =>
  item?.kind === "question" ? item.outcome : undefined;

/** The thread's question cards, as the store has them now. */
const questionsIn = (threadId: string) =>
  Effect.map(
    Effect.flatMap(ThreadStore, (store) => store.items(threadId)),
    (items) => items.filter((i) => i.kind === "question")
  );

const TIERS_FORM = {
  ...PLAN_FORM,
  requestedSchema: {
    properties: {
      tier: {
        oneOf: [
          { const: "basic", title: "Basic" },
          { const: "team", title: "Team" },
        ],
        title: "Which tier?",
        type: "string",
      },
    },
    required: ["tier"],
    type: "object",
  },
} as CreateElicitationRequest;

describe("a permission card", () => {
  test("waits for the user's pick, and the card records it", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const asking = yield* Effect.forkChild(
        cards.permission(EDIT_HOME, writtenAtOnce)
      );
      const [card] = yield* cardsWhen(threadId, "permission");
      assert.isNull(decisionOf(card));
      yield* cards.choose(card?.id ?? "", "reject");
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { optionId: "reject", outcome: "selected" },
      });
      const [after] = (yield* store.items(threadId)).filter(
        (i) => i.kind === "permission"
      );
      assert.strictEqual(decisionOf(after), "reject");
      // Answered once: it is no longer pending.
      const again = yield* Effect.flip(cards.choose(card?.id ?? "", "allow"));
      assert.strictEqual(again._tag, "NotFound");
    }));

  test("allowing one command does not answer the next, different one", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const run = (command: string, toolCallId: string) =>
        ({
          options: [
            { kind: "allow_once", name: "Allow", optionId: "allow" },
            { kind: "reject_once", name: "Reject", optionId: "reject" },
          ],
          sessionId: "session_1",
          toolCall: { kind: "execute", title: command, toolCallId },
        }) as RequestPermissionRequest;
      const asking = yield* Effect.forkChild(
        cards.permission(run("pnpm test", "call_1"), writtenAtOnce)
      );
      const [card] = yield* cardsWhen(threadId, "permission");
      yield* cards.choose(card?.id ?? "", "allow");
      yield* Fiber.join(asking);
      // Another command: the user is asked about it, whatever was allowed before.
      yield* Effect.forkChild(
        cards.permission(run("rm -rf src", "call_2"), writtenAtOnce)
      );
      const open = yield* cardsWhen(threadId, "permission", 2);
      assert.isNull(decisionOf(open.at(-1)));
    }));

  test("is answered cancelled when the cards are let go", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      const asking = yield* Effect.forkChild(
        cards.permission(EDIT_HOME, writtenAtOnce)
      );
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
      const reply = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
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
      const reply = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
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
      const reply = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
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
      const reply = yield* cards.elicitation(
        {
          elicitationId: "el_1",
          message: "Sign in",
          mode: "url",
          sessionId: "session_1",
          url: "https://example.com/sign-in",
        },
        writtenAtOnce
      );
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
      const reply = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
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

describe("a card's life (ADR 0125)", () => {
  test("a form asked again while a copy is open lets the older copy go", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const first = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
      yield* cardsWhen(threadId, "question");
      const second = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
      const [older, newer] = yield* cardsWhen(threadId, "question", 2);
      assert.deepStrictEqual(yield* Fiber.join(first), { action: "cancel" });
      const [olderNow] = yield* questionsIn(threadId);
      assert.strictEqual(outcomeOf(olderNow), "cancelled");
      assert.strictEqual(settledOf(olderNow), "repeated");
      // The newest is the one the agent waits on, and it hears the answers.
      assert.isNull(yield* cards.answer(newer?.id ?? "", { plan: "pro" }));
      assert.deepStrictEqual(yield* Fiber.join(second), {
        action: "accept",
        content: { plan: "pro" },
      });
      const late = yield* Effect.flip(
        cards.answer(older?.id ?? "", { plan: "free" })
      );
      assert.strictEqual(late._tag, "Conflict");
    }));

  test("two different forms both stay open, the oldest first", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const plan = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, writtenAtOnce)
      );
      yield* cardsWhen(threadId, "question");
      const tier = yield* Effect.forkChild(
        cards.elicitation(TIERS_FORM, writtenAtOnce)
      );
      const [first, second] = yield* cardsWhen(threadId, "question", 2);
      assert.isUndefined(outcomeOf(first));
      yield* cards.answer(first?.id ?? "", { plan: "pro" });
      yield* cards.answer(second?.id ?? "", { tier: "team" });
      assert.deepStrictEqual(yield* Fiber.join(plan), {
        action: "accept",
        content: { plan: "pro" },
      });
      assert.deepStrictEqual(yield* Fiber.join(tier), {
        action: "accept",
        content: { tier: "team" },
      });
    }));

  test("answers that could not be written to the agent read undelivered", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, Effect.succeed(false))
      );
      const [card] = yield* cardsWhen(threadId, "question");
      assert.isNull(yield* cards.answer(card?.id ?? "", { plan: "pro" }));
      const [after] = yield* questionsIn(threadId);
      assert.strictEqual(outcomeOf(after), "undelivered");
      assert.strictEqual(settledOf(after), "undelivered");
      // What the person said stays on the card, to say again.
      assert.deepStrictEqual(after?.kind === "question" && after.answers, {
        plan: "pro",
      });
    }));

  test("an answer reads as given only once it is written to the agent", () =>
    Effect.gen(function* () {
      const { cards, threadId } = yield* cardsOfNewThread;
      const written = yield* Deferred.make<boolean>();
      const reply = yield* Effect.forkChild(
        cards.elicitation(PLAN_FORM, Deferred.await(written))
      );
      const [card] = yield* cardsWhen(threadId, "question");
      const answering = yield* Effect.forkChild(
        cards.answer(card?.id ?? "", { plan: "pro" })
      );
      // The agent has the answers in hand, and they are yet to be written to it.
      yield* Fiber.join(reply);
      const [before] = yield* questionsIn(threadId);
      assert.isTrue(before?.kind === "question" && before.answers === null);
      yield* Deferred.succeed(written, true);
      yield* Fiber.join(answering);
      const [after] = yield* questionsIn(threadId);
      assert.strictEqual(settledOf(after), "answered");
      assert.isUndefined(outcomeOf(after));
    }));

  test("each card keeps when and how it stopped waiting", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      // Picked, declined, withdrawn, and let go with the turn.
      const picked = yield* Effect.forkChild(
        cards.permission(EDIT_HOME, writtenAtOnce)
      );
      const [permission] = yield* cardsWhen(threadId, "permission");
      yield* cards.choose(permission?.id ?? "", "allow");
      yield* Fiber.join(picked);
      yield* Effect.forkChild(cards.elicitation(PLAN_FORM, writtenAtOnce));
      const [declined] = yield* cardsWhen(threadId, "question");
      yield* cards.decline(declined?.id ?? "");
      const withdrawn = yield* Effect.forkChild(
        cards.elicitation(TIERS_FORM, writtenAtOnce)
      );
      yield* cardsWhen(threadId, "question", 2);
      yield* Fiber.interrupt(withdrawn);
      yield* Effect.forkChild(cards.permission(EDIT_HOME, writtenAtOnce));
      yield* cardsWhen(threadId, "permission", 2);
      yield* cards.releaseAll;
      const items = yield* store.items(threadId);
      assert.deepStrictEqual(items.map(settledOf), [
        "answered",
        "declined",
        "withdrawn",
        "released",
      ]);
      for (const item of items) {
        assert.isTrue(
          (item.kind === "permission" || item.kind === "question") &&
            item.settled !== undefined &&
            item.settled.at >= item.at
        );
      }
    }));

  test("questions a restart let go are answered by the next prompt", () =>
    Effect.gen(function* () {
      const { cards, store, threadId } = yield* cardsOfNewThread;
      yield* store.push(threadId, {
        answers: null,
        at: 1,
        elicitation: { message: "The agent asks" },
        id: "item_restarted",
        kind: "question",
        questions: QUESTIONS,
        restartedAt: 2,
      });
      const text = yield* cards.answer("item_restarted", { plan: "pro" });
      assert.include(text ?? "", "1. Which plan? — Pro [pro]");
      const [after] = yield* questionsIn(threadId);
      assert.strictEqual(settledOf(after), "answered");
    }));
});
