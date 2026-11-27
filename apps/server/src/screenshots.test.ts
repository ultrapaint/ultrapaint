import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { EventBus } from "./events.ts";
import { type ScreenshotFailure, Screenshots } from "./services/screenshots.ts";

/** A 1×1 PNG, as an editor would deliver it. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const world = Screenshots.layer.pipe(Layer.provideMerge(EventBus.layer));

const request = {
  canvas: "",
  height: 900,
  mode: "page",
  root: { children: [], id: "page", type: "page" },
  width: 1200,
} as const satisfies Parameters<Screenshots["Service"]["capture"]>[0];

/**
 * An editor open on the project, listening for requests: it draws each one while `draws` holds,
 * and leaves the rest unanswered, as an editor whose preview stopped drawing does. Answers once
 * it hears the requests.
 */
const anEditor = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  const events = yield* EventBus;
  const draws = yield* Ref.make(true);
  const following = yield* Effect.forkChild(
    Stream.runHead(Stream.filter(events.followed, (e) => e === "screenshot")),
    { startImmediately: true }
  );
  yield* screenshots.requests.pipe(
    Stream.runForEach((asked) =>
      Effect.flatMap(Ref.get(draws), (drawing) =>
        drawing
          ? screenshots.deliver({
              dataUrl: `data:image/png;base64,${PNG}`,
              requestId: asked.requestId,
            })
          : Effect.void
      )
    ),
    Effect.forkScoped
  );
  yield* Fiber.join(following);
  return draws;
});

/**
 * What a capture says once the clock has moved `seconds`, having said nothing a second before:
 * its failure, or `drawn`. The review's, measured, with `checked`.
 */
const saidAfter = (seconds: number, checked = false) =>
  Effect.gen(function* () {
    const screenshots = yield* Screenshots;
    const capture: Effect.Effect<unknown, ScreenshotFailure> = checked
      ? screenshots.captureChecked(request)
      : screenshots.capture(request);
    const asked = yield* Effect.forkChild(
      capture.pipe(
        Effect.match({
          onFailure: (failure) => failure.message,
          onSuccess: () => "drawn",
        })
      ),
      { startImmediately: true }
    );
    yield* TestClock.adjust(`${seconds - 1} seconds`);
    assert.isUndefined(asked.pollUnsafe(), `still waiting at ${seconds - 1} s`);
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(asked);
  });

/** An editor that drew a picture, and has stopped drawing since. */
const aStoppedEditor = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  const draws = yield* anEditor;
  yield* screenshots.capture(request);
  yield* Ref.set(draws, false);
  return draws;
});

describe("Screenshots", () => {
  it.effect(
    "says the preview may still be starting, after 30 seconds, of an editor that has drawn nothing yet",
    () =>
      Effect.gen(function* () {
        const draws = yield* anEditor;
        yield* Ref.set(draws, false);
        assert.include(yield* saidAfter(30), "may still be starting");
        // A second request before any picture still waits for a preview that may be starting.
        assert.include(yield* saidAfter(30), "may still be starting");
      }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect(
    "says the preview stopped drawing, and that the person can reload the editor, once it drew before",
    () =>
      Effect.gen(function* () {
        yield* aStoppedEditor;
        const said = yield* saidAfter(30);
        assert.include(said, "stopped drawing pictures");
        assert.include(said, "reload the editor");
        assert.notInclude(said, "may still be starting");
      }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect("gives up within 5 seconds on a preview that stopped drawing", () =>
    Effect.gen(function* () {
      yield* aStoppedEditor;
      yield* saidAfter(30);
      assert.include(yield* saidAfter(5), "stopped drawing pictures");
    }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect(
    "gives up on the review's pictures within 5 seconds too once the preview stopped",
    () =>
      Effect.gen(function* () {
        yield* aStoppedEditor;
        yield* saidAfter(30, true);
        assert.include(yield* saidAfter(5, true), "stopped drawing pictures");
      }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect(
    "waits as before once a picture is drawn again after the preview stopped",
    () =>
      Effect.gen(function* () {
        const screenshots = yield* Screenshots;
        const draws = yield* aStoppedEditor;
        yield* saidAfter(30);
        // A recovered editor is still asked while the server takes it as stopped.
        yield* Ref.set(draws, true);
        yield* screenshots.capture(request);
        yield* Ref.set(draws, false);
        assert.include(yield* saidAfter(30), "stopped drawing pictures");
      }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect(
    "waits as before once a picture arrives too late for the request that asked for it",
    () =>
      Effect.gen(function* () {
        const screenshots = yield* Screenshots;
        const events = yield* EventBus;
        yield* aStoppedEditor;
        // The editor's queue was long: the picture comes after the request gave up on it.
        const asked = yield* Effect.forkChild(
          Stream.runHead(events.subscribe("screenshot")),
          { startImmediately: true }
        );
        yield* saidAfter(30);
        const late = Option.getOrThrow(yield* Fiber.join(asked));
        yield* screenshots.deliver({
          dataUrl: `data:image/png;base64,${PNG}`,
          requestId: late.requestId,
        });
        assert.include(yield* saidAfter(30), "stopped drawing pictures");
      }).pipe(Effect.provide(world), Effect.scoped)
  );

  it.effect(
    "takes the picture of an editor that draws, beside one that drew and stopped",
    () =>
      Effect.gen(function* () {
        const screenshots = yield* Screenshots;
        const stopping = yield* anEditor;
        const other = yield* anEditor;
        yield* Ref.set(other, false);
        yield* screenshots.capture(request);
        // The one that drew stops; the other draws now, and is not waited past.
        yield* Ref.set(stopping, false);
        yield* Ref.set(other, true);
        const shot = yield* screenshots.capture(request);
        assert.isAbove(shot.length, 0);
      }).pipe(Effect.provide(world), Effect.scoped)
  );
});
