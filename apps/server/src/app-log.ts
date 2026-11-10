import type { LogLine } from "@ultrapaint/contracts/project";
import { Clock, Context, Effect, Layer } from "effect";
import { EventBus } from "./events.ts";

const CAPACITY = 500;

/**
 * The server's notices and its agents' stderr. Kept in a ring buffer for `logs.recent` and pushed
 * to subscribers as they arrive.
 */
export class AppLog extends Context.Service<
  AppLog,
  {
    readonly log: (
      source: LogLine["source"],
      level: LogLine["level"],
      text: string
    ) => Effect.Effect<void>;
    readonly recent: (count: number) => Effect.Effect<readonly LogLine[]>;
  }
>()("ultrapaint/server/AppLog") {
  static readonly layer = Layer.effect(
    AppLog,
    Effect.gen(function* () {
      const events = yield* EventBus;
      const lines: LogLine[] = [];

      const log = Effect.fnUntraced(function* (
        source: LogLine["source"],
        level: LogLine["level"],
        text: string
      ) {
        const line: LogLine = {
          at: yield* Clock.currentTimeMillis,
          level,
          source,
          text,
        };
        lines.push(line);
        if (lines.length > CAPACITY) {
          lines.shift();
        }
        yield* events.publish("log", line);
        if (level === "error") {
          yield* Effect.logError(`[${source}] ${text}`);
        } else if (level === "warn") {
          yield* Effect.logWarning(`[${source}] ${text}`);
        } else if (source === "server") {
          yield* Effect.logInfo(`[${source}] ${text}`);
        }
      });

      return AppLog.of({
        log,
        recent: (count) => Effect.sync(() => lines.slice(-count)),
      });
    })
  );
}
