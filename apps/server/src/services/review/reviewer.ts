/**
 * One review model at work (ADR 0063): a fresh session of its agent that can only look. It is
 * started without a thread, so every file, terminal, form and permission it asks for is refused;
 * the sandbox keeps the repository read-only to it, its only writable directory a temporary one
 * that goes with it; and it is put in its agent's read-only mode where the agent has one. Its
 * model and effort are set, it is given the review's prompt, and what it says is read as its
 * answer. Closing the scope it runs in stops it.
 */

import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import {
  AUTH_REQUIRED,
  negotiated,
  promptBlock,
} from "@ultrapaint/acp/negotiated";
import type { ReviewModel } from "@ultrapaint/contracts/review";
import {
  type AgentConfig,
  isEffortOption,
  isModelOption,
} from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Schema, type Scope } from "effect";
import { AgentConfigs } from "../threads/agent-configs.ts";
import { AgentLauncher } from "../threads/agent-launcher.ts";
import { AgentSandbox } from "../threads/agent-sandbox.ts";
import { mapConfigOptions, optionValue } from "../threads/transcript.ts";
import { answerOf, type PageAnswer, UNREADABLE } from "./review-rounds.ts";

/** Why a review model gave no review: what the round shows instead of its score. */
export class ReviewerFailure extends Schema.TaggedError<ReviewerFailure>()(
  "ReviewerFailure",
  { message: Schema.String }
) {}

/** The modes in which an agent only reads: Codex's, then Claude Code's. */
const READ_ONLY_MODES: readonly string[] = ["read-only", "plan"];

/** What went wrong with the agent, said for the round. */
const failureOf = (config: AgentConfig) => (error: AcpError) =>
  new ReviewerFailure({
    message:
      error._tag === "AcpRequestError" && error.code === AUTH_REQUIRED
        ? `${config.name} isn't signed in.${config.authHint ? ` ${config.authHint}` : ""}`
        : `${config.name}: ${error.message}`,
  });

export const makeReviewer = Effect.fnUntraced(function* () {
  const agents = yield* AgentConfigs;
  const launcher = yield* AgentLauncher;
  const sandbox = yield* AgentSandbox;
  const fs = yield* FileSystem.FileSystem;

  /** The model's answer to `prompt`, page by page, in a session of its own on `root`. */
  return Effect.fn("ReviewLoop.reviewer")(function* (
    model: ReviewModel,
    root: string,
    prompt: readonly ContentBlock[]
  ): Effect.fn.Return<readonly PageAnswer[], ReviewerFailure, Scope.Scope> {
    const config = yield* Effect.mapError(
      agents.get(model.agentId),
      () =>
        new ReviewerFailure({
          message: `No agent ${model.agentId} is configured.`,
        })
    );
    const failed = failureOf(config);
    // Its only writable directory, which goes with it: the repository is read-only around it.
    const scratch = yield* Effect.orDie(
      fs.makeTempDirectoryScoped({ prefix: "ultrapaint-review-" })
    );
    const said: string[] = [];
    const agent = yield* launcher
      .launch({
        config,
        host: null,
        listen: ({ update }) =>
          Effect.sync(() => {
            if (
              update.sessionUpdate === "agent_message_chunk" &&
              update.content.type === "text"
            ) {
              said.push(update.content.text);
            }
          }),
        root,
        tmpDir: scratch,
        writable: scratch,
      })
      .pipe(Effect.mapError(failed));
    const agreed = negotiated(yield* Effect.mapError(agent.initialize, failed));
    const session = yield* Effect.mapError(
      agent.newSession(root, {
        meta: sandbox.available ? config.sandboxMeta : undefined,
      }),
      failed
    );
    const { sessionId } = session;
    const options = mapConfigOptions(session.configOptions) ?? [];
    const set = Effect.fnUntraced(function* (
      is: (option: (typeof options)[number]) => boolean,
      value: string | undefined,
      what: string
    ) {
      const option = options.find(is);
      if (value === undefined || option === undefined) {
        return;
      }
      if (!option.options.some((o) => o.value === value)) {
        return yield* new ReviewerFailure({
          message: `${config.name} doesn't offer ${what} ${value}.`,
        });
      }
      if (option.currentValue !== value) {
        yield* Effect.mapError(
          agent.setConfigOption(
            sessionId,
            option.id,
            optionValue(option, value)
          ),
          failed
        );
      }
    });
    yield* set(isModelOption, model.model, "the model");
    yield* set(isEffortOption, model.effort, "the effort");
    const readOnly = session.modes?.availableModes.find((m) =>
      READ_ONLY_MODES.includes(m.id)
    );
    if (readOnly && readOnly.id !== session.modes?.currentModeId) {
      // The sandbox and the refusals keep it from writing whatever its mode.
      yield* Effect.ignore(agent.setMode(sessionId, readOnly.id));
    }
    // What it can't take (a picture, for an agent that sees none) is said as text instead.
    yield* Effect.mapError(
      agent.prompt(
        sessionId,
        prompt.map((block) => promptBlock(agreed, block))
      ),
      failed
    );
    return yield* Effect.fromOption(answerOf(said.join(""))).pipe(
      Effect.mapError(() => new ReviewerFailure({ message: UNREADABLE }))
    );
  }, Effect.scoped);
});
