/**
 * Pictures of nodes, for agents that want to see what they made.
 *
 * The server has no browser to draw with; the editor has one, and a preview in it that draws with
 * the design's look, its components and design system. So a picture is asked of every editor that is
 * open, and the first to draw it answers. An editor that cannot (its preview is not running)
 * says why, and the request fails only once every editor asked has said so.
 *
 * An editor that does not answer at all has a preview that is still starting, before any picture
 * was drawn, or one that stopped drawing, after one was. Stopped, it is still asked, so one that
 * recovered answers, but it is waited for only a few seconds until a picture is drawn again: a
 * review of many pages then loses seconds, not minutes, and the agent learns at once to ask the
 * person to reload the editor.
 */
import type {
  RenderedFinding,
  ScreenshotRequest,
  ScreenshotResult,
} from "@ultrapaint/contracts/screenshots";
import {
  Context,
  Deferred,
  Duration,
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

/** A picture, and what the checks measured on it when they were asked for (ADR 0081). */
export interface CheckedPicture {
  readonly findings: readonly RenderedFinding[];
  readonly png: Uint8Array;
}

/**
 * What the editors' preview is doing, as the answers show: starting, until it draws a picture;
 * drawing; or stalled, once a request went unanswered after it drew, until it draws again.
 */
type PreviewState = "starting" | "drawing" | "stalled";

/** How long a picture is waited for: from a preview that draws, or may still be starting. */
const WAIT_SECONDS = 30;
/** From a preview that stopped drawing, long enough for one that recovered to answer. */
const STALLED_WAIT_SECONDS = 5;

const STARTING = `the editor did not draw it in ${WAIT_SECONDS} seconds; its preview may still be starting`;
const STALLED =
  "the editor's preview has stopped drawing pictures; ask the person to reload the editor";

interface Pending {
  readonly deferred: Deferred.Deferred<CheckedPicture, ScreenshotFailure>;
  readonly problems: string[];
  /** Editors asked that have not answered yet. */
  waiting: number;
}

export class Screenshots extends Context.Service<
  Screenshots,
  {
    /** A PNG of the node, drawn by one of the open editors. */
    readonly capture: (
      request: Omit<ScreenshotRequest, "requestId" | "checks">
    ) => Effect.Effect<Uint8Array, ScreenshotFailure>;
    /**
     * A PNG of the page for the review, with what the editor's checks measured on the page it
     * drew (ADR 0081): none from an editor that does not measure, or whose measuring failed.
     */
    readonly captureChecked: (
      request: Omit<ScreenshotRequest, "requestId" | "checks">
    ) => Effect.Effect<CheckedPicture, ScreenshotFailure>;
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
      /** Since an editor last started listening: one reloaded may be starting again. */
      let preview: PreviewState = "starting";

      const requests = Stream.unwrap(
        Effect.as(
          Effect.acquireRelease(
            Effect.gen(function* () {
              preview = "starting";
              yield* SubscriptionRef.update(editors, (n) => n + 1);
            }),
            () => SubscriptionRef.update(editors, (n) => n - 1)
          ),
          events.follow("screenshot")
        )
      );

      const ask = Effect.fnUntraced(function* (
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
        const deferred = yield* Deferred.make<
          CheckedPicture,
          ScreenshotFailure
        >();
        pending.set(requestId, { deferred, problems: [], waiting: listening });
        yield* events.publish("screenshot", { ...request, requestId });
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: Duration.seconds(
              preview === "stalled" ? STALLED_WAIT_SECONDS : WAIT_SECONDS
            ),
            orElse: () =>
              Effect.gen(function* () {
                if (preview === "starting") {
                  return yield* new ScreenshotFailure({ message: STARTING });
                }
                preview = "stalled";
                return yield* new ScreenshotFailure({ message: STALLED });
              }),
          }),
          Effect.ensuring(Effect.sync(() => pending.delete(requestId)))
        );
      });

      const capture = Effect.fn("Screenshots.capture")(function* (
        request: Omit<ScreenshotRequest, "requestId" | "checks">
      ) {
        return (yield* ask(request)).png;
      });

      const captureChecked = Effect.fn("Screenshots.captureChecked")(function* (
        request: Omit<ScreenshotRequest, "requestId" | "checks">
      ) {
        return yield* ask({ ...request, checks: true });
      });

      const deliver = Effect.fn("Screenshots.deliver")(function* ({
        dataUrl,
        findings,
        problem,
        requestId,
      }: ScreenshotResult) {
        const png = dataUrl?.startsWith(PNG_DATA_URL) ? dataUrl : undefined;
        // Drawn, even too late for whoever asked: the preview draws again.
        if (png !== undefined) {
          preview = "drawing";
        }
        const entry = pending.get(requestId);
        if (!entry) {
          return;
        }
        if (png !== undefined) {
          const bytes = Buffer.from(png.slice(PNG_DATA_URL.length), "base64");
          yield* Deferred.succeed(entry.deferred, {
            findings: findings ?? [],
            png: new Uint8Array(bytes),
          });
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
        captureChecked,
        deliver,
        editors: SubscriptionRef.changes(editors),
        requests,
      });
    })
  );
}
