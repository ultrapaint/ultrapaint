import { request } from "node:http";
import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { EditOp } from "@ultrapaint/contracts/edit";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const SHA_RE = /^[0-9a-f]{40}$/;
const HEADING = { col: 6, file: "designs/home.tsx", line: 4 };

const setClasses = (add: string[], file = HEADING.file): EditOp => ({
  add,
  kind: "setClasses",
  remove: [],
  target: { ...HEADING, file },
});

/** The first value of an event stream that arrives after `trigger` has run. */
const nextEvent = <A, E, B, E2, R2>(
  stream: Stream.Stream<A, E>,
  trigger: Effect.Effect<B, E2, R2>
) =>
  Effect.gen(function* () {
    const first = yield* Effect.forkScoped(Stream.runHead(stream));
    // The subscription has to reach the server before the change happens.
    yield* Effect.sleep("150 millis");
    const result = yield* trigger;
    const event = yield* Fiber.join(first);
    return { event, result };
  });

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "server over WebSocket RPC",
  (it) => {
    it.effect("answers before any repository is configured", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        assert.deepStrictEqual(yield* client.health(), {
          ok: true,
          version: "test",
        });
        assert.isNull(yield* client["settings.get"]());
        assert.isFalse((yield* client["project.info"]()).configured);
      })
    );

    it.effect("fails project requests with a typed NotConfigured", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(client["screens.list"]());
        assert.strictEqual(error._tag, "NotConfigured");
      })
    );

    it.effect("rejects a payload that does not match the schema", () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        const exit = yield* Effect.exit(
          client["settings.set"]({ ...settings, theme: "neon" as "light" })
        );
        assert.strictEqual(exit._tag, "Failure");
      })
    );

    it.effect(
      "reports what is wrong with settings instead of saving them",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          const validation = yield* client["settings.set"]({
            ...settings,
            designsDir: "missing",
          });
          assert.isFalse(validation.ok);
          assert.include(validation.problems.join("\n"), "missing");
          assert.isNull(yield* client["settings.get"]());
        })
    );

    it.effect("opens the project when valid settings are saved", () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const validation = yield* client["settings.set"](settings);
        assert.deepStrictEqual(validation.problems, []);
        assert.strictEqual(validation.branch, "main");
        const info = yield* client["project.info"]();
        assert.isTrue(info.configured);
        assert.strictEqual(info.repoPath, repo);
        assert.strictEqual(info.branch, "main");
      })
    );

    it.effect(
      "reports a host that cannot start as a status, not a failure",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          // The fixture has no `vite`; the editor must learn that from the status.
          const status = yield* client["host.start"]();
          assert.strictEqual(status.state, "error");
          assert.include(status.error ?? "", "vite");
        })
    );

    it.effect("lists screens and pushes the list when one is created", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const before = yield* client["screens.list"]();
        assert.deepStrictEqual(
          before.screens.map((s) => s.id),
          ["home.tsx"]
        );
        const { event, result } = yield* nextEvent(
          client["events.screens"](),
          client["screens.create"]({ flow: "onboarding", name: "Sign In" })
        );
        assert.strictEqual(result.id, "onboarding/sign-in.tsx");
        assert.strictEqual(result.flow, "onboarding");
        const ids =
          event._tag === "Some" ? event.value.screens.map((s) => s.id) : [];
        assert.include(ids, "onboarding/sign-in.tsx");
      })
    );

    it.effect("refuses a second screen with the same name", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["screens.create"]({ flow: "onboarding", name: "Sign In" })
        );
        assert.strictEqual(error._tag, "Conflict");
      })
    );

    it.effect("moves the canvas frame with a renamed screen", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const frame = {
          height: 844,
          preset: "mobile",
          width: 390,
          x: 10,
          y: 20,
        } as const;
        yield* client["canvas.set"]({
          flow: "onboarding",
          layout: { frames: { "sign-in.tsx": frame }, version: 1 },
        });
        const renamed = yield* client["screens.rename"]({
          id: "onboarding/sign-in.tsx",
          name: "Log In",
        });
        assert.strictEqual(renamed.id, "onboarding/log-in.tsx");
        const layout = yield* client["canvas.get"]({ flow: "onboarding" });
        assert.deepStrictEqual(layout.frames, { "log-in.tsx": frame });
      })
    );

    it.effect(
      "pushes file.changed when a screen is edited outside the editor",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "designs/onboarding/log-in.tsx");
          const { event } = yield* nextEvent(
            client["events.file.changed"](),
            Effect.flatMap(fs.readFileString(file), (content) =>
              fs.writeFileString(file, `${content}// touched\n`)
            )
          );
          assert.strictEqual(
            event._tag === "Some" ? event.value.file : "",
            "designs/onboarding/log-in.tsx"
          );
        })
    );

    it.effect("applies an edit, then undoes and redoes it", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const original = yield* client["source.read"]({ file: HEADING.file });
        const applied = yield* client["edit.apply"]({
          expectedHash: original.hash,
          op: setClasses(["font-bold"]),
        });
        assert.isTrue(applied.changed);
        const edited = yield* client["source.read"]({ file: HEADING.file });
        assert.include(edited.content, "font-bold");
        assert.strictEqual(edited.hash, applied.hash);
        assert.isTrue((yield* client["edit.state"]()).canUndo);

        const undone = yield* client["edit.undo"]();
        assert.strictEqual(undone?.hash, original.hash);
        const state = yield* client["edit.state"]();
        assert.isTrue(state.canRedo);
        assert.isFalse(state.canUndo);

        const redone = yield* client["edit.redo"]();
        assert.strictEqual(redone?.hash, applied.hash);
      })
    );

    it.effect("rejects an edit made against an outdated hash", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["edit.apply"]({
            expectedHash: "0000000000000000",
            op: setClasses(["underline"]),
          })
        );
        assert.strictEqual(error._tag, "Stale");
      })
    );

    it.effect("drops undo history when the file changed behind its back", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(repo, HEADING.file);
        const content = yield* fs.readFileString(file);
        yield* fs.writeFileString(file, `${content}// external\n`);
        const error = yield* Effect.flip(client["edit.undo"]());
        assert.strictEqual(error._tag, "Stale");
        const state = yield* client["edit.state"]();
        assert.isFalse(state.canUndo);
        assert.include(state.invalidated ?? "", "changed outside the editor");
      })
    );

    it.effect(
      "keeps edits inside the designs directory and the repository",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const outside = yield* Effect.flip(
            client["edit.apply"]({
              op: setClasses(["p-2"], "package.json"),
            })
          );
          assert.strictEqual(outside._tag, "ForbiddenPath");
          const escaped = yield* Effect.flip(
            client["source.read"]({ file: "/etc/hosts" })
          );
          assert.strictEqual(escaped._tag, "ForbiddenPath");
        })
    );

    it.effect("describes the element at a source location", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const element = yield* client["source.element"](HEADING);
        assert.strictEqual(element?.name, "h1");
        assert.strictEqual(element?.text, "Hello");
        assert.isTrue(element?.editable);
      })
    );

    it.effect("reports git status, diffs and commits design files", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const status = yield* client["git.status"]();
        assert.strictEqual(status.branch, "main");
        const changed = status.files.map((f) => f.path);
        assert.include(changed, "designs/home.tsx");
        assert.include(changed, "designs/onboarding/log-in.tsx");
        assert.isTrue(status.files.every((f) => f.design));

        const tracked = yield* client["git.diff"]({ path: "designs/home.tsx" });
        assert.include(tracked.diff, "+// external");
        const untracked = yield* client["git.diff"]({
          path: "designs/onboarding/log-in.tsx",
        });
        assert.include(untracked.diff, "+export default function");

        const { event, result } = yield* nextEvent(
          client["events.git"](),
          client["git.commit"]({ message: "designs", paths: changed })
        );
        assert.match(result.sha, SHA_RE);
        assert.deepStrictEqual(
          event._tag === "Some" ? event.value.files : null,
          []
        );
      })
    );

    it.effect(
      "fails one request on an unexpected error and keeps the event streams",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const { event, result } = yield* nextEvent(
            client["events.screens"](),
            Effect.gen(function* () {
              // Reading a directory is an I/O error no wire error describes: a defect.
              const broken = yield* Effect.exit(
                client["source.read"]({ file: "designs" })
              );
              yield* client["screens.create"]({
                flow: "",
                name: "After Defect",
              });
              return broken;
            })
          );
          assert.strictEqual(result._tag, "Failure");
          const ids =
            event._tag === "Some" ? event.value.screens.map((s) => s.id) : [];
          assert.include(ids, "after-defect.tsx");
          assert.isTrue((yield* client.health()).ok);
        })
    );

    it.effect("builds the component catalogue off the main thread", () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });
        const catalogue = yield* client["catalogue.get"]({ refresh: true });
        const button = catalogue.components.find((c) => c.name === "Button");
        assert.strictEqual(button?.file, "ui/button.tsx");
        assert.deepStrictEqual(
          button?.props.map((p) => [p.name, p.type.kind, p.required]),
          [
            ["disabled", "boolean", false],
            ["label", "string", true],
            ["variant", "enum", false],
          ]
        );
        // The second call is served from the cache and returns the same build.
        const again = yield* client["catalogue.get"]({ refresh: false });
        assert.strictEqual(again.builtAt, catalogue.builtAt);
      })
    );

    it.effect(
      "undoes the edit that is still being formatted, instead of dropping history",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          // A slow formatter keeps the edit in flight while the undo arrives.
          yield* client["settings.set"]({
            ...settings,
            formatCommand: "sleep 0.4",
          });
          const before = yield* client["source.read"]({ file: HEADING.file });
          const edit = yield* Effect.forkScoped(
            client["edit.apply"]({ op: setClasses(["italic"]) })
          );
          yield* Effect.sleep("100 millis");
          const undone = yield* client["edit.undo"]();
          yield* Fiber.join(edit);
          assert.strictEqual(undone?.hash, before.hash);
          const state = yield* client["edit.state"]();
          assert.isUndefined(state.invalidated);
          assert.isTrue(state.canRedo);
        })
    );

    it.effect("turns away a browser page from another origin", () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        const status = yield* Effect.callback<number>((resume) => {
          const req = request({
            headers: {
              Connection: "Upgrade",
              Origin: "https://evil.example",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
              Upgrade: "websocket",
            },
            host: "127.0.0.1",
            path: "/ws",
            port,
          });
          req.on("response", (res) =>
            resume(Effect.succeed(res.statusCode ?? 0))
          );
          req.on("upgrade", () => resume(Effect.succeed(101)));
          req.on("error", () => resume(Effect.succeed(-1)));
          req.end();
        });
        assert.strictEqual(status, 403);
      })
    );
  }
);
