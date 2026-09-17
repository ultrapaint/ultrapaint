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
      return EventBus.of({
        publish: (event, payload) =>
          Effect.asVoid(PubSub.publish(hubs[event], payload)),
        subscribe: (event) => Stream.fromPubSub(hubs[event]),
      });
    })
  );
}
