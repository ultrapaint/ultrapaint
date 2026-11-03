import { Effect } from "effect";
import { EvalsError } from "./errors.ts";

/** A picture from the web: its bytes and its type, an HTTP error being a failure. */
export const fetchPicture = Effect.fn("fetchPicture")(function* (url: string) {
  const failed = (cause: unknown) =>
    new EvalsError({ message: `downloading ${url}: ${String(cause)}` });
  const response = yield* Effect.tryPromise({
    catch: failed,
    try: () => fetch(url),
  });
  if (!response.ok) {
    return yield* failed(`HTTP ${response.status}`);
  }
  const bytes = yield* Effect.tryPromise({
    catch: failed,
    try: () => response.arrayBuffer(),
  });
  return {
    bytes: new Uint8Array(bytes),
    mime: response.headers.get("content-type") ?? "image/png",
  };
});
