/**
 * Where the last sync with Figma waits while there is no design system to keep it (ADR 0025):
 * the state directory, per repository. Sync's Figma adapter (`sync-sides.ts`) reads and writes
 * it, and keeps it in `design-system.json` once there is one; a design system written meanwhile
 * takes it in.
 */
import { SyncBaseline } from "@ultrapaint/contracts/sync";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { hashContent } from "../hash.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";

const BaselineJson = Schema.fromJsonString(SyncBaseline);
const decodeBaseline = Schema.decodeUnknownEffect(BaselineJson);
const encodeBaseline = Schema.encodeEffect(BaselineJson);

export class FigmaBaseline extends Context.Service<
  FigmaBaseline,
  {
    /** The baseline waiting for a design system, if one is. */
    readonly pending: Effect.Effect<SyncBaseline | null>;
    /** Keeps a baseline until there is a design system to keep it. */
    readonly wait: (baseline: SyncBaseline) => Effect.Effect<void>;
    /** Forgets the one waiting, once the design system keeps it. */
    readonly clear: Effect.Effect<void>;
  }
>()("ultrapaint/server/FigmaBaseline") {
  static readonly layer = Layer.effect(
    FigmaBaseline,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // The state directory is asked for at the moment of use: saving a session moves it.
      const file = Effect.map(storage.stateDir, (state) =>
        path.join(
          state,
          "design-system-sync",
          hashContent(paths.root),
          "baseline.json"
        )
      );
      return FigmaBaseline.of({
        clear: Effect.flatMap(file, (abs) =>
          Effect.ignore(fs.remove(abs, { force: true }))
        ),
        pending: Effect.gen(function* () {
          const text = yield* fs.readFileString(yield* file);
          return yield* decodeBaseline(text);
        }).pipe(
          Effect.map((found): SyncBaseline | null => found),
          // None waiting, or one written by a version that no longer reads it.
          Effect.orElseSucceed(() => null)
        ),
        wait: (baseline) =>
          Effect.orDie(
            Effect.flatMap(
              Effect.all([file, encodeBaseline(baseline)]),
              ([abs, text]) => writeAtomic(abs, text)
            )
          ),
      });
    })
  );
}
