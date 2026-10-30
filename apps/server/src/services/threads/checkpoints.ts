import type { NotConfigured, NotFound } from "@ultrapaint/contracts/errors";
import { Checkpoint, type FileDiff } from "@ultrapaint/contracts/snapshots";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { EventBus } from "../../events.ts";
import { makeId } from "../../ids.ts";
import { type DesignRef, keepsFile, makeDesignRefs } from "../design-refs.ts";
import type { EditFailure } from "../edit.ts";

/** The snapshot store's namespace for the checkpoints taken before agent turns. */
const NAMESPACE = "checkpoints";

/**
 * How many checkpoints are kept, of every repository together: the oldest go first. 30; a test
 * that goes past it gives fewer, so it takes as many turns fewer.
 */
export const CheckpointsKept: Context.Reference<number> =
  Context.Reference<number>("ultrapaint/server/CheckpointsKept", {
    defaultValue: () => 30,
  });

/** What the store's ref of a checkpoint notes beside the files. */
const Note = Schema.Struct({
  checkpoint: Checkpoint,
  repo: Schema.optional(Schema.String),
});
type Note = typeof Note.Type;

/**
 * A checkpoint as it was kept before the snapshot store: one JSON file per checkpoint under
 * `<state>/checkpoints`, with every design file's text. Read once, to move it into the store.
 */
const decodeOldRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      checkpoint: Checkpoint,
      files: Schema.Record(Schema.String, Schema.String),
      repo: Schema.optional(Schema.String),
    })
  )
);

/**
 * The designs as they were before each agent turn (ADR 0008), to compare with now and to go
 * back to. Each is a ref of the snapshot store's `checkpoints` namespace, as a named snapshot is
 * one of `designs`: a file unchanged from one turn to the next is kept once. The editor is told
 * the list as a turn takes one and as the oldest go (`checkpoints`), whether the turn writes or
 * not.
 */
export class Checkpoints extends Context.Service<
  Checkpoints,
  {
    readonly create: (
      threadId: string,
      label: string
    ) => Effect.Effect<void, NotConfigured>;
    readonly diff: (
      id: string
    ) => Effect.Effect<FileDiff[], NotFound | NotConfigured>;
    /** The checkpoint of the open repository, with the store's snapshot of its files. */
    readonly find: (
      id: string
    ) => Effect.Effect<
      DesignRef<{ readonly checkpoint: Checkpoint }>,
      NotFound
    >;
    readonly list: Effect.Effect<Checkpoint[]>;
    /** The designs put back as the checkpoint kept them: one undo step. */
    readonly revert: (
      id: string
    ) => Effect.Effect<void, NotConfigured | EditFailure>;
  }
>()("ultrapaint/server/Checkpoints") {
  static readonly layer = Layer.effect(
    Checkpoints,
    Effect.gen(function* () {
      const events = yield* EventBus;
      const refs = yield* makeDesignRefs({
        idOf: (note: Note) => note.checkpoint.id,
        keepLast: yield* CheckpointsKept,
        listed: (note) => note.checkpoint,
        namespace: NAMESPACE,
        note: Schema.fromJsonString(Note),
        publish: (list) => events.publish("checkpoints", list),
        what: "checkpoint",
      });

      yield* refs.importOld("checkpoints", (text) =>
        Effect.map(decodeOldRecord(text), ({ checkpoint, files, repo }) => ({
          files,
          note: {
            checkpoint: {
              ...checkpoint,
              files: checkpoint.files.filter(keepsFile),
            },
            ...(repo !== undefined && { repo }),
          },
        }))
      );

      const create = Effect.fn("Checkpoints.create")(function* (
        threadId: string,
        label: string
      ) {
        const files = yield* refs.designFiles;
        yield* refs.keep(
          {
            checkpoint: {
              at: yield* Clock.currentTimeMillis,
              files: Object.keys(files),
              id: yield* makeId("cp"),
              label,
              threadId,
            },
          },
          files
        );
      });

      const diff = Effect.fn("Checkpoints.diff")(function* (id: string) {
        return yield* refs.diff(yield* refs.find(id));
      });

      const revert = Effect.fn("Checkpoints.revert")(function* (id: string) {
        const ref = yield* refs.find(id);
        yield* refs.putBack(
          ref,
          `Revert to the checkpoint ${ref.checkpoint.label}`
        );
      });

      return Checkpoints.of({
        create,
        diff,
        find: refs.find,
        list: refs.list,
        revert,
      });
    })
  );
}
