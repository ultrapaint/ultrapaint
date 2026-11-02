/**
 * `ask_user`: questions for the user, answered while the agent waits.
 *
 * In MCP 2026-07-28 a tool that needs the user answers "input required" with a form; the agent
 * asks its client — for a thread, the editor, over ACP — and calls the tool again with the
 * answers, which the tool then returns. Nothing is held open while the user thinks, and the
 * agent carries on in the same turn. The other tools answer at once, so this one is answered by
 * hand (`rawTool`), as `get_screenshot` is.
 *
 * An agent on an older revision, or one whose client cannot show a form, gets the card the old
 * way: it is put in the thread, and the agent ends its turn to hear the answers as its next
 * prompt.
 */
import { Effect, Schema } from "effect";
import { McpSchema, Tool } from "effect/ai";
import { TOOLS } from "../threads/agent-ways.ts";
import { answersOf, answersText, formOf } from "../threads/elicitation.ts";
import { ThreadSessions } from "../threads/thread-session.ts";
import { CallingThread } from "./access.ts";
import { doing, opt, rawTool, said } from "./tool-helpers.ts";

/** The key the answers come back under, on the agent's second call. */
const ANSWERS = "answers";
const WAITING_REVISION = "2026-07-28";

const AskQuestion = Schema.Struct({
  /** The user may type an answer of their own instead of picking one. */
  allowOther: opt(Schema.Boolean),
  id: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      description: opt(Schema.String),
      id: Schema.String,
      label: Schema.String,
    })
  ),
  question: Schema.String,
});

export const AskUser = Tool.make("ask_user", {
  description:
    "Ask the user up to four questions when a decision is theirs: options (short labels, your pick first), allowOther for their own. The result is the answers; if it says they were shown, end your turn.",
  parameters: Schema.Struct({
    questions: Schema.Array(AskQuestion).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4)
    ),
  }),
}).annotateMerge(doing("read"));

/** What the agent hears, once the user has answered, declined or let the card go. */
const replyOf = (
  questions: typeof AskUser.parametersSchema.Type.questions,
  response: Record<string, unknown>
) => {
  switch (response.action) {
    case "accept":
      return said(
        answersText(questions, answersOf(questions, response.content))
      );
    case "decline":
      return said(
        "The user declined to answer. Decide yourself, and say what you chose."
      );
    default:
      return said(
        "The questions were dismissed before they were answered. Do not ask again unless the user does."
      );
  }
};

/** `ask_user`, answered with a form to fill, the answers, or the card put in the thread. */
export const askUserTool = Effect.gen(function* () {
  const sessions = yield* ThreadSessions;

  const ask = Effect.fn("AskUserTool.ask_user")(function* ({
    questions,
  }: typeof AskUser.parametersSchema.Type) {
    const request = yield* McpSchema.McpRequestContext;
    const threadId = yield* Effect.service(CallingThread);
    // The cards of the thread asking, which tell whether its agent's client shows forms.
    const cards =
      threadId === undefined ? undefined : (yield* sessions.of(threadId)).cards;
    const answered = request.inputResponses?.[ANSWERS];
    if (answered !== undefined) {
      // Declined, yet the thread showed no card since the form went out: the agent's own
      // client turned it down, and the user never saw the questions. Codex does under full
      // access: it declines every form unless its client says it shows them, which codex-acp
      // does not yet. The thread's agent is not asked with a form again.
      const seen =
        answered.action !== "decline" ||
        cards === undefined ||
        (yield* cards.declinedSeen(request.requestState));
      if (seen) {
        return replyOf(questions, answered);
      }
    }
    const canWait =
      answered === undefined &&
      request.protocolVersion === WAITING_REVISION &&
      request.clientCapabilities.elicitation !== undefined &&
      (cards === undefined || (yield* cards.canWait));
    if (canWait) {
      return new McpSchema.InputRequired({
        inputRequests: {
          [ANSWERS]: {
            method: "elicitation/create",
            params: {
              message: "The agent asks",
              mode: "form",
              requestedSchema: formOf(questions),
            },
          },
        },
        // Comes back with the answers, for the thread to tell whether it showed the form.
        requestState: cards === undefined ? "0" : yield* cards.formSent,
      });
    }
    if (threadId === undefined) {
      return said(
        `${TOOLS.ask_user} needs a client that shows forms, or a thread of the editor; ask in your own conversation instead`,
        true
      );
    }
    return yield* Effect.flatMap(sessions.of(threadId), (session) =>
      session.cards.ask(questions)
    ).pipe(
      Effect.as(
        said(
          "The questions are shown to the user. End your turn now; the answers come as the next message."
        )
      ),
      Effect.catchTag("NotFound", (error) =>
        Effect.succeed(said(error.message, true))
      )
    );
  });

  return rawTool(AskUser, ask);
});
