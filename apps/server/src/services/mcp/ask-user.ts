/**
 * `ask_user`: questions for the user, answered while the agent waits.
 *
 * In MCP 2026-07-28 a tool that needs the user answers "input required" with a form; the agent
 * asks its client — for a thread, the editor, over ACP — and calls the tool again with the
 * answers, which the tool then returns. Nothing is held open while the user thinks, and the
 * agent carries on in the same turn. The other tools answer at once, so this one is registered
 * by hand, as `get_screenshot` is.
 *
 * An agent on an older revision, or one whose client cannot show a form, gets the card the old
 * way: it is put in the thread, and the agent ends its turn to hear the answers as its next
 * prompt.
 */
import { Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool } from "effect/ai";
import { answersOf, answersText, formOf } from "../threads/elicitation.ts";
import { ThreadService } from "../threads/threads.ts";
import { CallingThread } from "./access.ts";
import { opt } from "./tools.ts";

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

const AskUser = Tool.make("ask_user", {
  description:
    "Ask the user one to four questions when a decision is theirs, each with options to pick from (short labels, the one you would choose first) and allowOther for an answer of their own. You get the answers as this tool's result. If the result says the questions were shown instead, end your turn: the answers come as the next message.",
  parameters: Schema.Struct({
    questions: Schema.Array(AskQuestion).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4)
    ),
  }),
});

const decodeParameters = Schema.decodeUnknownEffect(AskUser.parametersSchema);

const said = (text: string, isError = false) =>
  new McpSchema.CallToolResult({ content: [{ text, type: "text" }], isError });

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

export const AskUserToolLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const threads = yield* ThreadService;
    /**
     * Threads whose agent turns forms down by itself. Codex does under full access: it declines
     * every form unless its client says it shows them, which codex-acp does not yet.
     */
    const cannotWait = new Set<string>();

    const ask = Effect.fnUntraced(function* (payload: unknown) {
      const { questions } = yield* decodeParameters(payload ?? {}).pipe(
        Effect.mapError(
          (error) => new McpSchema.InvalidParams({ message: error.message })
        )
      );
      const request = yield* McpSchema.McpRequestContext;
      const threadId = yield* Effect.service(CallingThread);
      const answered = request.inputResponses?.[ANSWERS];
      if (answered !== undefined) {
        // Declined, yet the thread showed no card since the form went out: the agent's own
        // client turned it down, and the user never saw the questions.
        const unseen =
          answered.action === "decline" &&
          threadId !== undefined &&
          request.requestState === String(yield* threads.cardsShown(threadId));
        if (!unseen) {
          return replyOf(questions, answered);
        }
        cannotWait.add(threadId);
      }
      const canWait =
        answered === undefined &&
        request.protocolVersion === WAITING_REVISION &&
        request.clientCapabilities.elicitation !== undefined &&
        !(threadId !== undefined && cannotWait.has(threadId));
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
          // Comes back with the answers: how many cards the thread had shown when it asked.
          requestState: String(
            threadId === undefined ? 0 : yield* threads.cardsShown(threadId)
          ),
        });
      }
      if (threadId === undefined) {
        return said(
          "ask_user needs a client that shows forms, or a thread of the editor; ask in your own conversation instead",
          true
        );
      }
      return yield* threads.ask(threadId, questions).pipe(
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

    yield* server.addTool({
      annotations: AskUser.annotations,
      handle: ask,
      tool: new McpSchema.Tool({
        description: Tool.getDescription(AskUser),
        inputSchema: Tool.getJsonSchema(AskUser) as McpSchema.ToolJson,
        name: AskUser.name,
      }),
    });
  })
);
