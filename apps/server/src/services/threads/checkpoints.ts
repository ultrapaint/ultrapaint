import type { NotConfigured } from "@ultrapaint/contracts/errors";
import { type ForbiddenPath, NotFound } from "@ultrapaint/contracts/errors";
import { Checkpoint, type GitDiff } from "@ultrapaint/contracts/git";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { ServerConfig } from "../../config.ts";
import { EventBus } from "../../events.ts";
import { makeWalk } from "../../fs-walk.ts";
import { hashContent } from "../../hash.ts";
import { makeId } from "../../ids.ts";
import { ProjectManager } from "../../project.ts";
import { RepoPaths } from "../repo-paths.ts";
import { simpleDiff } from "./diff.ts";

const KEEP = 30;
const DESIGN_FILE_RE = /\.(tsx?|json|css|md)$/;

const Record = Schema.Struct({
  checkpoint: Checkpoint,
  files: Schema.Record(Schema.String, Schema.String),
});
type Record = typeof Record.Type;
const RecordJson = Schema.fromJsonString(Record);
const decodeRecord = Schema.decodeUnknownEffect(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);

/** Snapshots of the designs directory taken before each agent turn (ADR 0008). */
export class Checkpoints extends Context.Service<
  Checkpoints,
  {
    readonly create: (
      threadId: string,
      label: string
    ) => Effect.Effect<void, NotConfigured>;
    readonly diff: (
      id: string
    ) => Effect.Effect<GitDiff[], NotFound | NotConfigured>;
    readonly list: Effect.Effect<Checkpoint[]>;
    readonly revert: (
      id: string
    ) => Effect.Effect<void, NotFound | NotConfigured | ForbiddenPath>;
  }
>()("ultrapaint/server/Checkpoints") {
  static readonly layer = Layer.effect(
    Checkpoints,
    Effect.gen(function* () {
      const { home } = yield* ServerConfig;
      const project = yield* ProjectManager;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const walk = makeWalk(fs, path);
      const dir = path.join(home, "checkpoints");
      const fileOf = (id: string) => path.join(dir, `${id}.json`);
      const store = new Map<string, Record>();

      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
      const names = yield* Effect.orDie(fs.readDirectory(dir));
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        // A checkpoint that cannot be read is simply not offered.
        const record = yield* fs
          .readFileString(path.join(dir, name))
          .pipe(Effect.flatMap(decodeRecord), Effect.option);
        if (record._tag === "Some") {
          store.set(record.value.checkpoint.id, record.value);
        }
      }

      /** Repo-relative path to content for every text file of the designs directory. */
      const designFiles = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const files = yield* walk(paths.designsDir, {
            includeFile: (name) => DESIGN_FILE_RE.test(name),
            skipDir: (name) => name === "node_modules" || name.startsWith("."),
          });
          const entries = yield* Effect.forEach(files, (abs) =>
            Effect.map(
              Effect.orElseSucceed(fs.readFileString(abs), () => ""),
              (content) => [paths.relative(abs), content] as const
            )
          );
          return Object.fromEntries(entries);
        })
      );

      const find = (id: string) =>
        Effect.suspend(() => {
          const record = store.get(id);
          return record
            ? Effect.succeed(record)
            : Effect.fail(new NotFound({ message: "unknown checkpoint" }));
        });

      const create = Effect.fn("Checkpoints.create")(function* (
        threadId: string,
        label: string
      ) {
        const files = yield* designFiles;
        const record: Record = {
          checkpoint: {
            at: yield* Clock.currentTimeMillis,
            files: Object.keys(files),
            id: yield* makeId("cp"),
            label,
            threadId,
          },
          files,
        };
        store.set(record.checkpoint.id, record);
        yield* encodeRecord(record).pipe(
          Effect.flatMap((json) =>
            writeAtomic(fileOf(record.checkpoint.id), json)
          ),
          Effect.orDie
        );
        const oldest = Array.from(store.values())
          .sort((a, b) => a.checkpoint.at - b.checkpoint.at)
          .slice(0, -KEEP);
        for (const old of oldest) {
          store.delete(old.checkpoint.id);
          yield* Effect.ignore(
            fs.remove(fileOf(old.checkpoint.id), { force: true })
          );
        }
      });

      const diff = Effect.fn("Checkpoints.diff")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        const all = new Set([
          ...Object.keys(record.files),
          ...Object.keys(current),
        ]);
        const out: GitDiff[] = [];
        for (const file of all) {
          const before = record.files[file];
          const after = current[file];
          if (before !== after) {
            out.push({
              diff: simpleDiff(file, before ?? "", after ?? ""),
              path: file,
            });
          }
        }
        return out;
      });

      const revert = Effect.fn("Checkpoints.revert")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        const resolve = (file: string) =>
          project.use(
            Effect.flatMap(RepoPaths, (paths) => paths.resolve(file))
          );
        for (const [file, content] of Object.entries(record.files)) {
          if (current[file] !== content) {
            yield* Effect.orDie(writeAtomic(yield* resolve(file), content));
            yield* events.publish("file.changed", {
              file,
              hash: hashContent(content),
            });
          }
        }
        for (const file of Object.keys(current)) {
          if (!(file in record.files)) {
            yield* Effect.orDie(
              fs.remove(yield* resolve(file), { force: true })
            );
          }
        }
      });

      return Checkpoints.of({
        create,
        diff,
        list: Effect.sync(() =>
          Array.from(store.values(), (r) => r.checkpoint).sort(
            (a, b) => b.at - a.at
          )
        ),
        revert,
      });
    })
  );
}
