import {
  type EventName,
  type EventPayload,
  eventNames,
} from "@ultrapaint/contracts/rpc";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

type Hubs = { readonly [E in EventName]: PubSub.PubSub<EventPayload<E>> };

/** In-process fan-out. Each connected editor runs one streaming RPC per event. */
export class EventBus extends Context.Service<
  EventBus,
  {
    readonly publish: <E extends EventName>(
      event: E,
      payload: EventPayload<E>
    ) => Effect.Effect<void>;
    readonly subscribe: <E extends EventName>(
      event: E
    ) => Stream.Stream<EventPayload<E>>;
    /**
     * An event as an editor follows it: subscribed as the stream starts, and said on `followed`
     * once the subscription holds.
     */
    readonly follow: <E extends EventName>(
      event: E
    ) => Stream.Stream<EventPayload<E>>;
    /**
     * Each event an editor starts following, once its subscription holds: how a test knows an
     * editor it set listening is, before it does what is to be heard.
     */
    readonly followed: Stream.Stream<EventName>;
  }
>()("ultrapaint/server/EventBus") {
  static readonly layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      const entries = yield* Effect.forEach(eventNames, (name) =>
        Effect.map(
          Effect.acquireRelease(PubSub.unbounded<unknown>(), PubSub.shutdown),
          (hub) => [name, hub] as const
        )
      );
      const hubs = Object.fromEntries(entries) as unknown as Hubs;
      const followed = yield* Effect.acquireRelease(
        PubSub.unbounded<EventName>(),
        PubSub.shutdown
      );
      return EventBus.of({
        follow: (event) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(hubs[event]);
              yield* PubSub.publish(followed, event);
              return Stream.fromSubscription(subscription);
            })
          ),
        followed: Stream.fromPubSub(followed),
        publish: (event, payload) =>
          Effect.asVoid(PubSub.publish(hubs[event], payload)),
        subscribe: (event) => Stream.fromPubSub(hubs[event]),
      });
    })
  );
}
