import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Ref, Schedule, Stream } from "effect";
import { readPngText } from "./png-text.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";

/** A 1×1 PNG, as an editor would deliver it. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = () => new Uint8Array(Buffer.from(PNG, "base64"));

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "page PNGs",
  (it) => {
    it.effect(
      "draws every page beside its file, again only when it changes, and removes it with the page",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const designs = path.join(repo, settings.designsDir);
          const home = path.join(designs, "home.page.png");
          const keyOf = Effect.map(fs.readFile(home), (bytes) =>
            readPngText(bytes, "ultrapaint")
          );
          /** Waits for the PNG to carry a key other than `previous`. */
          const redrawn = (previous: string | null) =>
            keyOf.pipe(
              Effect.flatMap((key) =>
                key !== null && key !== previous
                  ? Effect.succeed(key)
                  : Effect.fail("not yet")
              ),
              Effect.retry(Schedule.spaced("100 millis")),
              Effect.timeout("10 seconds")
            );

          // A PNG someone else put here: it carries no key of ours, so it is never removed.
          const theirs = path.join(designs, "logo.page.png");
          yield* fs.writeFile(theirs, pngBytes());

          // Off: nothing is drawn, whoever can draw.
          yield* client["settings.set"](settings);
          const asked = yield* Ref.make<string[]>([]);
          yield* Effect.forkScoped(
            client["events.screenshot"]().pipe(
              Stream.runForEach((request) =>
                Ref.update(asked, (all) => [...all, request.requestId]).pipe(
                  Effect.andThen(
                    client["screenshots.deliver"]({
                      dataUrl: `data:image/png;base64,${PNG}`,
                      requestId: request.requestId,
                    })
                  )
                )
              )
            )
          );
          yield* Effect.sleep("2 seconds");
          assert.isFalse(yield* fs.exists(home));

          // On: the page is drawn at its frame's size, its key in the file.
          yield* client["settings.set"]({ ...settings, pagePngs: true });
          const first = yield* redrawn(null);
          const drawnOnce = (yield* Ref.get(asked)).length;
          assert.strictEqual(drawnOnce, 1);

          // A change to the canvas that is not this page's frame leaves the PNG as it is.
          yield* client["pages.create"]({ canvas: "", name: "Other" });
          yield* Effect.sleep("2500 millis");
          assert.strictEqual(yield* keyOf, first);
          assert.isTrue(yield* fs.exists(path.join(designs, "other.page.png")));
          assert.strictEqual((yield* Ref.get(asked)).length, drawnOnce + 1);

          // The page changes: it is drawn again.
          yield* client["documents.apply"]({
            edits: [
              {
                doc: "home.page.json",
                ops: [
                  { id: "heading", op: "update", set: { text: "Welcome" } },
                ],
              },
            ],
          });
          yield* redrawn(first);

          // The page goes: its PNG goes with it, and the one we did not write stays.
          const { pages } = yield* client["pages.list"]();
          const other = pages.find((p) => p.file.endsWith("other.page.json"));
          assert.isDefined(other);
          if (other) {
            yield* client["pages.delete"]({ id: other.id });
          }
          yield* fs.exists(path.join(designs, "other.page.png")).pipe(
            Effect.flatMap((there) =>
              there ? Effect.fail("still there") : Effect.void
            ),
            Effect.retry(Schedule.spaced("100 millis")),
            Effect.timeout("10 seconds")
          );
          assert.isTrue(yield* fs.exists(theirs));
        }),
      30_000
    );
  }
);
