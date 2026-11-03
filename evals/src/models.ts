/**
 * The models the evals ask to look at pictures and answer: the brief's writer, the judges, the
 * studies. Each runs as the user's own command with its own sign-in: Claude Code by default, a
 * `gpt-` model in Codex, a `cursor-` one in Cursor's agent. A step asks them all the same way, and
 * gets the answer decoded with its own schema.
 */
import { Context, Effect, type FileSystem, Layer, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { askClaude } from "./claude.ts";
import { askCodex } from "./codex.ts";
import { askCursor } from "./cursor.ts";
import { EvalsError } from "./errors.ts";

export interface Question {
  readonly cwd: string;
  /** Other directories it may read, besides `cwd`. */
  readonly dirs?: readonly string[];
  /** How hard it thinks (`medium`, `high`, `max`); the model's default without one. */
  readonly effort?: string;
  /**
   * The pictures, as paths from `cwd`, for a model they are attached to (Codex); the others read
   * the files the prompt names.
   */
  readonly images?: readonly string[];
  /** An alias (`opus`, `sonnet`), a full model name, a `gpt-` model or a `cursor-` one. */
  readonly model: string;
  readonly prompt: string;
}

/** A question as a backend gets it: with the JSON Schema the answer is asked in, if any. */
export interface Asked extends Question {
  readonly schema?: object;
}

/** What a backend answered, before it is decoded. */
export interface Reply {
  /** What it cost, where the backend says (Claude); 0 elsewhere. */
  readonly costUsd: number;
  /** The answer as JSON, when it was asked for in a schema. */
  readonly structured: unknown;
  readonly text: string;
  /** Tokens in and out, where the backend counts them and not its cost (Codex, Cursor); 0 elsewhere. */
  readonly tokens: number;
}

export interface Answered<A> {
  readonly costUsd: number;
  readonly tokens: number;
  readonly value: A;
}

/**
 * The names a model has when it runs in Cursor, so the same model on another plan keeps its notes
 * apart to be compared, and the name Cursor's agent knows it by.
 */
const CURSOR_MODELS: Readonly<Record<string, string>> = {
  "cursor-opus-5.5": "claude-opus-5-5",
  "cursor-opus-5.5-rerun": "claude-opus-5-5",
};

export type Backend = "claude" | "codex" | "cursor";

/** Where a model runs, by its name, and the name it has there. */
const backendOf = (
  model: string
): { readonly kind: Backend; readonly model: string } => {
  const cursorModel = CURSOR_MODELS[model];
  if (cursorModel !== undefined) {
    return { kind: "cursor", model: cursorModel };
  }
  return { kind: model.startsWith("gpt-") ? "codex" : "claude", model };
};

export class Models extends Context.Service<
  Models,
  {
    /**
     * The answer to a question in JSON: `schema` is the JSON Schema the model is told, `decode`
     * the schema its answer is decoded with.
     */
    readonly ask: <A>(
      question: Question & {
        readonly decode: Schema.Decoder<A>;
        readonly schema: object;
      }
    ) => Effect.Effect<Answered<A>, EvalsError>;
    /**
     * Where a model runs, by its name: Codex is given its pictures attached, where the others
     * read the files the prompt names.
     */
    readonly runsIn: (model: string) => Backend;
    /**
     * The answer as text, from Claude: the one step that asks for prose (a pattern book) found
     * that an enforced format made it terse.
     */
    readonly write: (
      question: Question
    ) => Effect.Effect<
      { readonly costUsd: number; readonly text: string },
      EvalsError
    >;
  }
>()("ultrapaint/evals/Models") {
  static readonly layer = Layer.effect(
    Models,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
      >();

      const ask = <A>(
        question: Question & {
          readonly decode: Schema.Decoder<A>;
          readonly schema: object;
        }
      ) => {
        const { decode: schema, ...asked } = question;
        const backend = backendOf(question.model);
        const decode = (reply: Reply, strict: boolean) =>
          Schema.decodeUnknownEffect(schema)(reply.structured, {
            onExcessProperty: strict ? "error" : "ignore",
          }).pipe(
            Effect.mapError(
              (issue) =>
                new EvalsError({
                  message: `${question.model}'s answer does not fit: ${issue}`,
                })
            ),
            Effect.map(
              (value): Answered<A> => ({
                costUsd: reply.costUsd,
                tokens: reply.tokens,
                value,
              })
            )
          );
        if (backend.kind === "cursor") {
          // Told its schema in words, it can miss it: one more try, and nothing it was not
          // asked for.
          return askCursor({
            ...asked,
            model: `${backend.model}${question.effort ? `-${question.effort}` : ""}`,
          }).pipe(
            Effect.flatMap((reply) => decode(reply, true)),
            Effect.retry({ times: 1 }),
            Effect.provideContext(context)
          );
        }
        const run = backend.kind === "codex" ? askCodex : askClaude;
        return run(asked).pipe(
          Effect.flatMap((reply) => decode(reply, false)),
          Effect.provideContext(context)
        );
      };

      const write = (question: Question) =>
        askClaude(question).pipe(
          Effect.map((reply) => ({ costUsd: reply.costUsd, text: reply.text })),
          Effect.provideContext(context)
        );

      return Models.of({
        ask,
        runsIn: (model) => backendOf(model).kind,
        write,
      });
    })
  );

  /**
   * Models that answer from a script, for tests: each question gets what `answer` returns for it,
   * decoded with the question's schema as a real answer is.
   */
  static readonly layerTest = (answer: (question: Asked) => unknown) =>
    Layer.succeed(
      Models,
      Models.of({
        ask: (question) =>
          Schema.decodeUnknownEffect(question.decode)(answer(question)).pipe(
            Effect.mapError(
              (issue) =>
                new EvalsError({
                  message: `the scripted answer does not fit: ${issue}`,
                })
            ),
            Effect.map((value) => ({ costUsd: 0, tokens: 0, value }))
          ),
        runsIn: (model) => backendOf(model).kind,
        write: (question) =>
          Effect.succeed({ costUsd: 0, text: String(answer(question)) }),
      })
    );
}
