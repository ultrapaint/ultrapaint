/**
 * The relay behind `ultrapaint mcp` (ADR 0083): an agent outside the editor speaks MCP over stdio
 * to it, and it passes each message to the `/mcp` of the project's server, and the answers back.
 * It holds no tools of its own. Which project a message is for, it asks `locate` for each message
 * (a link among a call's arguments may name another project); where that project's server is, it
 * asks the way `locate` gives, and again whenever a call cannot connect, which reads the run file
 * anew or starts a server.
 *
 * `initialize` goes to the project's server when one runs. When none does, the relay answers it
 * itself, as that server would, and starts the server meanwhile (ADR 0164): an agent's client
 * gives a server seconds to answer it, and a server takes longer to start. Until the server
 * answers, `tools/list` gives the tools a server listed last, and the agent is told when the
 * server's own differ.
 *
 * Over HTTP a message carries what stdio does not: the project's token, the protocol version a
 * stateless request names in its `_meta` (or the one `initialize` agreed), and the session the
 * server gave an older revision's `initialize`. A server is told `initialize` before the first call
 * that needs a session, as the agent first said it, and again when it restarted and forgot it.
 */
import { projectOfLink } from "@ultrapaint/shared/node-ref";
import {
  Deferred,
  Effect,
  Option,
  Predicate,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";

/** Where the project's server answers MCP, and the token it asks for. */
export interface McpTarget {
  readonly token: string;
  /** The server's `/mcp`. */
  readonly url: string;
}

/** The way to a project's server, which `locate` gives for a message, one for each project. */
export interface Way {
  /**
   * Where the server is, one started when none runs; asked again with `again` when the last
   * answer did not connect.
   */
  readonly reach: (
    again: boolean
  ) => Effect.Effect<McpTarget, RelayUnreachable>;
  /** The server running for the project now, if one is: none is started for it. */
  readonly running: Effect.Effect<Option.Option<McpTarget>, RelayUnreachable>;
}

/** The tools a server listed last, kept in the person's folder, and what it said at `initialize`. */
export const KeptTools = Schema.Struct({
  instructions: Schema.optional(Schema.String),
  tools: Schema.Array(Schema.Unknown),
});
export type KeptTools = typeof KeptTools.Type;

export class RelayUnreachable extends Schema.TaggedError<RelayUnreachable>()(
  "RelayUnreachable",
  { message: Schema.String }
) {}

/** No project to send a message to: the folder has none, and no link has named one. */
export class RelayNoProject extends Schema.TaggedError<RelayNoProject>()(
  "RelayNoProject",
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

/** What a server's answer to `initialize` says: the version it agreed, and its instructions. */
const InitializeResult = Schema.Struct({
  instructions: Schema.optional(Schema.String),
  protocolVersion: Schema.String,
});
const decodeInitializeResult = Schema.decodeUnknownOption(InitializeResult);

/** The id of the relay's own `tools/list`, which it asks the server it started. */
const RELAY_LIST_ID = "ultrapaint-relay";

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
  /** What `initialize` asked, to say it again to a server that has not heard it. */
  readonly initialize: string | undefined;
  /** The server `initialize` was last said to, whose session the calls carry. */
  readonly initializedAt: string | undefined;
  /** What the server `initialize` was last said to answered it with, kept beside its tools. */
  readonly instructions: string | undefined;
  /** The version `initialize` agreed, for the calls after it. */
  readonly protocolVersion: string | undefined;
  readonly sessionId: string | undefined;
}

/** The strings in a value, however deep: a tool's arguments, where a link may be. */
const stringsIn = (value: unknown): readonly string[] => {
  if (Predicate.isString(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  return Predicate.isObject(value)
    ? Object.values(value).flatMap(stringsIn)
    : [];
};

/**
 * The project a call names by an editor link among its arguments (ADR 0083): the link's folder,
 * which the relay reaches that project's server by.
 */
export const linkedProject = (message: Message): string | undefined => {
  const { params } = message;
  if (!(Predicate.isObject(params) && "arguments" in params)) {
    return;
  }
  for (const text of stringsIn(params.arguments)) {
    const project = projectOfLink(text);
    if (project) {
      return project;
    }
  }
};

/**
 * The argument every tool takes through the relay: the folder the agent works in, which says
 * which project the call is for (ADR 0083). MCP has no other way for a server to learn it once
 * roots are gone, and a server shared by several agents (a hub) is started in one folder for all
 * of them. The relay adds it to each tool it lists and takes it off each call it passes on: the
 * server's tools never see it, nor do the editor's own agents, which reach the server directly.
 */
export const FOLDER_ARG = "cwd";
/**
 * Without a description: every agent reads it on every tool, and the name says it. One that gives
 * a relative path is told to give it whole.
 */
const FOLDER_SCHEMA = { type: "string" };

/** A server's list of tools, each one taking the folder too, as the agent is given it. */
export const withFolder = (listed: unknown): unknown => {
  if (!(Predicate.isObject(listed) && Array.isArray(listed.tools))) {
    return listed;
  }
  const tools = listed.tools.map((tool: unknown) => {
    if (!(Predicate.isObject(tool) && Predicate.isObject(tool.inputSchema))) {
      return tool;
    }
    const schema = tool.inputSchema;
    const required = Array.isArray(schema.required) ? schema.required : [];
    return {
      ...tool,
      inputSchema: {
        ...schema,
        properties: {
          ...(Predicate.isObject(schema.properties) && schema.properties),
          [FOLDER_ARG]: FOLDER_SCHEMA,
        },
        required: required.includes(FOLDER_ARG)
          ? required
          : [...required, FOLDER_ARG],
      },
    };
  });
  return { ...listed, tools };
};

/** A server's answer to `tools/list`: its tools. */
const decodeToolList = Schema.decodeUnknownOption(
  Schema.Struct({ tools: KeptTools.fields.tools })
);

/** Whether two lists offer the same tools: every revision lists a tool the same way. */
const sameTools = (a: readonly unknown[], b: readonly unknown[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** An answer to `tools/list`, each tool taking the folder too. */
const listedWithFolder = (line: string) => {
  const listed = Option.filter(decodeJson(line), Predicate.isObject);
  return Option.isSome(listed) && "result" in listed.value
    ? JSON.stringify({
        ...listed.value,
        result: withFolder(listed.value.result),
      })
    : line;
};

/** The arguments of a call, when it has any. */
const argumentsOf = (message: Message) => {
  const { params } = message;
  return Predicate.isObject(params) && Predicate.isObject(params.arguments)
    ? params.arguments
    : undefined;
};

/** The folder a call says its agent works in, if it says one. */
export const folderOf = (message: Message): string | undefined => {
  const folder = argumentsOf(message)?.[FOLDER_ARG];
  return Predicate.isString(folder) && folder !== "" ? folder : undefined;
};

/** A call as the server takes it: without the folder, which was the relay's to read. */
const withoutFolder = (text: string, message: Message) => {
  const args = argumentsOf(message);
  if (!(args && FOLDER_ARG in args)) {
    return text;
  }
  const { [FOLDER_ARG]: _folder, ...rest } = args;
  return JSON.stringify({
    ...Option.getOrElse(
      Option.filter(decodeJson(text), Predicate.isObject),
      () => ({})
    ),
    params: { ...(message.params as object), arguments: rest },
  });
};

export type { Message as RelayMessage };

export const makeRelay = Effect.fnUntraced(function* (options: {
  /**
   * Which project a message is for, at once: the way to its server. No project to send it to
   * fails with `RelayNoProject`.
   */
  readonly locate: (message: Message) => Effect.Effect<Way, RelayNoProject>;
  /** One message for the agent, a line of JSON. */
  readonly say: (line: string) => Effect.Effect<void>;
  /** The relay's own answer to `initialize`, as a server of its build gives it. */
  readonly answerInitialize: (text: string) => Effect.Effect<string>;
  /** The tools a server listed last, if any did: what `tools/list` gives before the server answers. */
  readonly keptTools: Effect.Effect<KeptTools | undefined>;
  /** The answer to a message there is no project for, if it has one: why, and what to do. */
  readonly withoutProject: (
    text: string,
    why: string
  ) => Effect.Effect<string | undefined>;
  /**
   * A server's list of tools, as it answered, with the instructions it gave the relay at
   * `initialize` when it did: kept for when there is no project to ask, or no server yet.
   */
  readonly toolsListed?: (kept: KeptTools) => Effect.Effect<void>;
}) {
  // What the relay does in the background (a server started, a list compared) ends with it.
  const scope = yield* Effect.scope;
  /**
   * The start the relay began on `initialize`, by the way to that project's server: the server
   * once it answers, or why it did not, which the first call to that project waits for.
   */
  const starting = yield* Ref.make(
    Option.none<{
      readonly way: Way;
      readonly started: Deferred.Deferred<McpTarget, RelayUnreachable>;
    }>()
  );

  /** A server's list as the relay keeps it: with what that server said at `initialize`. */
  const keep = Effect.fnUntraced(function* (result: unknown) {
    const listed = decodeToolList(result);
    if (options.toolsListed && Option.isSome(listed)) {
      const { instructions } = yield* Ref.get(session);
      yield* options.toolsListed({ instructions, tools: listed.value.tools });
    }
    return listed;
  });

  /** A server's answer to `initialize`: the version the calls after it name, and its words. */
  const agree = Effect.fnUntraced(function* (text: string) {
    const agreed = Option.flatMap(decodeMessage(text), (m) =>
      decodeInitializeResult(m.result)
    );
    if (Option.isSome(agreed)) {
      yield* Ref.update(session, (s) => ({
        ...s,
        instructions: agreed.value.instructions,
        protocolVersion: agreed.value.protocolVersion,
      }));
    }
  });
  /** One `initialize` said to a server at a time: two calls at once would make two sessions. */
  const initializing = yield* Semaphore.make(1);
  const session = yield* Ref.make<Session>({
    initialize: undefined,
    initializedAt: undefined,
    instructions: undefined,
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
      ...(!named && known.sessionId && { [SESSION_HEADER]: known.sessionId }),
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
        const answered = decodeMessage(line);
        // The version `initialize` agreed goes on every call after it.
        if (message.method === "initialize") {
          yield* agree(line);
        }
        if (message.method === "tools/list" && Option.isSome(answered)) {
          yield* keep(answered.value.result);
        }
        // The agent is given each tool with the folder it works in among its arguments.
        yield* options.say(
          message.method === "tools/list" ? listedWithFolder(line) : line
        );
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

  /** The messages in a response read whole: a JSON answer, or each event's. */
  const answersIn = Effect.fnUntraced(function* (response: Response) {
    const body = yield* Effect.tryPromise({
      catch: () =>
        new RelayUnreachable({ message: "The server's answer broke off" }),
      try: () => response.text(),
    });
    return (response.headers.get("content-type") ?? "").includes(
      "text/event-stream"
    )
      ? yield* eventMessages(Stream.make(body)).pipe(Stream.runCollect)
      : [body];
  });

  /** Tells a server its `initialize` was answered, as the agent told the relay. */
  const initialized = Effect.fnUntraced(function* (target: McpTarget) {
    const sent = yield* post(
      target,
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      { method: "notifications/initialized" }
    );
    yield* answersIn(sent);
  });

  /**
   * Says `initialize` to a server, as the agent first did: one that forgot the session, or one
   * the relay has not said it to, the relay having answered the agent itself or a call naming
   * another project having turned it there.
   */
  const initializeAt = Effect.fnUntraced(function* (target: McpTarget) {
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
    // The version this server agreed, which the calls after it name, and its instructions.
    yield* Effect.forEach(yield* answersIn(response), agree, { discard: true });
    yield* initialized(target);
    if (response.ok) {
      yield* Ref.update(session, (s) => ({ ...s, initializedAt: target.url }));
    }
    return response.ok;
  });

  /**
   * An older revision's calls go in a session, which is the server's: a server the relay has
   * not said `initialize` to is told it first. A stateless call needs none.
   */
  const ready = Effect.fnUntraced(function* (
    target: McpTarget,
    message: Message
  ) {
    if (message.method === "initialize" || namedVersion(message)) {
      return;
    }
    yield* initializing.withPermits(1)(
      Effect.gen(function* () {
        const known = yield* Ref.get(session);
        if (known.initialize && known.initializedAt !== target.url) {
          yield* initializeAt(target);
        }
      })
    );
  });

  /**
   * Once the server the relay started answers: its own list of tools, kept, and the agent told
   * when it differs from the one it was given before.
   */
  const compareTools = Effect.fnUntraced(function* (
    started: Deferred.Deferred<McpTarget, RelayUnreachable>,
    given: readonly unknown[]
  ) {
    const target = yield* Deferred.await(started);
    const asked: Message = { id: RELAY_LIST_ID, method: "tools/list" };
    yield* ready(target, asked);
    const response = yield* post(
      target,
      JSON.stringify({ ...asked, jsonrpc: "2.0" }),
      asked
    );
    for (const text of yield* answersIn(response)) {
      const answered = decodeMessage(text);
      if (Option.isNone(answered)) {
        continue;
      }
      const listed = yield* keep(answered.value.result);
      if (Option.isSome(listed) && !sameTools(listed.value.tools, given)) {
        yield* options.say(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/tools/list_changed",
          })
        );
      }
    }
  });

  /**
   * `initialize`, answered here when no server runs for the project (ADR 0164): the server is
   * started meanwhile, and told it before the first call that needs a session, which says the
   * version that server agrees.
   */
  const answerAndStart = Effect.fnUntraced(function* (way: Way, text: string) {
    const started = yield* Deferred.make<McpTarget, RelayUnreachable>();
    yield* Effect.forkIn(Deferred.into(way.reach(false), started), scope);
    // Set before the answer is said: the agent's next message comes after it.
    yield* Ref.set(starting, Option.some({ started, way }));
    yield* options.say(yield* options.answerInitialize(text));
  });

  /**
   * `initialize`, passed to the server running for the project, which answers it as it would the
   * agent directly; one that answers no more is started, as when none ran.
   */
  const initializeRunning = Effect.fnUntraced(function* (
    way: Way,
    text: string,
    message: Message
  ) {
    const running = yield* way.running;
    if (Option.isNone(running)) {
      return yield* answerAndStart(way, text);
    }
    const target = running.value;
    const passed = yield* Effect.option(post(target, text, message));
    if (Option.isNone(passed)) {
      return yield* answerAndStart(way, text);
    }
    const response = passed.value;
    yield* answer(response, message);
    // A server gone before it heard this is told `initialize` again by the next call.
    if (response.ok && (yield* Effect.isSuccess(initialized(target)))) {
      yield* Ref.update(session, (s) => ({ ...s, initializedAt: target.url }));
    }
  });

  /**
   * `tools/list` while the server the relay started has not answered yet: the tools a server
   * listed last, and later the agent told if the server's own differ. Nothing kept: the server
   * is waited for, since an empty list would read as Ultrapaint having no tools.
   */
  const listKept = Effect.fnUntraced(function* (message: Message) {
    const start = yield* Ref.get(starting);
    if (Option.isNone(start) || (yield* Deferred.isDone(start.value.started))) {
      return false;
    }
    const kept = yield* options.keptTools;
    if (kept === undefined) {
      return false;
    }
    yield* options.say(
      JSON.stringify({
        id: message.id ?? null,
        jsonrpc: "2.0",
        result: withFolder({ tools: kept.tools }),
      })
    );
    yield* Effect.forkIn(
      // A list not compared is only a notification not sent: the agent's next `tools/list`
      // reaches the server, and a failed start is said on the first call.
      Effect.ignore(compareTools(start.value.started, kept.tools)),
      scope
    );
    return true;
  });

  /**
   * Where a message's server is: for the project the relay began starting on `initialize`, that
   * start's server, waited for, or why it did not start, said once (a call after it starts it
   * anew); else the way's own answer.
   */
  const firstTarget = Effect.fnUntraced(function* (way: Way) {
    const start = yield* Ref.get(starting);
    // `locate` gives one way for each project: the same way is the same project.
    if (Option.isNone(start) || start.value.way !== way) {
      return yield* way.reach(false);
    }
    const { started } = start.value;
    return yield* Deferred.await(started).pipe(
      Effect.ensuring(
        Ref.update(starting, (now) =>
          Option.isSome(now) && now.value.started === started
            ? Option.none()
            : now
        )
      )
    );
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
    // The relay says it to each server after `initialize` (`initializeAt`).
    if (message.method === "notifications/initialized") {
      return;
    }
    // The relay is the server the agent speaks to: it answers that it is there.
    if (message.method === "ping" && message.id !== undefined) {
      yield* options.say(
        JSON.stringify({ id: message.id, jsonrpc: "2.0", result: {} })
      );
      return;
    }
    if (message.method === "initialize") {
      yield* Ref.update(session, (s) => ({
        ...s,
        initialize: text,
        initializedAt: undefined,
      }));
    }
    const forwarded = withoutFolder(text, message);
    const sent = Effect.gen(function* () {
      const way = yield* options.locate(message);
      if (message.method === "initialize") {
        return yield* initializeRunning(way, text, message);
      }
      if (message.method === "tools/list" && (yield* listKept(message))) {
        return;
      }
      let target = yield* firstTarget(way);
      yield* ready(target, message);
      const response = yield* post(target, forwarded, message).pipe(
        // The port moved, or the server went: where it is now, and once more.
        Effect.catchTag("RelayUnreachable", () =>
          Effect.gen(function* () {
            target = yield* way.reach(true);
            yield* ready(target, message);
            return yield* post(target, forwarded, message);
          })
        )
      );
      const known = yield* Ref.get(session);
      if (
        response.status === 404 &&
        known.sessionId &&
        (yield* initializing.withPermits(1)(initializeAt(target)))
      ) {
        yield* answer(yield* post(target, forwarded, message), message);
        return;
      }
      yield* answer(response, message);
    });
    yield* sent.pipe(
      Effect.catchTags({
        RelayNoProject: (error) =>
          Effect.flatMap(options.withoutProject(text, error.message), (line) =>
            line === undefined ? Effect.void : options.say(line)
          ),
        RelayUnreachable: (error) =>
          // A notification has no answer to carry the failure.
          message.id === undefined
            ? Effect.logWarning(error.message)
            : options.say(errorAnswer(message.id, error.message)),
      })
    );
  });

  return { handle };
});
