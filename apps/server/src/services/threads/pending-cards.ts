/**
 * The cards a thread's agent waits on, as the user sees them in the thread: a permission it asks
 * for, a form an MCP server puts to the user through it within its turn, and the questions of an
 * agent that cannot wait, which the next prompt answers. A card is opened and awaited by the
 * agent's request, resolved by its item id, and every card the agent waits on is let go at once
 * when its turn is stopped or its session ends.
 *
 * One per thread, made with its session: the cards count the thread's whole life, across its
 * agent's sessions, while a choice remembered is the session's.
 */
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@ultrapaint/acp/acp-agent";
import { Conflict, NotFound } from "@ultrapaint/contracts/errors";
import type { Answers, Question } from "@ultrapaint/contracts/threads";
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
   * them back, and this is null; a card it did not wait on gives the text of the prompt that
   * tells it, which the caller sends.
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
  /** The user's pick on a permission card, remembered for the session when asked to be. */
  readonly choose: (
    requestId: string,
    optionId: string,
    remember: boolean
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
   * field the card has no input for, is declined at once, without a card.
   */
  readonly elicitation: (
    request: CreateElicitationRequest
  ) => Effect.Effect<CreateElicitationResponse>;
  /** The session ended: what it waited on is let go, and the choices it remembered go. */
  readonly endSession: Effect.Effect<void>;
  /**
   * A form an MCP tool sends through the agent: the mark it is to come back with, the count of
   * cards the agent has waited on so far.
   */
  readonly formSent: Effect.Effect<string>;
  /**
   * A permission the agent asks for: answered by a choice remembered in this session for its
   * kind of tool, else drawn as a card the agent waits on until the user picks an option.
   */
  readonly permission: (
    request: RequestPermissionRequest
  ) => Effect.Effect<RequestPermissionResponse>;
  /**
   * The agent stops waiting, as when its turn is stopped: each permission is answered
   * `cancelled` and each form `cancel`, and their cards say so.
   */
  readonly releaseAll: Effect.Effect<void>;
}

interface PendingPermission {
  readonly decision: Deferred.Deferred<RequestPermissionResponse>;
  /** What "remember this choice" is keyed by: the tool kind, else its title. */
  readonly rememberKey: string;
}

/** A form the agent is waiting on, by its card's item id. */
interface PendingForm {
  readonly questions: readonly Question[];
  readonly reply: Deferred.Deferred<CreateElicitationResponse>;
}

export const makePendingCards = (
  threadId: string,
  deps: {
    readonly log: AppLog["Service"];
    readonly newItemId: Effect.Effect<string>;
    readonly store: ThreadStore["Service"];
  }
): PendingCards => {
  const { log, newItemId, store } = deps;
  const permissions = new Map<string, PendingPermission>();
  const forms = new Map<string, PendingForm>();
  const remembered = new Map<string, string>();
  let shown = 0;
  let cannotWait = false;

  const permission = Effect.fnUntraced(function* (
    request: RequestPermissionRequest
  ) {
    const { toolCall } = request;
    const rememberKey = toolCall.kind ?? toolCall.title ?? "tool";
    const chosen = remembered.get(rememberKey);
    if (chosen && request.options.some((o) => o.optionId === chosen)) {
      return {
        outcome: { optionId: chosen, outcome: "selected" },
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
    permissions.set(requestId, { decision, rememberKey });
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
    permissions.delete(requestId);
    const picked =
      response.outcome.outcome === "selected"
        ? response.outcome.optionId
        : "cancelled";
    yield* store.patchItem(threadId, requestId, (i) =>
      i.kind === "permission" ? { ...i, decision: picked } : i
    );
    return response;
  });

  const choose = Effect.fnUntraced(function* (
    requestId: string,
    optionId: string,
    remember: boolean
  ) {
    const pending = permissions.get(requestId);
    if (!pending) {
      return yield* new NotFound({
        message: "permission request is no longer pending",
      });
    }
    if (remember) {
      remembered.set(pending.rememberKey, optionId);
    }
    yield* Deferred.succeed(pending.decision, {
      outcome: { optionId, outcome: "selected" },
    });
  });

  const elicitation = Effect.fnUntraced(function* (
    request: CreateElicitationRequest
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
    forms.set(itemId, { questions, reply });
    shown += 1;
    yield* store.push(threadId, {
      answers: null,
      at: yield* Clock.currentTimeMillis,
      elicitation: { message: request.message },
      id: itemId,
      kind: "question",
      questions,
    });
    return yield* Deferred.await(reply).pipe(
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
    const waiting =
      card.elicitation === undefined ? undefined : forms.get(itemId);
    if (card.elicitation !== undefined && waiting === undefined) {
      return yield* new Conflict({
        message: "the agent no longer waits for these answers",
      });
    }
    yield* store.patchItem(threadId, itemId, (item) =>
      item.kind === "question" ? { ...item, answers } : item
    );
    if (waiting === undefined) {
      return answersText(card.questions, answers);
    }
    yield* Deferred.succeed(waiting.reply, {
      action: "accept",
      content: contentOf(waiting.questions, answers),
    });
    return null;
  });

  const decline = Effect.fnUntraced(function* (itemId: string) {
    const waiting = forms.get(itemId);
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

  const releaseAll = Effect.gen(function* () {
    // Each permission's card is written by the request that waits on it, once it hears.
    for (const pending of permissions.values()) {
      yield* Deferred.succeed(pending.decision, CANCELLED);
    }
    for (const [itemId, pending] of forms) {
      yield* store.patchItem(threadId, itemId, (item) =>
        item.kind === "question" && item.answers === null
          ? { ...item, outcome: "cancelled" as const }
          : item
      );
      yield* Deferred.succeed(pending.reply, CANCEL);
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
    endSession: Effect.andThen(
      releaseAll,
      Effect.sync(() => remembered.clear())
    ),
    formSent: Effect.sync(() => String(shown)),
    permission,
    releaseAll,
  };
};
