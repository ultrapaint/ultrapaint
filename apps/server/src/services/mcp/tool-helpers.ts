/**
 * What every MCP tool of the editor shares: the failure it reports, the way it reports one, the
 * parameter shapes that keep the tools' schemas short for the agent that reads them, and the
 * adapter of a tool that answers by hand (`rawTool`).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { Context, Effect, Schema } from "effect";
import { McpSchema, type McpServer, Tool } from "effect/ai";
import { TOOLS } from "../threads/agent-ways.ts";

/**
 * What a tool says when it cannot answer: the reason, in words the agent can act on. An error
 * class, not a plain struct: the MCP server passes a failure's message to the agent only when it
 * is an `Error`, and says "internal server error" for anything else.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()(
  "ToolFailure",
  {
    message: Schema.String,
  }
) {}

/**
 * A parameter an agent may leave out. `optionalKey`, not `optional`: the latter also takes
 * `undefined`, which JSON Schema can only say as `null`, and every optional field of every
 * tool would carry an `anyOf` the agent pays for and never needs.
 */
export const opt = Schema.optionalKey;

/** A number an agent passes. Plain `Number` also admits "NaN" and "Infinity" as strings. */
export const finite = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ maximum, minimum }));

/**
 * JSON an agent passes, which the handler validates itself and says what is wrong. `Json`
 * would describe itself to the agent as a recursive schema of every JSON value.
 */
export const AnyJson = Schema.Unknown;

/**
 * What a failure of a kind says to an agent, where its own message is the editor's words, written
 * for the user (`Stale`'s "reloading" is what the web editor does with it) or for a log. A kind
 * not here says its own message: a missing page or component already says what there is instead.
 */
const FOR_AN_AGENT: Readonly<Record<string, string>> = {
  NotConfigured:
    "no project is open in the editor: ask the user to open this repository in it",
  Stale: `the page changed since you read it: ${TOOLS.read_page} again for its hash, and make your change to it as it is now`,
};

/**
 * Every failure reaches the agent as a sentence it can do something about: no project open, a
 * route that does not exist, a component that is not in the catalogue.
 */
export const reported = <
  A,
  E extends { readonly _tag?: string; readonly message: string },
  R,
>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.mapError(
    effect,
    (error) =>
      new ToolFailure({
        message:
          (error._tag === undefined ? undefined : FOR_AN_AGENT[error._tag]) ??
          error.message,
      })
  );

export const missing = (message: string) =>
  Effect.fail(new ToolFailure({ message }));

/** Documents and the design system are JSON through and through; their types only say more. */
export const asJson = (value: unknown) => value as JsonValue;

/**
 * A tool's input schema without what JSON Schema says anyway: `additionalProperties: true` is its
 * default, and the schema generator writes it on every object.
 */
export const leanSchema = <S>(schema: S): S => {
  if (Array.isArray(schema)) {
    return schema.map(leanSchema) as S;
  }
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) =>
      key === "additionalProperties" && value === true
        ? []
        : [[key, leanSchema(value)]]
    )
  ) as S;
};

/**
 * What a tool does to the project, as its definition tells a client, which may ask the user before
 * a tool that takes something away: a `read` changes nothing; an `edit` adds or changes in place,
 * one undo step; a `destructive` one takes away or writes over (a page deleted, pages moved out of
 * their canvas, the design system replaced, token values written over, the code rewritten).
 * `idempotent`: called again with the same, it changes nothing more, as a read never does. Every
 * tool says which, since a tool that says nothing is taken for a destructive one, and none reaches
 * beyond the project. `.annotateMerge(doing("read"))`.
 */
export const doing = (
  kind: "read" | "edit" | "destructive",
  options: { readonly idempotent?: boolean } = {}
) =>
  Context.make(Tool.Readonly, kind === "read").pipe(
    Context.add(Tool.Destructive, kind === "destructive"),
    Context.add(
      Tool.Idempotent,
      kind === "read" || options.idempotent === true
    ),
    Context.add(Tool.OpenWorld, false)
  );

/** A tool's hints, as an MCP client reads them from its definition. */
const hintsOf = (tool: Tool.Any) => ({
  destructiveHint: Context.get(tool.annotations, Tool.Destructive),
  idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
  openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
  readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
});

/** What a tool answers by hand: a picture, a sentence, or a form for the client to fill. */
type RawAnswer = McpSchema.CallToolResult | McpSchema.InputRequired;

/** A sentence as a tool's whole answer, or as its failure. */
export const said = (text: string, isError = false) =>
  new McpSchema.CallToolResult({ content: [{ text, type: "text" }], isError });

/** A tool registered by hand, as the MCP server takes it. */
type RawTool = Parameters<McpServer.McpServer["Service"]["addTool"]>[0];

/**
 * A tool whose answer a toolkit cannot give, registered by hand: a picture (`get_screenshot`), or
 * a form the client asks the user (`ask_user`). It is answered as the toolkits' tools are: the
 * parameters decoded (a mistake in them is the agent's, "invalid params"), a `ToolFailure` told as
 * an error result in its own words, the definition read from the tool's.
 */
export const rawTool = <T extends Tool.Any>(
  tool: T,
  handle: (
    parameters: Tool.Parameters<T>
  ) => Effect.Effect<RawAnswer, ToolFailure, McpSchema.McpRequestContext>
): RawTool => {
  const decode = Schema.decodeUnknownEffect(
    tool.parametersSchema as Schema.Codec<Tool.Parameters<T>, unknown>
  );
  return {
    annotations: tool.annotations,
    handle: (payload: unknown) =>
      decode(payload ?? {}).pipe(
        Effect.mapError(
          (error) => new McpSchema.InvalidParams({ message: error.message })
        ),
        Effect.flatMap((parameters) =>
          handle(parameters).pipe(
            Effect.catchTag("ToolFailure", (failure) =>
              Effect.succeed(said(failure.message, true))
            )
          )
        )
      ),
    tool: new McpSchema.Tool({
      annotations: hintsOf(tool),
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool) as McpSchema.ToolJson,
      name: tool.name,
    }),
  };
};
