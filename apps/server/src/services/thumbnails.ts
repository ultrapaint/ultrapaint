import { BadRequest } from "@ultrapaint/contracts/errors";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { PNG_DATA_URL } from "../png-text.ts";
import { Storage } from "./storage.ts";

const KEY_RE = /^[\w-]{1,64}$/;
const UNSAFE_RE = /[^\w.-]+/g;

/**
 * Thumbnails of the Library's components, drawn by the editor's own preview and kept in the
 * state directory under the key of what they were drawn from — the catalogue and the design
 * system — so they are drawn once, and again only when either changes.
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

      const dirOf = (key: string) =>
        Effect.map(storage.stateDir, (dir) =>
          path.join(dir, "thumbnails", key)
        );

      const get = Effect.fn("Thumbnails.get")(function* (key: string) {
        if (!KEY_RE.test(key)) {
          return {};
        }
        const dir = yield* dirOf(key);
        const names = yield* Effect.orElseSucceed(
          fs.readDirectory(dir),
          (): string[] => []
        );
        const out: Record<string, string> = {};
        for (const file of names) {
          if (!file.endsWith(".png")) {
            continue;
          }
          const bytes = yield* Effect.option(fs.readFile(path.join(dir, file)));
          if (bytes._tag === "Some") {
            out[file.slice(0, -4)] =
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
        const dir = yield* dirOf(key);
        const file = path.join(dir, `${name.replaceAll(UNSAFE_RE, "_")}.png`);
        const bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL.length), "base64");
        yield* Effect.ignore(
          Effect.andThen(
            fs.makeDirectory(dir, { recursive: true }),
            fs.writeFile(file, new Uint8Array(bytes))
          ),
          { log: true }
        );
      });

      return Thumbnails.of({ get, put });
    })
  );
}
