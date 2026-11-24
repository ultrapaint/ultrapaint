/**
 * An ACP agent that replays a transcript, for tests: the messages a real agent and the editor
 * exchanged, one JSON line each, played back against the editor's own side of the protocol
 * (`connectAcpAgent`, the SDK included) over a stream in memory. Where the scripted agent plays
 * what a test says, this one plays what a real agent did: the editor must send what the
 * transcript says it sent, and is answered with what the agent answered.
 *
 * A transcript's lines, in order:
 *
 *   {"type":"start", ...}                         who recorded it, and how; nothing is played
 *   {"type":"expect","label":…,"frame":FRAME}     the editor sends this next
 *   {"type":"emit","label":…,"frame":FRAME}       the agent sends this
 *   {"type":"end"}                                the agent has nothing more to say
 *
 * A FRAME is `{"kind":"request"|"notification","method":…,"params":…}` or
 * `{"kind":"response","method":…,"result":…}`: a response names the method of the request it
 * answers, and its id is that request's. Two requests of one method open at once each take a
 * `ref` of the transcript's own, which their responses name too. In an expected frame, `"<any>"`
 * matches any value, and a string with `<any>` in it matches any text in its place.
 *
 * Its scope closing stops it, as a process is stopped. It never exits on its own.
 */
import { Deferred, Effect, Predicate, Schema, type Scope } from "effect";
import {
  type AcpAgent,
  type AcpExit,
  type AcpHandlers,
  type AnyMessage,
  connectAcpAgent,
} from "./acp-agent.ts";

const Frame = Schema.Struct({
  kind: Schema.Literals(["request", "notification", "response"]),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
  /** Which of several requests of one method open at once, for the transcript. */
  ref: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
});
type Frame = typeof Frame.Type;

/** How a request in flight is known: its `ref`, or its method when only one is open. */
const keyOf = (frame: Frame) => frame.ref ?? frame.method;

const Line = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({ type: Schema.Literal("end") }),
  Schema.Struct({
    frame: Frame,
    label: Schema.String,
    type: Schema.Literals(["expect", "emit"]),
  }),
]);
type Line = typeof Line.Type;

const decodeLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Line));

/** The editor did not send what the transcript says it sent. */
export class ReplayMismatch extends Schema.TaggedError<ReplayMismatch>()(
  "ReplayMismatch",
  { message: Schema.String }
) {}

/** The test's hold on the agent. */
export interface ReplayAgent {
  /** Completes once the whole transcript was played, or fails on the first frame that differs. */
  readonly done: Effect.Effect<void, ReplayMismatch>;
}

const ANY = "<any>";

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `actual` is what `expected` says, `<any>` standing for anything. */
export const matches = (expected: unknown, actual: unknown): boolean => {
  if (expected === ANY) {
    return true;
  }
  if (typeof expected === "string" && expected.includes(ANY)) {
    return (
      typeof actual === "string" &&
      new RegExp(
        `^${expected.split(ANY).map(escapeRegExp).join("[\\s\\S]*")}$`
      ).test(actual)
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, i) => matches(e, actual[i]))
    );
  }
  if (Predicate.isObject(expected)) {
    if (!Predicate.isObject(actual) || Array.isArray(actual)) {
      return false;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].every((key) =>
      matches(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key]
      )
    );
  }
  return expected === actual;
};

/** The transcript's lines, read. */
const linesOf = (transcript: string) =>
  Effect.forEach(
    transcript.split("\n").filter((l) => l.trim().length > 0),
    (line) =>
      Effect.mapError(
        decodeLine(line),
        (error) =>
          new ReplayMismatch({
            message: `a transcript line does not read: ${error.message}`,
          })
      )
  );

/**
 * An agent replaying `transcript` against `handlers`, until the scope closes: the editor's side
 * as the live agent has it, and the test's hold on the replay.
 */
export const makeReplayAgent = Effect.fnUntraced(function* (options: {
  readonly clientVersion: string;
  readonly handlers: AcpHandlers;
  readonly transcript: string;
}): Effect.fn.Return<
  { readonly agent: AcpAgent; readonly control: ReplayAgent },
  never,
  Scope.Scope
> {
  const exited = yield* Deferred.make<AcpExit>();
  const done = yield* Deferred.make<void, ReplayMismatch>();
  yield* Effect.addFinalizer(() =>
    Deferred.succeed(exited, { code: null, signal: "SIGTERM" })
  );
  const toAgent = new TransformStream<AnyMessage, AnyMessage>();
  const toEditor = new TransformStream<AnyMessage, AnyMessage>();
  const agent = yield* connectAcpAgent({
    clientVersion: options.clientVersion,
    exited,
    handlers: options.handlers,
    pid: undefined,
    stream: { readable: toEditor.readable, writable: toAgent.writable },
  });

  const reader = toAgent.readable.getReader();
  const writer = toEditor.writable.getWriter();
  const received = Effect.promise(() => reader.read());
  const send = (message: unknown) =>
    Effect.promise(() => writer.write(message as AnyMessage));
  // The ids of the requests in flight, by `keyOf`: the editor's, which the agent answers, and
  // the agent's, which the editor answers.
  const editorRequests = new Map<string, string | number>();
  const agentRequests = new Map<
    string,
    { readonly id: number; readonly method: string }
  >();
  let nextId = 0;

  const mismatch = (label: string, expected: Frame, actual: unknown) =>
    new ReplayMismatch({
      message: `${label}: expected ${JSON.stringify(expected)}, the editor sent ${JSON.stringify(actual)}`,
    });

  /**
   * The editor's next message, as the frame a transcript writes, and for a response the key of
   * the agent's request it answers.
   */
  const frameOf = (
    message: Record<string, unknown>
  ): { readonly frame: Frame; readonly key?: string } => {
    if (typeof message.method === "string") {
      return {
        frame: {
          kind: "id" in message ? "request" : "notification",
          method: message.method,
          params: message.params,
        },
      };
    }
    const answered = [...agentRequests].find(
      ([, request]) => request.id === message.id
    );
    return {
      frame: {
        kind: "response",
        method: answered?.[1].method ?? "?",
        result: "result" in message ? message.result : { error: message.error },
      },
      ...(answered ? { key: answered[0] } : {}),
    };
  };

  const expect = Effect.fnUntraced(function* (label: string, frame: Frame) {
    const next = yield* received;
    if (next.done) {
      return yield* new ReplayMismatch({
        message: `${label}: the editor closed the connection`,
      });
    }
    const message = next.value as unknown as Record<string, unknown>;
    const { frame: actual, key } = frameOf(message);
    const { kind, method, ref: _ref, ...rest } = frame;
    const { kind: actualKind, method: actualMethod, ...actualRest } = actual;
    if (
      kind !== actualKind ||
      method !== actualMethod ||
      (kind === "response" && key !== keyOf(frame)) ||
      !matches(rest, actualRest)
    ) {
      return yield* mismatch(label, frame, actual);
    }
    if (kind === "request") {
      editorRequests.set(keyOf(frame), message.id as string | number);
    }
    if (key !== undefined) {
      agentRequests.delete(key);
    }
  });

  const emit = Effect.fnUntraced(function* (label: string, frame: Frame) {
    switch (frame.kind) {
      case "request": {
        nextId += 1;
        agentRequests.set(keyOf(frame), { id: nextId, method: frame.method });
        return yield* send({
          id: nextId,
          jsonrpc: "2.0",
          method: frame.method,
          params: frame.params,
        });
      }
      case "notification":
        return yield* send({
          jsonrpc: "2.0",
          method: frame.method,
          params: frame.params,
        });
      default: {
        const id = editorRequests.get(keyOf(frame));
        if (id === undefined) {
          return yield* new ReplayMismatch({
            message: `${label}: the editor sent no ${keyOf(frame)} to answer`,
          });
        }
        editorRequests.delete(keyOf(frame));
        return yield* send({ id, jsonrpc: "2.0", result: frame.result });
      }
    }
  });

  const play = (line: Line) => {
    switch (line.type) {
      case "expect":
        return expect(line.label, line.frame);
      case "emit":
        return emit(line.label, line.frame);
      default:
        return Effect.void;
    }
  };

  yield* linesOf(options.transcript).pipe(
    Effect.flatMap((lines) => Effect.forEach(lines, play, { discard: true })),
    Effect.exit,
    Effect.flatMap((exit) => Deferred.done(done, exit)),
    Effect.forkScoped
  );
  // Whatever the editor sends past the transcript's end is read, and goes nowhere.
  const drain: Effect.Effect<void> = Effect.flatMap(received, (next) =>
    next.done ? Effect.void : drain
  );
  yield* Deferred.await(done).pipe(
    Effect.ignore,
    Effect.andThen(drain),
    Effect.forkScoped
  );

  return {
    agent,
    control: { done: Deferred.await(done).pipe(Effect.asVoid) },
  };
});
