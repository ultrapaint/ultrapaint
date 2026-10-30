/**
 * Pictures of nodes, for agents that want to see what they made.
 *
 * The server has no browser to draw with; the editor has one, and a preview in it that draws with
 * the design's look, its components and design system. So a picture is asked of every editor that is
 * open, and the first to draw it answers. An editor that cannot (its preview is not running)
 * says why, and the request fails only once every editor asked has said so.
 */
import type {
  ScreenshotRequest,
  ScreenshotResult,
} from "@ultrapaint/contracts/screenshots";
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { EventBus } from "../events.ts";
import { makeId } from "../ids.ts";
import { PNG_DATA_URL } from "../png-text.ts";

export class ScreenshotFailure extends Schema.TaggedError<ScreenshotFailure>()(
  "ScreenshotFailure",
  { message: Schema.String }
) {}

interface Pending {
  readonly deferred: Deferred.Deferred<Uint8Array, ScreenshotFailure>;
  readonly problems: string[];
  /** Editors asked that have not answered yet. */
  waiting: number;
}

export class Screenshots extends Context.Service<
  Screenshots,
  {
    /** A PNG of the node, drawn by one of the open editors. */
    readonly capture: (
      request: Omit<ScreenshotRequest, "requestId">
    ) => Effect.Effect<Uint8Array, ScreenshotFailure>;
    /** An editor's answer to a request. One that nobody waits for any more is dropped. */
    readonly deliver: (result: ScreenshotResult) => Effect.Effect<void>;
    /** How many editors can draw, now and whenever that changes. */
    readonly editors: Stream.Stream<number>;
    /** The requests, for one editor: while it listens, it counts as able to answer. */
    readonly requests: Stream.Stream<ScreenshotRequest>;
  }
>()("ultrapaint/server/Screenshots") {
  static readonly layer = Layer.effect(
    Screenshots,
    Effect.gen(function* () {
      const events = yield* EventBus;
      const pending = new Map<string, Pending>();
      const editors = yield* SubscriptionRef.make(0);

      const requests = Stream.unwrap(
        Effect.as(
          Effect.acquireRelease(
            SubscriptionRef.update(editors, (n) => n + 1),
            () => SubscriptionRef.update(editors, (n) => n - 1)
          ),
          events.follow("screenshot")
        )
      );

      const capture = Effect.fn("Screenshots.capture")(function* (
        request: Omit<ScreenshotRequest, "requestId">
      ) {
        const listening = yield* SubscriptionRef.get(editors);
        if (listening === 0) {
          return yield* new ScreenshotFailure({
            message:
              "no editor is open to draw it: pictures are drawn by the editor's preview in the browser, so open the editor and ask again",
          });
        }
        const requestId = yield* makeId("shot");
        const deferred = yield* Deferred.make<Uint8Array, ScreenshotFailure>();
        pending.set(requestId, { deferred, problems: [], waiting: listening });
        yield* events.publish("screenshot", { ...request, requestId });
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () =>
              Effect.fail(
                new ScreenshotFailure({
                  message:
                    "the editor did not draw it in 30 seconds; its preview may still be starting",
                })
              ),
          }),
          Effect.ensuring(Effect.sync(() => pending.delete(requestId)))
        );
      });

      const deliver = Effect.fn("Screenshots.deliver")(function* ({
        dataUrl,
        problem,
        requestId,
      }: ScreenshotResult) {
        const entry = pending.get(requestId);
        if (!entry) {
          return;
        }
        if (dataUrl?.startsWith(PNG_DATA_URL)) {
          const bytes = Buffer.from(
            dataUrl.slice(PNG_DATA_URL.length),
            "base64"
          );
          yield* Deferred.succeed(entry.deferred, new Uint8Array(bytes));
          return;
        }
        entry.problems.push(problem ?? "the editor answered without a picture");
        entry.waiting -= 1;
        if (entry.waiting <= 0) {
          yield* Deferred.fail(
            entry.deferred,
            new ScreenshotFailure({
              message: [...new Set(entry.problems)].join("; "),
            })
          );
        }
      });

      return Screenshots.of({
        capture,
        deliver,
        editors: SubscriptionRef.changes(editors),
        requests,
      });
    })
  );
}
