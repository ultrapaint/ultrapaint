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
        const error = yield* Effect.flip(client["pages.list"]());
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
          // Nothing in the fixture depends on react; the editor must learn that, and what to
          // change, from the status.
          const status = yield* client["host.start"]();
          assert.strictEqual(status.state, "error");
          assert.include(status.error ?? "", "react cannot be resolved");
        })
    );

    it.effect(
      "lists the pages of the one space and pushes the list when one is created",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const before = yield* client["pages.list"]();
          assert.deepStrictEqual(
            before.pages.map((p) => [p.id, p.route]),
            [["home.tsx", "/home"]]
          );
          // No space.json anywhere: the designs directory is itself the one space.
          assert.deepStrictEqual(
            before.spaces.map((s) => s.id),
            [""]
          );
          const { event, result } = yield* nextEvent(
            client["events.pages"](),
            client["pages.create"]({
              route: "/onboarding/sign-in",
              space: "",
            })
          );
          assert.strictEqual(result.id, "onboarding/sign-in.tsx");
          assert.strictEqual(result.route, "/onboarding/sign-in");
          const ids =
            event._tag === "Some" ? event.value.pages.map((p) => p.id) : [];
          assert.include(ids, "onboarding/sign-in.tsx");
        })
    );

    it.effect("writes the navigation module pages import, once", () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(repo, "designs/_router.tsx");
        assert.isTrue(yield* fs.exists(file));
        assert.include(yield* fs.readFileString(file), "export function Link");
      })
    );

    it.effect("refuses a second page on the same route", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["pages.create"]({ route: "onboarding/sign-in", space: "" })
        );
        assert.strictEqual(error._tag, "Conflict");
      })
    );

    it.effect("moves the canvas frame with a page sent to another route", () =>
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
          layout: { frames: { "onboarding/sign-in.tsx": frame }, version: 1 },
          space: "",
        });
        const renamed = yield* client["pages.rename"]({
          id: "onboarding/sign-in.tsx",
          route: "/onboarding/log-in",
        });
        assert.strictEqual(renamed.id, "onboarding/log-in.tsx");
        const layout = yield* client["canvas.get"]({ space: "" });
        assert.deepStrictEqual(layout.frames, {
          "onboarding/log-in.tsx": frame,
        });
      })
    );

    it.effect("keeps comments beside the canvas, resolved or not", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const { event, result: created } = yield* nextEvent(
          client["events.comments"](),
          client["comments.create"]({
            element: "h1",
            page: "home.tsx",
            source: HEADING,
            space: "",
            text: "  Bigger heading  ",
            x: 40.4,
            y: 12.6,
          })
        );
        assert.strictEqual(created.text, "Bigger heading");
        assert.deepStrictEqual([created.x, created.y], [40, 13]);
        assert.strictEqual(created.author, "Test");
        assert.isFalse(created.resolved);
        assert.strictEqual(
          event._tag === "Some" ? event.value.list.comments.length : 0,
          1
        );
        const resolved = yield* client["comments.update"]({
          id: created.id,
          resolved: true,
          space: "",
        });
        assert.isTrue(resolved.resolved);
        assert.strictEqual(resolved.text, "Bigger heading");
        const saved = JSON.parse(
          yield* fs.readFileString(path.join(repo, "designs/comments.json"))
        );
        assert.isTrue(saved.comments[0].resolved);
        const answered = yield* client["comments.reply"]({
          id: created.id,
          space: "",
          text: "Done in the last commit",
        });
        assert.deepStrictEqual(
          answered.replies.map((r) => [r.text, r.author]),
          [["Done in the last commit", "Test"]]
        );
        const [first] = answered.replies;
        const cleared = yield* client["comments.deleteReply"]({
          id: created.id,
          replyId: first?.id ?? "",
          space: "",
        });
        assert.deepStrictEqual(cleared.replies, []);
        yield* client["comments.delete"]({ id: created.id, space: "" });
        assert.deepStrictEqual(
          (yield* client["comments.list"]({ space: "" })).comments,
          []
        );
        const missing = yield* Effect.flip(
          client["comments.delete"]({ id: created.id, space: "" })
        );
        assert.strictEqual(missing._tag, "NotFound");
        // A file written before comments had threads reads as comments without replies.
        const { replies: _, ...before } = created;
        yield* fs.writeFileString(
          path.join(repo, "designs/comments.json"),
          JSON.stringify({ comments: [before], version: 1 })
        );
        const [old] = (yield* client["comments.list"]({ space: "" })).comments;
        assert.deepStrictEqual(old?.replies, []);
        yield* fs.remove(path.join(repo, "designs/comments.json"));
      })
    );

    it.effect(
      "pushes file.changed when a page is edited outside the editor",
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
        // Pages created by the tests before are undoable too; the edit is what redo offers now.
        assert.strictEqual(state.redoLabel, "Change classes (font-bold)");

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
            client["events.pages"](),
            Effect.gen(function* () {
              // Reading a directory is an I/O error no wire error describes: a defect.
              const broken = yield* Effect.exit(
                client["source.read"]({ file: "designs" })
              );
              yield* client["pages.create"]({
                route: "/after-defect",
                space: "",
              });
              return broken;
            })
          );
          assert.strictEqual(result._tag, "Failure");
          const ids =
            event._tag === "Some" ? event.value.pages.map((p) => p.id) : [];
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

    it.effect(
      "gives the implicit space a name of its own when a second one is created",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const space = yield* client["spaces.create"]({ name: "Marketing" });
          assert.strictEqual(space.id, "marketing");
          // The pages of the root would otherwise belong to no space at all.
          assert.isTrue(
            yield* fs.exists(path.join(repo, "designs/space.json"))
          );
          const { pages, spaces } = yield* client["pages.list"]();
          assert.deepStrictEqual(spaces.map((sp) => sp.id).sort(), [
            "",
            "marketing",
          ]);
          assert.isTrue(pages.every((p) => p.space === ""));
        })
    );

    it.effect(
      "lifts an element out of a page onto the canvas, and puts it back, one undo at a time",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const at = (content: string, tag: string, file: string) => {
            const lines = content.split("\n");
            const line = lines.findIndex((l) => l.includes(`<${tag}`));
            return {
              col: (lines[line] as string).indexOf(`<${tag}`),
              file,
              line: line + 1,
            };
          };
          const frame = {
            height: 40,
            preset: "custom",
            width: 200,
            x: 0,
            y: 0,
          } as const;
          const home = yield* client["source.read"]({ file: HEADING.file });
          const { item } = yield* client["canvas.extractItem"]({
            copy: false,
            frame,
            source: at(home.content, "h1", HEADING.file),
            space: "",
          });
          assert.strictEqual(item.id, "_canvas/h1.tsx");
          assert.strictEqual(item.route, "/_canvas/h1");
          const lifted = yield* client["source.read"]({ file: item.file });
          assert.include(lifted.content, "export default function H1()");
          assert.include(lifted.content, ">Hello</h1>");
          const left = yield* client["source.read"]({ file: HEADING.file });
          assert.notInclude(left.content, "<h1");
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ space: "" })).items,
            { [item.path]: frame }
          );

          // One undo puts the element back and takes the item away, module and place.
          yield* client["edit.undo"]();
          assert.strictEqual(
            (yield* client["source.read"]({ file: HEADING.file })).content,
            home.content
          );
          assert.isFalse(yield* fs.exists(path.join(repo, item.file)));
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ space: "" })).items,
            {}
          );
          yield* client["edit.redo"]();
          assert.isTrue(yield* fs.exists(path.join(repo, item.file)));
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ space: "" })).items,
            { [item.path]: frame }
          );

          // Moving the item is a layout change, and undone like one.
          const moved = { ...frame, x: 300 };
          yield* client["canvas.set"]({
            layout: { frames: {}, items: { [item.path]: moved }, version: 1 },
            space: "",
          });
          yield* client["edit.undo"]();
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ space: "" })).items,
            { [item.path]: frame }
          );

          // Into the page, the item goes; undone, it is back and the page as it was.
          yield* client["canvas.placeItem"]({
            copy: false,
            id: item.id,
            index: 0,
            into: at(left.content, "main", HEADING.file),
            root: at(lifted.content, "h1", item.file),
            space: "",
          });
          const back = yield* client["source.read"]({ file: HEADING.file });
          assert.include(back.content, "<h1");
          assert.isFalse(yield* fs.exists(path.join(repo, item.file)));
          yield* client["edit.undo"]();
          assert.isTrue(yield* fs.exists(path.join(repo, item.file)));
          assert.notInclude(
            (yield* client["source.read"]({ file: HEADING.file })).content,
            "<h1"
          );

          yield* client["canvas.removeItem"]({ id: item.id, space: "" });
          assert.isFalse(yield* fs.exists(path.join(repo, item.file)));
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ space: "" })).items,
            {}
          );
          yield* client["edit.undo"]();
          assert.isTrue(yield* fs.exists(path.join(repo, item.file)));
          yield* client["edit.redo"]();
          assert.isFalse(yield* fs.exists(path.join(repo, item.file)));
        })
    );

    it.effect("keeps a pasted image beside the item that shows it", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const frame = {
          height: 40,
          preset: "custom",
          width: 40,
          x: 0,
          y: 0,
        } as const;
        const { item } = yield* client["canvas.addImage"]({
          data: Buffer.from("not really a png").toString("base64"),
          frame,
          name: "Screen Shot.png",
          space: "",
        });
        assert.strictEqual(item.id, "_canvas/screen-shot.tsx");
        assert.isTrue(
          yield* fs.exists(path.join(repo, "designs/assets/screen-shot.png"))
        );
        const module = yield* client["source.read"]({ file: item.file });
        assert.include(module.content, '"../assets/screen-shot.png"');
        const refused = yield* Effect.flip(
          client["canvas.addImage"]({
            data: "",
            frame,
            name: "notes.txt",
            space: "",
          })
        );
        assert.strictEqual(refused._tag, "BadRequest");
      })
    );

    it.effect("undoes a page deleted, and its frame with it", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const page = yield* client["pages.create"]({
          route: "/undo-me",
          space: "",
        });
        yield* client["pages.delete"]({ id: page.id });
        assert.notInclude(
          (yield* client["pages.list"]()).pages.map((p) => p.id),
          page.id
        );
        yield* client["edit.undo"]();
        assert.include(
          (yield* client["source.read"]({ file: page.file })).content,
          "export default function"
        );
        yield* client["edit.undo"]();
        const gone = yield* Effect.flip(
          client["source.read"]({ file: page.file })
        );
        assert.strictEqual(gone._tag, "NotFound");
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
