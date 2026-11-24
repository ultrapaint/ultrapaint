/**
 * The cards a thread's agent waits on, as the user sees them in the thread: a permission it asks
 * for, a form an MCP server puts to the user through it within its turn, and the questions of an
 * agent that cannot wait, which the next prompt answers. A card is answerable exactly while an
 * agent waits on it (ADR 0125): it is opened and awaited by the agent's request, resolved by its
 * item id, and every card the agent waits on is let go at once when its turn is stopped or its
 * session ends. A card the agent withdraws itself reads `cancelled` alike (ADR 0109), and so does
 * a form the agent asks again while a copy is open: it waits on the newest. An answer reads as
 * given once it is written to the agent, and each card keeps when and how it stopped waiting.
 *
 * One per thread, made with its session: the cards count the thread's whole life, across its
 * agent's sessions. Nothing is answered from memory: an agent that offers "always" remembers the
 * choice itself (`allow_always`, `reject_always`), for the commands it means it for.
 */
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  Written,
} from "@ultrapaint/acp/acp-agent";
import { Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  type Answers,
  answeredInTurn,
  type CardEnd,
  type Question,
} from "@ultrapaint/contracts/threads";
import { Clock, Deferred, Effect } from "effect";
import type { AppLog } from "../../app-log.ts";
import { makeId } from "../../ids.ts";
import { answersText, contentOf, questionsOf } from "./elicitation.ts";
import type { ThreadStore } from "./thread-store.ts";

const DECLINE: CreateElicitationResponse = { action: "decline" };
const CANCEL: CreateElicitationResponse = { action: "cancel" };
const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

export interface PendingCards {
  /**
   * The user's answers to a question card, recorded on it. The agent waiting on its form gets
   * them back, and this is null once they are written to it, or the card reads `undelivered`
   * when they could not be; a card no agent waits on (one that cannot wait, or one a restart let
   * go) gives the text of the prompt that tells it, which the caller sends.
   */
  readonly answer: (
    itemId: string,
    answers: Answers
  ) => Effect.Effect<string | null, NotFound | Conflict>;
  /** Questions put in the thread for an agent that does not wait: the next prompt answers. */
  readonly ask: (
    questions: readonly Question[]
  ) => Effect.Effect<void, NotFound>;
  /** Whether the agent can be asked with a form, as far as the thread has seen. */
  readonly canWait: Effect.Effect<boolean>;
  /** The user's pick on a permission card, recorded once it is written to the agent. */
  readonly choose: (
    requestId: string,
    optionId: string
  ) => Effect.Effect<void, NotFound>;
  /** The user will not answer a form the agent waits on: it hears "decline". */
  readonly decline: (itemId: string) => Effect.Effect<void, NotFound>;
  /**
   * A form came back declined: whether the user saw it. No card since it was sent means the
   * agent's own client turned it down, and from then on the thread's agent is one that cannot
   * wait on a form.
   */
  readonly declinedSeen: (mark: string | undefined) => Effect.Effect<boolean>;
  /**
   * A form the agent waits on within its turn, drawn as a question card. A link to follow, or a
   * field the card has no input for, is declined at once, without a card. The same questions
   * asked again while a copy is open let the older copy go: the agent waits on the newest.
   */
  readonly elicitation: (
    request: CreateElicitationRequest,
    written: Written
  ) => Effect.Effect<CreateElicitationResponse>;
  /**
   * A form an MCP tool sends through the agent: the mark it is to come back with, the count of
   * cards the agent has waited on so far.
   */
  readonly formSent: Effect.Effect<string>;
  /** A permission the agent asks for, drawn as a card it waits on until the user picks. */
  readonly permission: (
    request: RequestPermissionRequest,
    written: Written
  ) => Effect.Effect<RequestPermissionResponse>;
  /**
   * The agent stops waiting, as when its turn is stopped or its session ends: each permission is
   * answered `cancelled` and each form `cancel`, and their cards say so.
   */
  readonly releaseAll: Effect.Effect<void>;
}

/** A request the agent is waiting on: what settles it, and what tells it was written back. */
interface Pending<A> {
  readonly reply: Deferred.Deferred<A>;
  readonly written: Written;
}

/** A form the agent is waiting on, by its card's item id. */
interface PendingForm extends Pending<CreateElicitationResponse> {
  readonly questions: readonly Question[];
  /** What makes two forms the same questions: their ids, texts and options. */
  readonly questionsKey: string;
}

/**
 * Questions asked again are the same ids, texts, options and answers taken (one or several, a
 * value, an answer of one's own, optional) in the same order.
 */
const questionsKeyOf = (questions: readonly Question[]) =>
  JSON.stringify(
    questions.map((q) => [
      q.id,
      q.question,
      q.multiple ?? false,
      q.value ?? null,
      q.allowOther ?? false,
      q.optional ?? false,
      q.options.map((o) => [o.id, o.label]),
    ])
  );

export const makePendingCards = (
  threadId: string,
  deps: {
    readonly log: AppLog["Service"];
    readonly newItemId: Effect.Effect<string>;
    readonly store: ThreadStore["Service"];
  }
): PendingCards => {
  const { log, newItemId, store } = deps;
  const permissions = new Map<string, Pending<RequestPermissionResponse>>();
  const forms = new Map<string, PendingForm>();
  let shown = 0;
  let cannotWait = false;

  const settledNow = (how: CardEnd) =>
    Effect.map(Clock.currentTimeMillis, (at) => ({ at, how }));

  /** A permission card no longer waiting: what was decided, and how it stopped. */
  const decided = (requestId: string, decision: string, how: CardEnd) =>
    Effect.flatMap(settledNow(how), (settled) =>
      store.patchItem(threadId, requestId, (i) =>
        i.kind === "permission" ? { ...i, decision, settled } : i
      )
    );

  const permission = Effect.fnUntraced(function* (
    request: RequestPermissionRequest,
    written: Written
  ) {
    const { toolCall } = request;
    const requestId = yield* makeId("perm");
    const detail = [
      ...(toolCall.locations ?? []).map((l) => l.path),
      ...(toolCall.rawInput
        ? [JSON.stringify(toolCall.rawInput).slice(0, 500)]
        : []),
    ].join("\n");
    const reply = yield* Deferred.make<RequestPermissionResponse>();
    return yield* Effect.gen(function* () {
      permissions.set(requestId, { reply, written });
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
      return yield* Deferred.await(reply);
    }).pipe(
      // Withdrawn by the agent, from the card's first moment: no longer asked. The pick and the
      // withdrawal settle the same deferred, so the card records whichever came first, and the
      // pick is recorded by `choose`.
      Effect.onInterrupt(() =>
        Effect.flatMap(Deferred.succeed(reply, CANCELLED), (withdrawn) =>
          withdrawn ? decided(requestId, "cancelled", "withdrawn") : Effect.void
        )
      ),
      Effect.ensuring(Effect.sync(() => permissions.delete(requestId)))
    );
  });

  const choose = Effect.fnUntraced(function* (
    requestId: string,
    optionId: string
  ) {
    const pending = permissions.get(requestId);
    if (!pending) {
      return yield* new NotFound({
        message: "permission request is no longer pending",
      });
    }
    // Refused when the agent withdrew the request first.
    const taken = yield* Deferred.succeed(pending.reply, {
      outcome: { optionId, outcome: "selected" },
    });
    if (!taken) {
      return yield* new NotFound({
        message: "permission request is no longer pending",
      });
    }
    // Picked once the agent has the pick.
    yield* decided(
      requestId,
      optionId,
      (yield* pending.written) ? "answered" : "undelivered"
    );
  }, Effect.uninterruptible);

  /** A question card whose agent stopped waiting, for `how`: no longer asked. */
  const cancelled = (itemId: string, how: CardEnd) =>
    Effect.flatMap(settledNow(how), (settled) =>
      store.patchItem(threadId, itemId, (item) =>
        item.kind === "question" && item.answers === null
          ? { ...item, outcome: "cancelled" as const, settled }
          : item
      )
    );

  const elicitation = Effect.fnUntraced(function* (
    request: CreateElicitationRequest,
    written: Written
  ) {
    const questions =
      request.mode === "form" && "requestedSchema" in request
        ? questionsOf(request.requestedSchema)
        : null;
    if (questions === null || questions.length === 0) {
      yield* log.log(
        "agent",
        "info",
        `declined a question the editor cannot show: ${request.message}`
      );
      return DECLINE;
    }
    const itemId = yield* newItemId;
    const reply = yield* Deferred.make<CreateElicitationResponse>();
    const questionsKey = questionsKeyOf(questions);
    return yield* Effect.gen(function* () {
      // Asked again while a copy is open: the agent waits on the newest, and the older copy is
      // no longer asked, so an answer never goes to a request nobody waits on.
      for (const [olderId, older] of forms) {
        if (
          older.questionsKey === questionsKey &&
          (yield* Deferred.succeed(older.reply, CANCEL))
        ) {
          yield* cancelled(olderId, "repeated");
        }
      }
      forms.set(itemId, { questions, questionsKey, reply, written });
      shown += 1;
      yield* store.push(threadId, {
        answers: null,
        at: yield* Clock.currentTimeMillis,
        elicitation: { message: request.message },
        id: itemId,
        kind: "question",
        questions,
      });
      return yield* Deferred.await(reply);
    }).pipe(
      // Withdrawn by the agent (Claude Code's `$/cancel_request`), which no longer listens for
      // the answers: the card says so, as it does when the turn is stopped. The answers and the
      // withdrawal settle the same deferred, so only one of them is ever recorded.
      Effect.onInterrupt(() =>
        Effect.flatMap(Deferred.succeed(reply, CANCEL), (withdrawn) =>
          withdrawn ? cancelled(itemId, "withdrawn") : Effect.void
        )
      ),
      Effect.ensuring(Effect.sync(() => forms.delete(itemId)))
    );
  });

  const ask = Effect.fnUntraced(function* (questions: readonly Question[]) {
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

  const answer = Effect.fnUntraced(function* (
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
    // A form is answered within the agent's turn; the other cards by a prompt of their own.
    const inTurn = answeredInTurn(card);
    const waiting = inTurn ? forms.get(itemId) : undefined;
    if (inTurn && waiting === undefined) {
      return yield* new Conflict({
        message: "the agent no longer waits for these answers",
      });
    }
    // Taken by the agent before they are recorded: answers it withdrew from never read as given,
    // and they read as given once written to it.
    let how: CardEnd = "answered";
    if (waiting !== undefined) {
      const taken = yield* Deferred.succeed(waiting.reply, {
        action: "accept",
        content: contentOf(waiting.questions, answers),
      });
      if (!taken) {
        return yield* new Conflict({
          message: "the agent no longer waits for these answers",
        });
      }
      if (!(yield* waiting.written)) {
        how = "undelivered";
      }
    }
    const settled = yield* settledNow(how);
    yield* store.patchItem(threadId, itemId, (item) =>
      item.kind === "question"
        ? {
            ...item,
            answers,
            settled,
            ...(how === "undelivered"
              ? { outcome: "undelivered" as const }
              : {}),
          }
        : item
    );
    return inTurn ? null : answersText(card.questions, answers);
  }, Effect.uninterruptible);

  const decline = Effect.fnUntraced(function* (itemId: string) {
    const waiting = forms.get(itemId);
    if (waiting === undefined) {
      return yield* new NotFound({
        message: "the agent no longer waits for these answers",
      });
    }
    if (!(yield* Deferred.succeed(waiting.reply, DECLINE))) {
      return yield* new NotFound({
        message: "the agent no longer waits for these answers",
      });
    }
    const settled = yield* settledNow("declined");
    yield* store.patchItem(threadId, itemId, (item) =>
      item.kind === "question"
        ? { ...item, outcome: "declined" as const, settled }
        : item
    );
  });

  const releaseAll = Effect.gen(function* () {
    for (const [requestId, pending] of permissions) {
      if (yield* Deferred.succeed(pending.reply, CANCELLED)) {
        yield* decided(requestId, "cancelled", "released");
      }
    }
    for (const [itemId, pending] of forms) {
      if (yield* Deferred.succeed(pending.reply, CANCEL)) {
        yield* cancelled(itemId, "released");
      }
    }
    forms.clear();
  });
  return {
    answer,
    ask,
    canWait: Effect.sync(() => !cannotWait),
    choose,
    decline,
    declinedSeen: (mark) =>
      Effect.sync(() => {
        if (mark !== String(shown)) {
          return true;
        }
        cannotWait = true;
        return false;
      }),
    elicitation,
    formSent: Effect.sync(() => String(shown)),
    permission,
    releaseAll,
  };
};
