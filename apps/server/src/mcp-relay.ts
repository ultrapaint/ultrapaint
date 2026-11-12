/**
 * The relay behind `ultrapaint mcp` (ADR 0083): an agent outside the editor speaks MCP over stdio
 * to it, and it passes each message to the `/mcp` of the project's server, and the answers back.
 * It holds no tools of its own. Where the server is, it asks `locate` again whenever a call cannot
 * connect, which reads the run file anew or starts a server.
 *
 * Over HTTP a message carries what stdio does not: the project's token, the protocol version a
 * stateless request names in its `_meta` (or the one `initialize` agreed), and the session the
 * server gave an older revision's `initialize`. A server that restarted has forgotten that
 * session: the relay says `initialize` to it again, as the agent first did, and sends the call.
 */
import { Effect, Option, Predicate, Ref, Schema, Stream } from "effect";

/** Where the project's server answers MCP, and the token it asks for. */
export interface McpTarget {
  readonly token: string;
  /** The server's `/mcp`. */
  readonly url: string;
}

export class RelayUnreachable extends Schema.TaggedError<RelayUnreachable>()(
  "RelayUnreachable",
  { message: Schema.String }
) {}

const PROTOCOL_META = "io.modelcontextprotocol/protocolVersion";
const SESSION_HEADER = "mcp-session-id";
const PROTOCOL_HEADER = "mcp-protocol-version";
const TOKEN_HEADER = "x-ultrapaint-token";
const METHOD_HEADER = "mcp-method";
const NAME_HEADER = "mcp-name";
const PRINTABLE_RE = /^[\t\x20-\x7e]*$/;

/** The parameter a stateless request is routed by, which `Mcp-Name` repeats. */
const ROUTED_BY: Record<string, "name" | "uri"> = {
  "prompts/get": "name",
  "resources/read": "uri",
  "tools/call": "name",
};

/** A header's value as the stateless revision writes it: as it is, or base64 between sentinels. */
const routingHeader = (value: string) =>
  PRINTABLE_RE.test(value)
    ? value
    : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;

/**
 * The headers a stateless request repeats from its body: its method, and the name or URI it is
 * routed by.
 */
const routedHeaders = (message: Message): Record<string, string> => {
  if (!message.method) {
    return {};
  }
  const key = ROUTED_BY[message.method];
  const { params } = message;
  const name =
    key && Predicate.isObject(params) && key in params
      ? params[key]
      : undefined;
  return {
    [METHOD_HEADER]: message.method,
    ...(Predicate.isString(name) && { [NAME_HEADER]: routingHeader(name) }),
  };
};

/** What the relay reads of a message: whether it is a request, and the version it names. */
const Message = Schema.Struct({
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Finite, Schema.Null])
  ),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
});
type Message = typeof Message.Type;
const decodeMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Message)
);
const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown)
);

const Versioned = Schema.Struct({ protocolVersion: Schema.String });
const decodeVersioned = Schema.decodeUnknownOption(Versioned);

/** The protocol version a stateless request names in its `_meta`. */
const namedVersion = (message: Message): string | undefined => {
  const { params } = message;
  if (!(Predicate.isObject(params) && "_meta" in params)) {
    return;
  }
  const meta = params._meta;
  if (Predicate.isObject(meta) && PROTOCOL_META in meta) {
    const version = meta[PROTOCOL_META];
    return Predicate.isString(version) ? version : undefined;
  }
};

/** The messages an event stream carries: each event's `data` lines, joined. */
export const eventMessages = (
  text: Stream.Stream<string, RelayUnreachable>
): Stream.Stream<string, RelayUnreachable> =>
  text.pipe(
    Stream.splitLines,
    Stream.mapAccum(
      (): readonly string[] => [],
      (data, line): readonly [readonly string[], readonly string[]] => {
        if (line === "") {
          return [[], data.length > 0 ? [data.join("\n")] : []];
        }
        if (line.startsWith("data:")) {
          return [[...data, line.slice(5).trimStart()], []];
        }
        return [data, []];
      },
      {
        onHalt: (data) => (data.length > 0 ? [data.join("\n")] : []),
      }
    )
  );

/** An error answer to a request, in JSON-RPC's words. */
export const errorAnswer = (
  id: Message["id"],
  message: string,
  code = -32_603
) =>
  JSON.stringify({ error: { code, message }, id: id ?? null, jsonrpc: "2.0" });

interface Session {
  /** What `initialize` asked, to say it again to a server that forgot the session. */
  readonly initialize: string | undefined;
  /** The version `initialize` agreed, for the calls after it. */
  readonly protocolVersion: string | undefined;
  readonly sessionId: string | undefined;
}

export const makeRelay = Effect.fnUntraced(function* (options: {
  /** Where the server is; asked again with `again` when the last answer did not connect. */
  readonly locate: (
    again: boolean
  ) => Effect.Effect<McpTarget, RelayUnreachable>;
  /** One message for the agent, a line of JSON. */
  readonly say: (line: string) => Effect.Effect<void>;
}) {
  const session = yield* Ref.make<Session>({
    initialize: undefined,
    protocolVersion: undefined,
    sessionId: undefined,
  });

  /** One POST of a message; its answers said as they come. */
  const post = Effect.fnUntraced(function* (
    target: McpTarget,
    text: string,
    message: Message
  ) {
    const known = yield* Ref.get(session);
    const named = namedVersion(message);
    const version = named ?? known.protocolVersion;
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      [TOKEN_HEADER]: target.token,
      ...(version && { [PROTOCOL_HEADER]: version }),
      ...(known.sessionId && { [SESSION_HEADER]: known.sessionId }),
      // A stateless request says in its headers what its body says.
      ...(named && routedHeaders(message)),
    };
    const response = yield* Effect.tryPromise({
      catch: () =>
        new RelayUnreachable({ message: `Nothing answers at ${target.url}` }),
      try: (signal) =>
        fetch(target.url, { body: text, headers, method: "POST", signal }),
    });
    const given = response.headers.get(SESSION_HEADER);
    if (given) {
      yield* Ref.update(session, (s) => ({ ...s, sessionId: given }));
    }
    return response;
  });

  /** The answers in a response, each said as one line. */
  const answer = Effect.fnUntraced(function* (
    response: Response,
    message: Message
  ) {
    const type = response.headers.get("content-type") ?? "";
    const remember = (line: string) =>
      Effect.gen(function* () {
        // The version `initialize` agreed goes on every call after it.
        if (message.method === "initialize") {
          const answered = Option.flatMap(decodeMessage(line), (m) =>
            decodeVersioned(m.result)
          );
          if (Option.isSome(answered)) {
            yield* Ref.update(session, (s) => ({
              ...s,
              protocolVersion: answered.value.protocolVersion,
            }));
          }
        }
        yield* options.say(line);
      });
    const { body: events } = response;
    if (type.includes("text/event-stream") && events) {
      yield* Stream.fromReadableStream({
        evaluate: () => events,
        onError: () =>
          new RelayUnreachable({ message: "The server's answer broke off" }),
      }).pipe(
        Stream.decodeText(),
        eventMessages,
        // One line each: an event's data may run over several.
        Stream.map((data) =>
          Option.match(decodeJson(data), {
            onNone: () => data,
            onSome: (value) => JSON.stringify(value),
          })
        ),
        Stream.runForEach(remember)
      );
      return;
    }
    const body = yield* Effect.promise(() => response.text());
    if (body.trim() === "") {
      if (!response.ok && message.id !== undefined) {
        yield* options.say(
          errorAnswer(message.id, `Ultrapaint answered ${response.status}`)
        );
      }
      return;
    }
    const parsed = decodeJson(body);
    if (Option.isNone(parsed)) {
      if (message.id !== undefined) {
        yield* options.say(
          errorAnswer(
            message.id,
            `Ultrapaint answered ${response.status}: ${body.slice(0, 200)}`
          )
        );
      }
      return;
    }
    const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    yield* Effect.forEach(values, (value) => remember(JSON.stringify(value)), {
      discard: true,
    });
  });

  /** Says `initialize` again to a server that forgot the session, as the agent first did. */
  const reinitialize = Effect.fnUntraced(function* (target: McpTarget) {
    const { initialize } = yield* Ref.get(session);
    if (!initialize) {
      return false;
    }
    yield* Ref.update(session, (s) => ({ ...s, sessionId: undefined }));
    const response = yield* post(
      target,
      initialize,
      Option.getOrElse(decodeMessage(initialize), () => ({}))
    );
    yield* Effect.promise(() => response.text());
    const initialized = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const sent = yield* post(target, initialized, {
      method: "notifications/initialized",
    });
    yield* Effect.promise(() => sent.text());
    return response.ok;
  });

  /** One message from the agent: passed on, its answers passed back, failures said as answers. */
  const handle = Effect.fnUntraced(function* (text: string) {
    if (text.trim() === "") {
      return;
    }
    const decoded = decodeMessage(text);
    if (Option.isNone(decoded)) {
      yield* options.say(errorAnswer(null, "Not a JSON-RPC message", -32_700));
      return;
    }
    const message = decoded.value;
    if (message.method === "initialize") {
      yield* Ref.update(session, (s) => ({ ...s, initialize: text }));
    }
    const sent = Effect.gen(function* () {
      const target = yield* options.locate(false);
      const response = yield* post(target, text, message).pipe(
        // The port moved, or the server went: where it is now, and once more.
        Effect.catchTag("RelayUnreachable", () =>
          Effect.flatMap(options.locate(true), (again) =>
            post(again, text, message)
          )
        )
      );
      const known = yield* Ref.get(session);
      if (
        response.status === 404 &&
        known.sessionId &&
        message.method !== "initialize" &&
        (yield* reinitialize(target))
      ) {
        yield* answer(yield* post(target, text, message), message);
        return;
      }
      yield* answer(response, message);
    });
    yield* sent.pipe(
      Effect.catchTag("RelayUnreachable", (error) =>
        // A notification has no answer to carry the failure.
        message.id === undefined
          ? Effect.logWarning(error.message)
          : options.say(errorAnswer(message.id, error.message))
      )
    );
  });

  return { handle };
});
