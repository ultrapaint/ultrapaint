import { BadRequest } from "@ultrapaint/contracts/errors";
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect";
import { PNG_DATA_URL } from "../png-text.ts";
import { Storage } from "./storage.ts";
import { THREADS_DIR, threadFileName } from "./threads/thread-store.ts";

const KEY_RE = /^[\w-]{1,64}$/;
const UNSAFE_RE = /[^\w.-]+/g;
const PNG = ".png";

/**
 * The key the editor keeps the pictures of the threads under (its `thread-previews.ts`), each
 * named `<thread>__<what it was drawn from>`. Every other key is a state of the design system
 * and the catalogue, which the Library's thumbnails were drawn from.
 */
const THREADS_KEY = "threads";
const DRAWN_FROM = "__";

/** The thread a picture's file is of; null for a file not named as a thread's picture is. */
const threadOf = (file: string): string | null => {
  const at = file.indexOf(DRAWN_FROM);
  return file.endsWith(PNG) && at > 0 ? file.slice(0, at) : null;
};

/**
 * Thumbnails of the Library's components, drawn by the editor's own preview and kept in the
 * state directory under the key of what they were drawn from — the catalogue and the design
 * system — so they are drawn once, and again only when either changes. The pictures of the
 * threads are kept the same way, under a key of their own.
 *
 * What nothing asks for again is let go of, since a picture not kept is only drawn again:
 *
 * - a thread's earlier pictures, when a later one is put: the editor shows a thread's last;
 * - the pictures of a thread that is gone, which has no file in the state directory, when the
 *   threads' pictures are next asked for;
 * - the directories of the states an editor was in before this server started, when the first
 *   key of a state is asked for: the states asked for since are all kept, so going back and
 *   forth between two of them draws nothing again.
 */
export class Thumbnails extends Context.Service<
  Thumbnails,
  {
    readonly get: (key: string) => Effect.Effect<Record<string, string>>;
    readonly put: (
      key: string,
      name: string,
      dataUrl: string
    ) => Effect.Effect<void, BadRequest>;
  }
>()("ultrapaint/server/Thumbnails") {
  static readonly layer = Layer.effect(
    Thumbnails,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const root = Effect.map(storage.stateDir, (dir) =>
        path.join(dir, "thumbnails")
      );
      const dirOf = (key: string) =>
        Effect.map(root, (dir) => path.join(dir, key));
      const namesIn = (dir: string) =>
        Effect.orElseSucceed(fs.readDirectory(dir), (): string[] => []);
      // A picture that stays is only one too many; the next time lets go of it.
      const letGo = (file: string) =>
        Effect.ignore(fs.remove(file, { recursive: true }), { log: true });

      /** The states asked for since the server started. */
      const asked = new Set<string>();
      const keepStatesAsked = Effect.fnUntraced(function* (key: string) {
        if (key === THREADS_KEY || asked.has(key)) {
          return;
        }
        asked.add(key);
        const dir = yield* root;
        for (const name of yield* namesIn(dir)) {
          if (name !== THREADS_KEY && KEY_RE.test(name) && !asked.has(name)) {
            yield* letGo(path.join(dir, name));
          }
        }
      });

      /** When the file was written; the oldest there can be for one that says nothing. */
      const writtenAt = (file: string) =>
        Effect.map(Effect.option(fs.stat(file)), (info) =>
          Option.getOrElse(
            Option.map(
              Option.flatMap(info, (i) => i.mtime),
              (at) => at.getTime()
            ),
            () => 0
          )
        );

      /** Whether the thread is there: it has its file, or nothing can be told of that. */
      const threadThere = Effect.fnUntraced(function* (thread: string) {
        const file = path.join(
          yield* storage.stateDir,
          THREADS_DIR,
          threadFileName(thread)
        );
        return yield* Effect.orElseSucceed(fs.exists(file), () => true);
      });

      /**
       * The threads' pictures in `dir` that are still asked for: the last one written of each
       * thread there is. The others are removed. A file not named as a thread's picture stays.
       */
      const keepThreadsLast = Effect.fnUntraced(function* (
        dir: string,
        names: readonly string[]
      ) {
        const kept: string[] = [];
        const byThread = new Map<string, string[]>();
        for (const name of names) {
          const thread = threadOf(name);
          if (thread === null) {
            kept.push(name);
          } else {
            byThread.set(thread, [...(byThread.get(thread) ?? []), name]);
          }
        }
        for (const [thread, pictures] of byThread) {
          const times = yield* Effect.forEach(pictures, (name) =>
            Effect.map(
              writtenAt(path.join(dir, name)),
              (at) => [name, at] as const
            )
          );
          const [last] = (yield* threadThere(thread))
            ? times.toSorted(([, a], [, b]) => b - a)
            : [];
          for (const name of pictures) {
            if (name === last?.[0]) {
              kept.push(name);
            } else {
              yield* letGo(path.join(dir, name));
            }
          }
        }
        return kept;
      });

      const get = Effect.fn("Thumbnails.get")(function* (key: string) {
        if (!KEY_RE.test(key)) {
          return {};
        }
        yield* keepStatesAsked(key);
        const dir = yield* dirOf(key);
        const found = yield* namesIn(dir);
        const names =
          key === THREADS_KEY ? yield* keepThreadsLast(dir, found) : found;
        const out: Record<string, string> = {};
        for (const file of names) {
          if (!file.endsWith(PNG)) {
            continue;
          }
          const bytes = yield* Effect.option(fs.readFile(path.join(dir, file)));
          if (bytes._tag === "Some") {
            out[file.slice(0, -PNG.length)] =
              `${PNG_DATA_URL}${Buffer.from(bytes.value).toString("base64")}`;
          }
        }
        return out;
      });

      const put = Effect.fn("Thumbnails.put")(function* (
        key: string,
        name: string,
        dataUrl: string
      ) {
        if (!(KEY_RE.test(key) && dataUrl.startsWith(PNG_DATA_URL))) {
          return yield* new BadRequest({ message: "not a PNG thumbnail" });
        }
        yield* keepStatesAsked(key);
        const dir = yield* dirOf(key);
        const written = `${name.replaceAll(UNSAFE_RE, "_")}${PNG}`;
        const bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL.length), "base64");
        // A thumbnail that is not kept is only drawn again.
        const kept = yield* Effect.isSuccess(
          Effect.andThen(
            fs.makeDirectory(dir, { recursive: true }),
            fs.writeFile(path.join(dir, written), new Uint8Array(bytes))
          ).pipe(Effect.tapError((error) => Effect.log(error)))
        );
        const thread = kept && key === THREADS_KEY ? threadOf(written) : null;
        if (thread === null) {
          return;
        }
        // The thread's pictures from before: this one is what the editor shows of it now.
        for (const other of yield* namesIn(dir)) {
          if (other !== written && threadOf(other) === thread) {
            yield* letGo(path.join(dir, other));
          }
        }
      });

      return Thumbnails.of({ get, put });
    })
  );
}
