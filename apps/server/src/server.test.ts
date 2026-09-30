import { request } from "node:http";
import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const SHA_RE = /^[0-9a-f]{40}$/;
const HOME = "home.page.json";
const HOME_FILE = "designs/home.page.json";

const paragraph = (id: string, text: string): DesignNode => ({
  id,
  role: "paragraph",
  text,
  type: "text",
});

const childIds = (node: DesignNode | null | undefined) =>
  node && "children" in node ? (node.children ?? []).map((c) => c.id) : [];

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
      "lists the pages of the one canvas and pushes the list when one is created",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const before = yield* client["pages.list"]();
          assert.deepStrictEqual(
            before.pages.map((p) => [p.id, p.route]),
            [[HOME, "/home"]]
          );
          // No canvas.json anywhere: the designs directory is itself the one canvas.
          assert.deepStrictEqual(
            before.canvases.map((s) => s.id),
            [""]
          );
          const { event, result } = yield* nextEvent(
            client["events.pages"](),
            client["pages.create"]({
              canvas: "",
              name: "Sign in",
              route: "/onboarding/sign-in",
            })
          );
          // The file is the name's; the URL is the canvas's to say.
          assert.strictEqual(result.id, "sign-in.page.json");
          assert.strictEqual(result.name, "Sign in");
          assert.strictEqual(result.route, "/onboarding/sign-in");
          const listed =
            event._tag === "Some"
              ? event.value.pages.map((p) => [p.id, p.route])
              : [];
          assert.deepInclude(listed, [
            "sign-in.page.json",
            "/onboarding/sign-in",
          ]);
          // The page that was there keeps the URL its path gave it once the routes are written.
          assert.deepInclude(listed, [HOME, "/home"]);
          const layout = yield* client["canvas.get"]({ canvas: "" });
          assert.deepStrictEqual(layout.routes, {
            [HOME]: "/home",
            "sign-in.page.json": "/onboarding/sign-in",
          });
        })
    );

    it.effect("starts a page from a template, titled after its name", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const page = yield* client["pages.create"]({
          canvas: "",
          name: "Welcome back",
          template: "centered",
        });
        // Without a URL: drawn like any other page, reached by nothing.
        assert.strictEqual(page.id, "welcome-back.page.json");
        assert.isUndefined(page.route);
        const state = yield* client["documents.get"]({ doc: page.id });
        assert.strictEqual(state.root?.type, "page");
        const [title] =
          state.root && "children" in state.root
            ? (state.root.children ?? [])
            : [];
        assert.deepInclude(title, { role: "heading", text: "Welcome back" });
        yield* client["pages.delete"]({ id: page.id });
      })
    );

    it.effect("refuses a second page on the same URL", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["pages.create"]({
            canvas: "",
            name: "Log in",
            route: "onboarding/sign-in",
          })
        );
        assert.strictEqual(error._tag, "Conflict");
        const taken = yield* Effect.flip(
          client["pages.setRoute"]({ id: HOME, route: "/onboarding/sign-in/" })
        );
        assert.strictEqual(taken._tag, "Conflict");
      })
    );

    it.effect("gives a page a URL, changes it and takes it off", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const page = yield* client["pages.create"]({
          canvas: "",
          name: "Draft",
        });
        const served = yield* client["pages.setRoute"]({
          id: page.id,
          route: "drafts/one",
        });
        assert.strictEqual(served.route, "/drafts/one");
        const none = yield* client["pages.setRoute"]({
          id: page.id,
          route: null,
        });
        assert.isUndefined(none.route);
        yield* client["pages.delete"]({ id: page.id });
        const layout = yield* client["canvas.get"]({ canvas: "" });
        assert.notProperty(layout.routes ?? {}, page.path);
      })
    );

    it.effect("renames a page: its frame goes along, its URL stays", () =>
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
          canvas: "",
          frames: { "sign-in.page.json": frame },
        });
        const renamed = yield* client["pages.rename"]({
          id: "sign-in.page.json",
          name: "Log in",
        });
        assert.strictEqual(renamed.id, "log-in.page.json");
        assert.strictEqual(renamed.route, "/onboarding/sign-in");
        const layout = yield* client["canvas.get"]({ canvas: "" });
        assert.deepStrictEqual(layout.frames, { "log-in.page.json": frame });
        assert.strictEqual(
          layout.routes?.["log-in.page.json"],
          "/onboarding/sign-in"
        );
      })
    );

    it.effect("keeps comments beside the canvas, resolved or not", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const { event, result: created } = yield* nextEvent(
          client["events.comments"](),
          client["comments.create"]({
            canvas: "",
            element: "Hello",
            nodeId: "heading",
            page: HOME,
            text: "  Bigger heading  ",
            x: 40.4,
            y: 12.6,
          })
        );
        assert.strictEqual(created.text, "Bigger heading");
        assert.deepStrictEqual([created.x, created.y], [40, 13]);
        assert.strictEqual(created.author, "Test");
        assert.strictEqual(created.nodeId, "heading");
        assert.isFalse(created.resolved);
        assert.strictEqual(
          event._tag === "Some" ? event.value.list.comments.length : 0,
          1
        );
        const resolved = yield* client["comments.update"]({
          canvas: "",
          id: created.id,
          resolved: true,
        });
        assert.isTrue(resolved.resolved);
        assert.strictEqual(resolved.text, "Bigger heading");
        const saved = JSON.parse(
          yield* fs.readFileString(path.join(repo, "designs/comments.json"))
        );
        assert.isTrue(saved.comments[0].resolved);
        const answered = yield* client["comments.reply"]({
          canvas: "",
          id: created.id,
          text: "Done in the last commit",
        });
        assert.deepStrictEqual(
          answered.replies.map((r) => [r.text, r.author]),
          [["Done in the last commit", "Test"]]
        );
        const [first] = answered.replies;
        const cleared = yield* client["comments.deleteReply"]({
          canvas: "",
          id: created.id,
          replyId: first?.id ?? "",
        });
        assert.deepStrictEqual(cleared.replies, []);
        yield* client["comments.delete"]({ canvas: "", id: created.id });
        assert.deepStrictEqual(
          (yield* client["comments.list"]({ canvas: "" })).comments,
          []
        );
        const missing = yield* Effect.flip(
          client["comments.delete"]({ canvas: "", id: created.id })
        );
        assert.strictEqual(missing._tag, "NotFound");
        // A file written before comments had threads reads as comments without replies.
        const { replies: _, ...before } = created;
        yield* fs.writeFileString(
          path.join(repo, "designs/comments.json"),
          JSON.stringify({ comments: [before], version: 1 })
        );
        const [old] = (yield* client["comments.list"]({ canvas: "" })).comments;
        assert.deepStrictEqual(old?.replies, []);
        yield* fs.remove(path.join(repo, "designs/comments.json"));
      })
    );

    it.effect(
      "pushes the document when a page is written outside the editor, ids filled in",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "designs/log-in.page.json");
          // What an agent might write: a node without an id.
          const written = {
            root: {
              children: [{ role: "paragraph", text: "By hand", type: "text" }],
              id: "root",
              type: "page",
            },
            version: 1,
          };
          const { event } = yield* nextEvent(
            client["events.document"]().pipe(
              Stream.filter((e) => e.doc === "log-in.page.json")
            ),
            fs.writeFileString(file, JSON.stringify(written))
          );
          assert.strictEqual(
            event._tag === "Some" ? event.value.doc : "",
            "log-in.page.json"
          );
          const [node] =
            event._tag === "Some" &&
            event.value.root &&
            "children" in event.value.root
              ? (event.value.root.children ?? [])
              : [];
          assert.isString(node?.id);
          // The id is written back, so the file says what the editor calls the node.
          const saved = JSON.parse(yield* fs.readFileString(file));
          assert.strictEqual(saved.root.children[0].id, node?.id);
        })
    );

    it.effect(
      "reports a page that is not a valid document instead of failing",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            path.join(repo, "designs/broken.page.json"),
            '{ "version": 1, "root": { "type": "row" } }'
          );
          const state = yield* client["documents.get"]({
            doc: "broken.page.json",
          });
          assert.isNull(state.root);
          assert.isString(state.problem);
          const refused = yield* Effect.flip(
            client["documents.apply"]({
              edits: [
                { doc: "broken.page.json", ops: [{ id: "x", op: "remove" }] },
              ],
            })
          );
          assert.strictEqual(refused._tag, "BadRequest");
          yield* fs.remove(path.join(repo, "designs/broken.page.json"));
        })
    );

    it.effect("applies operations, then undoes and redoes them", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const original = yield* client["documents.get"]({ doc: HOME });
        const { event, result: applied } = yield* nextEvent(
          client["events.document"]().pipe(
            Stream.filter((e) => e.doc === HOME)
          ),
          client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                expectedHash: original.hash,
                ops: [
                  { id: "heading", op: "update", set: { text: "Welcome" } },
                  {
                    node: {
                      children: [paragraph("left", "Left")],
                      gap: "$spacing-4",
                      id: "row",
                      type: "row",
                    },
                    op: "insert",
                    parent: "root",
                  },
                ],
              },
            ],
            label: "Build the header",
          })
        );
        assert.deepStrictEqual(applied.created, ["row"]);
        const [state] = applied.documents;
        assert.deepStrictEqual(childIds(state?.root), ["heading", "row"]);
        assert.strictEqual(
          event._tag === "Some" ? event.value.hash : "",
          state?.hash
        );
        const saved = JSON.parse(
          yield* fs.readFileString(path.join(repo, HOME_FILE))
        );
        assert.strictEqual(saved.version, 1);
        assert.strictEqual(saved.root.children[0].text, "Welcome");
        assert.strictEqual(
          (yield* client["edit.state"]()).undoLabel,
          "Build the header"
        );

        const undone = yield* client["edit.undo"]();
        assert.deepStrictEqual(undone?.files, [HOME_FILE]);
        assert.strictEqual(
          (yield* client["documents.get"]({ doc: HOME })).hash,
          original.hash
        );
        const state2 = yield* client["edit.state"]();
        assert.isTrue(state2.canRedo);
        assert.strictEqual(state2.redoLabel, "Build the header");

        yield* client["edit.redo"]();
        assert.strictEqual(
          (yield* client["documents.get"]({ doc: HOME })).hash,
          state?.hash
        );
      })
    );

    it.effect("refuses operations made against an outdated hash", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                expectedHash: "0000000000000000",
                ops: [{ id: "heading", op: "remove" }],
              },
            ],
          })
        );
        assert.strictEqual(error._tag, "Stale");
      })
    );

    it.effect(
      "refuses an operation that does not fit, and a result that is not a document",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const before = yield* client["documents.get"]({ doc: HOME });
          const missing = yield* Effect.flip(
            client["documents.apply"]({
              edits: [{ doc: HOME, ops: [{ id: "nope", op: "remove" }] }],
            })
          );
          assert.strictEqual(missing._tag, "BadRequest");
          const invalid = yield* Effect.flip(
            client["documents.apply"]({
              edits: [
                {
                  doc: HOME,
                  ops: [
                    { id: "heading", op: "update", set: { text: "Fine" } },
                    { id: "heading", op: "update", set: { width: "wide" } },
                  ],
                },
              ],
            })
          );
          assert.strictEqual(invalid._tag, "BadRequest");
          assert.include(invalid.message, "not a valid document");
          // All or nothing: the first operation did not land either.
          assert.strictEqual(
            (yield* client["documents.get"]({ doc: HOME })).hash,
            before.hash
          );
        })
    );

    it.effect("moves a node between a page and the canvas as one step", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const home = yield* client["documents.get"]({ doc: HOME });
        const row =
          home.root && "children" in home.root
            ? (home.root.children ?? []).find((c) => c.id === "row")
            : undefined;
        assert.isDefined(row);
        const moved = yield* client["documents.apply"]({
          edits: [
            { doc: HOME, ops: [{ id: "row", op: "remove" }] },
            {
              doc: "canvas:",
              ops: [
                {
                  node: { ...(row as DesignNode), x: 120.6, y: -40 },
                  op: "insert",
                  parent: null,
                },
              ],
            },
          ],
          label: "Move onto the canvas",
        });
        assert.deepStrictEqual(moved.created, ["row"]);
        const layout = yield* client["canvas.get"]({ canvas: "" });
        assert.deepStrictEqual(
          layout.nodes?.map((n) => [n.id, n.x, n.y]),
          [["row", 121, -40]]
        );
        assert.notInclude(
          childIds((yield* client["documents.get"]({ doc: HOME })).root),
          "row"
        );
        // Frames saved afterwards keep the canvas's nodes.
        yield* client["canvas.set"]({ canvas: "", frames: layout.frames });
        assert.strictEqual(
          (yield* client["canvas.get"]({ canvas: "" })).nodes?.length,
          1
        );
        // Saving the same frames changed nothing: one undo puts the node back in the page.
        yield* client["edit.undo"]();
        assert.include(
          childIds((yield* client["documents.get"]({ doc: HOME })).root),
          "row"
        );
        assert.deepStrictEqual(
          (yield* client["canvas.get"]({ canvas: "" })).nodes ?? [],
          []
        );
      })
    );

    it.effect("drops undo history when the file changed behind its back", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(repo, HOME_FILE);
        const content = yield* fs.readFileString(file);
        yield* fs.writeFileString(file, content.replace("Welcome", "External"));
        const error = yield* Effect.flip(client["edit.undo"]());
        assert.strictEqual(error._tag, "Stale");
        const state = yield* client["edit.state"]();
        assert.isFalse(state.canUndo);
        assert.include(state.invalidated ?? "", "changed outside the editor");
      })
    );

    it.effect("keeps documents inside the designs directory", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const notAPage = yield* Effect.flip(
          client["documents.get"]({ doc: "../package.json" })
        );
        assert.strictEqual(notAPage._tag, "BadRequest");
        const escaped = yield* Effect.flip(
          client["documents.get"]({ doc: "../../../../etc/x.page.json" })
        );
        assert.strictEqual(escaped._tag, "ForbiddenPath");
      })
    );

    it.effect("reports git status, diffs and commits design files", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const status = yield* client["git.status"]();
        assert.strictEqual(status.branch, "main");
        const changed = status.files.map((f) => f.path);
        assert.include(changed, HOME_FILE);
        assert.include(changed, "designs/log-in.page.json");
        assert.isTrue(status.files.every((f) => f.design));

        const tracked = yield* client["git.diff"]({ path: HOME_FILE });
        assert.include(tracked.diff, "External");
        const untracked = yield* client["git.diff"]({
          path: "designs/log-in.page.json",
        });
        assert.include(untracked.diff, '+  "version": 1');

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
              const fs = yield* FileSystem.FileSystem;
              const { repo } = yield* TestEnv;
              // Reading a directory is an I/O error no wire error describes: a defect.
              yield* fs.makeDirectory(path.join(repo, "designs/dir.page.json"));
              const broken = yield* Effect.exit(
                client["documents.get"]({ doc: "dir.page.json" })
              );
              yield* fs.remove(path.join(repo, "designs/dir.page.json"), {
                recursive: true,
              });
              yield* client["pages.create"]({
                canvas: "",
                name: "After defect",
              });
              return broken;
            })
          );
          assert.strictEqual(result._tag, "Failure");
          const ids =
            event._tag === "Some" ? event.value.pages.map((p) => p.id) : [];
          assert.include(ids, "after-defect.page.json");
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

    it.effect("imports the design system without an agent, and says so", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        assert.isNull((yield* client["designSystem.get"]()).designSystem);
        yield* fs.writeFileString(
          path.join(repo, "designs/theme.css"),
          '@import "tailwindcss";\n@theme { --color-brand: #ff0066; --radius-card: 12px; }\n'
        );
        const { settings } = yield* TestEnv;
        yield* client["settings.set"]({
          ...settings,
          // Relative to the directory the preview is generated into, as the setup writes them.
          hostCss: ["../theme.css"],
          libraryDirs: ["ui"],
        });
        const { event, result } = yield* nextEvent(
          client["events.designSystem"](),
          client["designSystem.detect"]()
        );
        assert.deepStrictEqual(
          result.colors.flatMap((g) => g.tokens.map((t) => [t.name, t.value])),
          [["color-brand", "#ff0066"]]
        );
        assert.deepStrictEqual(result.radius, [
          { name: "radius-card", value: "12px" },
        ]);
        // The catalogue gives every component a category.
        assert.isString(result.components?.Button?.category);
        assert.strictEqual(
          event._tag === "Some" ? event.value.designSystem?.radius.length : 0,
          1
        );
        assert.isTrue(
          yield* fs.exists(path.join(repo, "designs/design-system.json"))
        );
        // One undo takes it back.
        yield* client["edit.undo"]();
        assert.isNull((yield* client["designSystem.get"]()).designSystem);
      })
    );

    it.effect("keeps thumbnails under the key they were drawn for", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const png = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
        yield* client["thumbnails.put"]({
          dataUrl: png,
          key: "k1",
          name: "Button",
        });
        assert.deepStrictEqual(yield* client["thumbnails.get"]({ key: "k1" }), {
          Button: png,
        });
        assert.deepStrictEqual(
          yield* client["thumbnails.get"]({ key: "k2" }),
          {}
        );
        const refused = yield* Effect.flip(
          client["thumbnails.put"]({ dataUrl: "nope", key: "k1", name: "X" })
        );
        assert.strictEqual(refused._tag, "BadRequest");
      })
    );

    it.effect("offers the commands a prompt may start with", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const names = (yield* client["commands.list"]()).map((c) => c.name);
        assert.deepStrictEqual(names, [
          "init",
          "implement",
          "import-figma",
          "redraw",
          "components",
        ]);
      })
    );

    it.effect(
      "gives the implicit canvas a name of its own when a second one is created",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const canvas = yield* client["canvases.create"]({
            name: "Marketing",
          });
          assert.strictEqual(canvas.id, "marketing");
          // The pages of the root would otherwise belong to no canvas at all.
          assert.isTrue(
            yield* fs.exists(path.join(repo, "designs/canvas.json"))
          );
          const { pages, canvases } = yield* client["pages.list"]();
          assert.deepStrictEqual(canvases.map((sp) => sp.id).sort(), [
            "",
            "marketing",
          ]);
          assert.isTrue(pages.every((p) => p.canvas === ""));
        })
    );

    it.effect("saves an image into the shared assets", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const first = yield* client["assets.upload"]({
          data: Buffer.from("not really a png").toString("base64"),
          name: "Screen Shot.png",
        });
        assert.strictEqual(first.src, "assets/screen-shot.png");
        assert.isTrue(
          yield* fs.exists(path.join(repo, "designs/assets/screen-shot.png"))
        );
        const second = yield* client["assets.upload"]({
          data: Buffer.from("again").toString("base64"),
          name: "Screen Shot.png",
        });
        assert.strictEqual(second.src, "assets/screen-shot-2.png");
        const refused = yield* Effect.flip(
          client["assets.upload"]({ data: "", name: "notes.txt" })
        );
        assert.strictEqual(refused._tag, "BadRequest");
      })
    );

    it.effect("undoes a page deleted, and its frame with it", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const page = yield* client["pages.create"]({
          canvas: "",
          name: "Undo me",
          route: "/undo-me",
        });
        yield* client["pages.delete"]({ id: page.id });
        assert.notInclude(
          (yield* client["pages.list"]()).pages.map((p) => p.id),
          page.id
        );
        yield* client["edit.undo"]();
        assert.strictEqual(
          (yield* client["documents.get"]({ doc: page.id })).root?.type,
          "page"
        );
        yield* client["edit.undo"]();
        const gone = yield* Effect.flip(
          client["documents.get"]({ doc: page.id })
        );
        assert.strictEqual(gone._tag, "NotFound");
      })
    );

    it.effect(
      "lists canvases in the order given, renames one, and deletes it with its pages",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const ids = Effect.map(client["pages.list"](), (list) =>
            list.canvases.map((c) => c.id)
          );
          const created = yield* client["canvases.create"]({
            name: "Wireframes",
          });
          assert.strictEqual(created.id, "wireframes");
          assert.deepStrictEqual(yield* ids, ["", "marketing", "wireframes"]);
          yield* client["canvases.reorder"]({ order: ["wireframes"] });
          assert.deepStrictEqual(yield* ids, ["wireframes", "", "marketing"]);
          const renamed = yield* client["canvases.rename"]({
            id: "wireframes",
            name: "Lo-fi",
          });
          assert.strictEqual(renamed.name, "Lo-fi");
          // The same route is a page in two canvases.
          const page = yield* client["pages.create"]({
            canvas: "wireframes",
            name: "Home",
            route: "/home",
          });
          assert.strictEqual(page.id, "wireframes/home.page.json");
          const homes = (yield* client["pages.list"]()).pages.filter(
            (p) => p.route === "/home"
          );
          assert.deepStrictEqual(homes.map((p) => p.canvas).sort(), [
            "",
            "wireframes",
          ]);

          yield* client["canvases.delete"]({ id: "wireframes" });
          assert.notInclude(yield* ids, "wireframes");
          assert.isFalse(
            yield* fs.exists(
              path.join(repo, "designs/wireframes/home.page.json")
            )
          );
          yield* client["edit.undo"]();
          assert.deepStrictEqual(yield* ids, ["wireframes", "", "marketing"]);
          assert.strictEqual(
            (yield* client["pages.list"]()).canvases[0]?.name,
            "Lo-fi"
          );
        })
    );

    it.effect(
      "duplicates a canvas with its pages and layout, and copies pages into another",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const frame = {
            height: 600,
            preset: "custom",
            width: 800,
            x: 40,
            y: 60,
          } as const;
          const layout = yield* client["canvas.get"]({ canvas: "" });
          yield* client["canvas.set"]({
            canvas: "",
            frames: { ...layout.frames, [HOME]: frame },
          });
          const copy = yield* client["canvases.duplicate"]({
            id: "",
            name: "App v2",
          });
          assert.strictEqual(copy.id, "app-v2");
          const { canvases, pages } = yield* client["pages.list"]();
          // Placed after the canvas it was copied from.
          const order = canvases.map((c) => c.id);
          assert.strictEqual(order.indexOf("app-v2"), order.indexOf("") + 1);
          assert.deepStrictEqual(
            pages
              .filter((p) => p.canvas === "app-v2")
              .map((p) => p.path)
              .sort(),
            pages
              .filter((p) => p.canvas === "")
              .map((p) => p.path)
              .sort()
          );
          const copied = yield* client["canvas.get"]({ canvas: "app-v2" });
          assert.deepStrictEqual(copied.frames[HOME], frame);
          assert.strictEqual(copied.name, "App v2");

          const [moved] = yield* client["pages.copyTo"]({
            ids: [HOME],
            move: false,
            target: { name: "Checkout" },
          });
          assert.strictEqual(moved?.id, "checkout/home.page.json");
          assert.deepStrictEqual(
            (yield* client["canvas.get"]({ canvas: "checkout" })).frames[HOME],
            frame
          );
          const twice = yield* Effect.flip(
            client["pages.copyTo"]({
              ids: [HOME],
              move: false,
              target: { canvas: "checkout" },
            })
          );
          assert.strictEqual(twice._tag, "Conflict");

          const leaving = yield* client["pages.create"]({
            canvas: "",
            name: "Leaving",
            route: "/leaving",
          });
          yield* client["pages.copyTo"]({
            ids: [leaving.id],
            move: true,
            target: { canvas: "marketing" },
          });
          const after = (yield* client["pages.list"]()).pages;
          assert.isFalse(after.some((p) => p.id === leaving.id));
          // It serves its URL in the canvas it moved to, and none in the one it left.
          assert.deepInclude(
            after.map((p) => [p.id, p.route]),
            ["marketing/leaving.page.json", "/leaving"]
          );
          const left = yield* client["canvas.get"]({ canvas: "" });
          assert.notProperty(left.routes ?? {}, "leaving.page.json");
        })
    );

    it.effect(
      "draws a page for a variant, at the page's route and under its frame",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const variant = yield* client["pages.createVariant"]({
            id: HOME,
            variant: "Bold",
          });
          assert.strictEqual(variant.id, "home@bold.page.json");
          assert.strictEqual(variant.route, "/home");
          assert.strictEqual(variant.variant, "bold");
          const { canvases } = yield* client["pages.list"]();
          assert.deepStrictEqual(canvases.find((c) => c.id === "")?.variants, [
            "bold",
          ]);
          const layout = yield* client["canvas.get"]({ canvas: "" });
          const base = layout.frames[HOME];
          const below = layout.frames["home@bold.page.json"];
          assert.strictEqual(below?.x, base?.x);
          assert.isAbove(below?.y ?? 0, (base?.y ?? 0) + (base?.height ?? 0));

          const again = yield* Effect.flip(
            client["pages.createVariant"]({ id: HOME, variant: "bold" })
          );
          assert.strictEqual(again._tag, "Conflict");
          // A variant is named after its page: it is renamed with it, and keeps its URL.
          const refused = yield* Effect.flip(
            client["pages.rename"]({ id: variant.id, name: "Start" })
          );
          assert.strictEqual(refused._tag, "BadRequest");
          yield* client["pages.rename"]({ id: HOME, name: "Start" });
          const renamed = (yield* client["pages.list"]()).pages.find(
            (p) => p.id === "start@bold.page.json"
          );
          assert.strictEqual(renamed?.route, "/home");
          const copy = yield* client["pages.duplicate"]({
            id: renamed?.id ?? "",
          });
          assert.strictEqual(copy.id, "start-2@bold.page.json");
          assert.strictEqual(copy.variant, "bold");
          yield* client["pages.delete"]({ id: copy.id });
          yield* client["pages.rename"]({
            id: "start.page.json",
            name: "Home",
          });
          assert.strictEqual(
            (yield* client["pages.list"]()).pages.find((p) => p.id === HOME)
              ?.route,
            "/home"
          );
        })
    );

    it.effect(
      "keeps a named snapshot, shows it as it was, and restores it in one step",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const snapshot = yield* client["snapshots.create"]({
            name: "Shown to the client",
          });
          assert.strictEqual(snapshot.name, "Shown to the client");
          assert.deepStrictEqual(
            (yield* client["snapshots.list"]()).map((s) => s.id),
            [snapshot.id]
          );
          const before = yield* client["documents.get"]({ doc: HOME });
          yield* client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                ops: [
                  {
                    node: paragraph("later", "Added later"),
                    op: "insert",
                    parent: before.root?.id ?? null,
                  },
                ],
              },
            ],
          });
          const diffs = yield* client["snapshots.diff"]({ id: snapshot.id });
          assert.deepStrictEqual(
            diffs.map((d) => d.path),
            [HOME_FILE]
          );
          const view = yield* client["snapshots.view"]({ id: snapshot.id });
          const kept = view.documents.find((d) => d.doc === HOME);
          assert.notInclude(childIds(kept?.root), "later");
          assert.isTrue(view.pages.some((p) => p.id === HOME));

          yield* client["snapshots.restore"]({ id: snapshot.id });
          const restored = yield* client["documents.get"]({ doc: HOME });
          assert.notInclude(childIds(restored.root), "later");
          yield* client["edit.undo"]();
          const undone = yield* client["documents.get"]({ doc: HOME });
          assert.include(childIds(undone.root), "later");

          yield* client["snapshots.delete"]({ id: snapshot.id });
          assert.deepStrictEqual(yield* client["snapshots.list"](), []);
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
