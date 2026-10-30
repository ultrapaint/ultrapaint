import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { slashCommands } from "@ultrapaint/contracts/tasks";
import {
  Effect,
  Fiber,
  FileSystem,
  type Layer,
  type Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { nextEvent, subscribed, TestEnv } from "./testing/harness.ts";
import {
  inAProject,
  type ProjectRpc,
  type ProjectTestOptions,
} from "./testing/project.ts";
import { waitFor } from "./testing/wait-for.ts";

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

/**
 * A test of what the editor's requests do, each on a project of its own (docs/TESTING.md rules
 * 1 and 3): the RPC handlers in-process, no socket. What only the wire does stays in
 * `server.test.ts`.
 */
const editorTest =
  (options: ProjectTestOptions = {}) =>
  <A, E>(
    name: string,
    body: () => Effect.Effect<
      A,
      E,
      Layer.Success<ReturnType<typeof ProjectRpc>> | Scope.Scope
    >,
    timeout?: number
  ) =>
    it.effect(name, () => inAProject(options)(body()), timeout);
const inProject = editorTest();
const inGitProject = editorTest({ git: true });

const commentOn = (canvas: string, page: string, text: string) => ({
  canvas,
  element: null,
  nodeId: null,
  page,
  text,
  x: 10,
  y: 10,
});

const commentedPages = (comments: readonly { readonly page: string }[]) =>
  comments.map((c) => c.page).sort();

const frameAt = (x: number) =>
  ({ height: 600, preset: "custom", width: 800, x, y: 0 }) as const;

/** A page serving `/onboarding/sign-in`, as the first test here makes it. */
const signIn = Effect.flatMap(TestEnv, ({ client }) =>
  client["pages.create"]({
    canvas: "",
    name: "Sign in",
    route: "/onboarding/sign-in",
  })
);

/** An edit of Home, one undo step: its heading says `text`. */
const headingSays = (text: string) =>
  Effect.flatMap(TestEnv, ({ client }) =>
    client["documents.apply"]({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "heading", op: "update", set: { text } }],
        },
      ],
    })
  );

/** Pricing with its frame and its bold variant, and a comment on each and on Home. */
const pricingWithComments = Effect.gen(function* () {
  const { client } = yield* TestEnv;
  const page = yield* client["pages.create"]({
    canvas: "",
    name: "Pricing",
    route: "/pricing",
  });
  yield* client["canvas.set"]({
    canvas: "",
    frames: { [page.path]: frameAt(0) },
  });
  const variant = yield* client["pages.createVariant"]({
    id: page.id,
    variant: "bold",
  });
  yield* client["comments.create"](commentOn("", page.path, "Cheaper"));
  yield* client["comments.create"](commentOn("", variant.path, "Bolder"));
  yield* client["comments.create"](commentOn("", HOME, "Stays"));
  return { page, variant };
});

describe("the editor's requests on a project", () => {
  inProject(
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

  inProject(
    "sends the page list again when it changes, not when a page is edited",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* client["pages.create"]({ canvas: "", name: "Listed once" });
        const seen: string[] = [];
        yield* subscribed(
          Stream.runForEach(client["events.file.changed"](), (changed) =>
            Effect.sync(() => {
              if (changed.file === HOME_FILE) {
                seen.push(changed.hash);
              }
            })
          )
        );
        const { event } = yield* nextEvent(
          client["events.pages"](),
          Effect.gen(function* () {
            for (const text of ["One", "Two", "Three"]) {
              yield* client["documents.apply"]({
                edits: [
                  {
                    doc: HOME,
                    ops: [{ id: "heading", op: "update", set: { text } }],
                  },
                ],
              });
            }
            // The watcher has seen the edits' writes, which change no list.
            const { hash } = yield* client["documents.get"]({ doc: HOME });
            yield* waitFor(
              Effect.sync(() => seen.includes(hash)),
              Boolean
            );
            yield* client["pages.create"]({
              canvas: "",
              name: "Listed twice",
            });
          })
        );
        const ids =
          event._tag === "Some" ? event.value.pages.map((p) => p.id) : [];
        assert.include(ids, "listed-twice.page.json");
        for (const id of ["listed-once.page.json", "listed-twice.page.json"]) {
          yield* client["pages.delete"]({ id });
        }
      })
  );

  inProject("starts a page from a template, titled after its name", () =>
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

  inProject("refuses a second page on the same URL", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* signIn;
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

  inProject(
    "gives a page a URL, changes it and takes it off",
    () =>
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
      }),
    30_000
  );

  inProject("renames a page: its frame goes along, its URL stays", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* signIn;
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

  // Signed with the fixture's git user.
  inGitProject("keeps comments beside the canvas, resolved or not", () =>
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

  inProject(
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

  inProject("applies operations, then undoes and redoes them", () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const original = yield* client["documents.get"]({ doc: HOME });
      const { event, result: applied } = yield* nextEvent(
        client["events.document"]().pipe(Stream.filter((e) => e.doc === HOME)),
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
      const state = yield* client["documents.get"]({ doc: HOME });
      assert.deepStrictEqual(childIds(state.root), ["heading", "row"]);
      assert.strictEqual(applied.changes[0]?.hash, state.hash);
      assert.strictEqual(
        event._tag === "Some" ? event.value.hash : "",
        state.hash
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
        state.hash
      );
    })
  );

  inProject("refuses operations made against an outdated hash", () =>
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

  inProject(
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

  inProject("moves a node between a page and the canvas as one step", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["documents.apply"]({
        edits: [
          {
            doc: HOME,
            ops: [
              {
                node: {
                  children: [paragraph("left", "Left")],
                  id: "row",
                  type: "row",
                },
                op: "insert",
                parent: "root",
              },
            ],
          },
        ],
      });
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

  inProject("drops undo history when the file changed behind its back", () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      yield* headingSays("Welcome");
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

  inProject("keeps documents inside the designs directory", () =>
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

  inGitProject("reports git status and diffs, and commits nothing", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* headingSays("External");
      yield* client["pages.create"]({ canvas: "", name: "Log in" });
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

      // Reading needs nothing; committing waits until writing to git is on.
      const refused = yield* Effect.flip(
        client["git.commit"]({ message: "designs", paths: changed })
      );
      assert.strictEqual(refused._tag, "BadRequest");
    })
  );

  inProject(
    "imports the design system without an agent, and says so",
    () =>
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
        const told = yield* subscribed(
          Stream.runHead(client["events.designSystem"]())
        );
        const result = yield* client["designSystem.detect"]();
        // The editor is told once the changes have settled.
        yield* TestClock.adjust("100 millis");
        const event = yield* Fiber.join(told);
        assert.deepStrictEqual(
          result.colors.flatMap((g) => g.tokens.map((t) => [t.name, t.value])),
          [["color-brand", "#ff0066"]]
        );
        assert.deepStrictEqual(result.radius, [
          { name: "radius-card", value: "12px" },
        ]);
        // The components are not the design system's to describe (ADR 0042).
        assert.notProperty(result, "components");
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
      }),
    30_000
  );

  inProject("keeps thumbnails under the key they were drawn for", () =>
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

  inProject(
    "offers the commands a prompt may start with, as contracts declares them",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const offered = yield* client["commands.list"]();
        assert.deepStrictEqual(offered, slashCommands);
        assert.deepStrictEqual(
          offered.map((c) => c.name),
          [
            "init",
            "implement",
            "import-figma",
            "redraw",
            "components",
            "design-system",
            "sync",
          ]
        );
      })
  );

  inProject(
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
        assert.isTrue(yield* fs.exists(path.join(repo, "designs/canvas.json")));
        const { pages, canvases } = yield* client["pages.list"]();
        assert.deepStrictEqual(canvases.map((sp) => sp.id).sort(), [
          "",
          "marketing",
        ]);
        assert.isTrue(pages.every((p) => p.canvas === ""));
      })
  );

  inProject("saves an image into the shared assets", () =>
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
      // A directory that takes no file is a failure the editor can show, not a crash.
      if (process.getuid?.() !== 0) {
        const assets = path.join(repo, "designs/assets");
        yield* fs.chmod(assets, 0o555);
        const unsaved = yield* Effect.flip(
          client["assets.upload"]({
            data: Buffer.from("png").toString("base64"),
            name: "Blocked.png",
          })
        ).pipe(Effect.ensuring(Effect.ignore(fs.chmod(assets, 0o755))));
        assert.strictEqual(unsaved._tag, "Conflict");
      }
    })
  );

  inProject("undoes a page deleted, and its frame with it", () =>
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

  inProject(
    "lists canvases in the order given, renames one, and deletes it with its pages",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const ids = Effect.map(client["pages.list"](), (list) =>
          list.canvases.map((c) => c.id)
        );
        yield* client["canvases.create"]({ name: "Marketing" });
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
          yield* fs.exists(path.join(repo, "designs/wireframes/home.page.json"))
        );
        yield* client["edit.undo"]();
        assert.deepStrictEqual(yield* ids, ["wireframes", "", "marketing"]);
        assert.strictEqual(
          (yield* client["pages.list"]()).canvases[0]?.name,
          "Lo-fi"
        );
      })
  );

  inProject(
    "duplicates a canvas with its pages and layout, and copies pages into another",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* client["canvases.create"]({ name: "Marketing" });
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

  inProject(
    "draws a page for a variant, at the page's route and under its frame",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* client["canvas.set"]({
          canvas: "",
          frames: { [HOME]: frameAt(0) },
        });
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

  inProject(
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

  inProject(
    "keeps links leading to a page when it is renamed or its URL changes",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const canvas = yield* client["canvases.create"]({ name: "Links" });
        const target = yield* client["pages.create"]({
          canvas: canvas.id,
          name: "Target",
          route: "/target",
        });
        const source = yield* client["pages.create"]({
          canvas: canvas.id,
          name: "Source",
        });
        const before = yield* client["documents.get"]({ doc: source.id });
        const link = (id: string, to: string): DesignNode => ({
          ...paragraph(id, id),
          link: to,
        });
        yield* client["documents.apply"]({
          edits: [
            {
              doc: source.id,
              ops: [
                {
                  node: link("byUrl", "/target"),
                  op: "insert",
                  parent: before.root?.id ?? null,
                },
                {
                  node: link("byFile", "target.page.json"),
                  op: "insert",
                  parent: before.root?.id ?? null,
                },
              ],
            },
          ],
        });
        const linksOf = Effect.map(
          client["documents.get"]({ doc: source.id }),
          (state) =>
            Object.fromEntries(
              (state.root && "children" in state.root
                ? (state.root.children ?? [])
                : []
              ).map((c) => [c.id, c.link])
            )
        );
        yield* client["pages.setRoute"]({ id: target.id, route: "/moved" });
        assert.deepInclude(yield* linksOf, {
          byFile: "target.page.json",
          byUrl: "target.page.json",
        });
        yield* client["pages.rename"]({ id: target.id, name: "Goal" });
        assert.deepInclude(yield* linksOf, {
          byFile: "goal.page.json",
          byUrl: "goal.page.json",
        });
        yield* client["canvases.delete"]({ id: canvas.id });
      })
  );

  inProject(
    "deletes a base page with its variants and their comments, and undo brings all of it back",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const page = yield* client["pages.create"]({
          canvas: "",
          name: "Pricing",
          route: "/pricing",
        });
        yield* client["canvas.set"]({
          canvas: "",
          frames: { [page.path]: frameAt(0) },
        });
        const variant = yield* client["pages.createVariant"]({
          id: page.id,
          variant: "bold",
        });
        yield* client["comments.create"](commentOn("", page.path, "Cheaper"));
        yield* client["comments.create"](commentOn("", variant.path, "Bolder"));
        yield* client["comments.create"](commentOn("", HOME, "Stays"));

        yield* client["pages.delete"]({ id: page.id });
        const ids = (yield* client["pages.list"]()).pages.map((p) => p.id);
        assert.notInclude(ids, page.id);
        assert.notInclude(ids, variant.id);
        const layout = yield* client["canvas.get"]({ canvas: "" });
        assert.notProperty(layout.frames, page.path);
        assert.notProperty(layout.frames, variant.path);
        assert.deepStrictEqual(
          commentedPages(
            (yield* client["comments.list"]({ canvas: "" })).comments
          ),
          [HOME]
        );
        assert.strictEqual(
          (yield* client["edit.state"]()).undoLabel,
          "Delete Pricing and its variants"
        );

        yield* client["edit.undo"]();
        const back = (yield* client["pages.list"]()).pages.map((p) => p.id);
        assert.include(back, page.id);
        assert.include(back, variant.id);
        assert.deepStrictEqual(
          commentedPages(
            (yield* client["comments.list"]({ canvas: "" })).comments
          ),
          [HOME, page.path, variant.path].sort()
        );
      })
  );

  inProject("renames a page's comments, and its variant's, with it", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* pricingWithComments;
      const renamed = yield* client["pages.rename"]({
        id: "pricing.page.json",
        name: "Plans",
      });
      assert.strictEqual(renamed.path, "plans.page.json");
      assert.deepStrictEqual(
        commentedPages(
          (yield* client["comments.list"]({ canvas: "" })).comments
        ),
        [HOME, "plans.page.json", "plans@bold.page.json"]
      );
      yield* client["edit.undo"]();
      assert.deepStrictEqual(
        commentedPages(
          (yield* client["comments.list"]({ canvas: "" })).comments
        ),
        [HOME, "pricing.page.json", "pricing@bold.page.json"]
      );
    })
  );

  inProject(
    "copies a page with its variants and no comments, and moves one with both",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* pricingWithComments;
        const copied = yield* client["pages.copyTo"]({
          ids: ["pricing.page.json"],
          move: false,
          target: { name: "Wireframes" },
        });
        assert.deepStrictEqual(copied.map((p) => p.id).sort(), [
          "wireframes/pricing.page.json",
          "wireframes/pricing@bold.page.json",
        ]);
        assert.deepStrictEqual(
          (yield* client["comments.list"]({ canvas: "wireframes" })).comments,
          []
        );
        assert.strictEqual(
          (yield* client["comments.list"]({ canvas: "" })).comments.length,
          3
        );

        const moved = yield* client["pages.copyTo"]({
          ids: ["pricing.page.json"],
          move: true,
          target: { name: "Final" },
        });
        assert.deepStrictEqual(moved.map((p) => p.id).sort(), [
          "final/pricing.page.json",
          "final/pricing@bold.page.json",
        ]);
        assert.strictEqual(
          moved.find((p) => p.variant === undefined)?.route,
          "/pricing"
        );
        assert.deepStrictEqual(
          commentedPages(
            (yield* client["comments.list"]({ canvas: "" })).comments
          ),
          [HOME]
        );
        assert.deepStrictEqual(
          commentedPages(
            (yield* client["comments.list"]({ canvas: "final" })).comments
          ),
          ["pricing.page.json", "pricing@bold.page.json"]
        );
        assert.deepStrictEqual(
          (yield* client["canvas.get"]({ canvas: "final" })).variants,
          ["bold"]
        );
        // One step: undo puts the pages and the comments back where they were.
        yield* client["edit.undo"]();
        assert.strictEqual(
          (yield* client["comments.list"]({ canvas: "" })).comments.length,
          3
        );
        assert.include(
          (yield* client["pages.list"]()).pages.map((p) => p.id),
          "pricing@bold.page.json"
        );
      })
  );

  inProject(
    "refuses a new canvas without a name, and a template that is not there",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const unnamed = yield* Effect.flip(
          client["pages.copyTo"]({
            ids: [HOME],
            move: false,
            target: { name: "  " },
          })
        );
        assert.strictEqual(unnamed._tag, "BadRequest");
        const template = yield* Effect.flip(
          client["pages.create"]({
            canvas: "",
            name: "Fancy",
            template: "fancy",
          })
        );
        assert.strictEqual(template._tag, "BadRequest");
        assert.include(template.message, "blank, centered, page");
        // The template with a header links nowhere: a canvas need not serve `/`.
        const headed = yield* client["pages.create"]({
          canvas: "",
          name: "Headed",
          template: "page",
        });
        const state = yield* client["documents.get"]({ doc: headed.id });
        assert.notInclude(JSON.stringify(state.root), '"link"');
        yield* client["pages.delete"]({ id: headed.id });
      })
  );

  inProject(
    "saves the editor's frames over the saved ones, and drops the frames of pages that are gone",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const draft = yield* client["pages.create"]({
          canvas: "",
          name: "Draft",
        });
        yield* client["canvas.set"]({
          canvas: "",
          frames: { [draft.path]: frameAt(900) },
        });
        // A frame the editor does not mention stays where it is.
        yield* client["canvas.set"]({
          canvas: "",
          frames: { [HOME]: frameAt(0) },
        });
        const both = yield* client["canvas.get"]({ canvas: "" });
        assert.deepStrictEqual(both.frames[draft.path], frameAt(900));
        assert.deepStrictEqual(both.frames[HOME], frameAt(0));
        // An editor that has not heard of the rename yet does not bring the old name back.
        const renamed = yield* client["pages.rename"]({
          id: draft.id,
          name: "Sketch",
        });
        yield* client["canvas.set"]({
          canvas: "",
          frames: { [draft.path]: frameAt(1800), [HOME]: frameAt(0) },
        });
        const after = yield* client["canvas.get"]({ canvas: "" });
        assert.notProperty(after.frames, draft.path);
        assert.deepStrictEqual(after.frames[renamed.path], frameAt(900));
      })
  );

  inProject("keeps an edit made while the page is renamed", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      // Each round sends an edit just after a rename: whichever lands first, an edit that was
      // accepted is in the page that is left. The window it guards is narrow, so this is a
      // check of the outcome more than a reproduction of the race.
      for (const round of [1, 2, 3, 4, 5]) {
        const page = yield* client["pages.create"]({
          canvas: "",
          name: `Race ${round}`,
        });
        const id = `raced-${round}`;
        const [renamed, edited] = yield* Effect.all(
          [
            client["pages.rename"]({
              id: page.id,
              name: `Renamed ${round}`,
            }),
            Effect.exit(
              client["documents.apply"]({
                edits: [
                  {
                    doc: page.id,
                    ops: [
                      {
                        node: paragraph(id, "Raced"),
                        op: "insert",
                        parent: "root",
                      },
                    ],
                  },
                ],
              }).pipe(
                // Each round lets the rename run a little further first.
                (apply) =>
                  Effect.andThen(
                    Effect.forEach(
                      Array.from({ length: round }),
                      () => Effect.yieldNow
                    ),
                    apply
                  )
              )
            ),
          ],
          { concurrency: "unbounded" }
        );
        if (edited._tag === "Success") {
          assert.include(
            childIds(
              (yield* client["documents.get"]({ doc: renamed.id })).root
            ),
            id
          );
        }
      }
    })
  );

  inProject("deletes a canvas with its own assets and its directory", () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      yield* client["canvases.create"]({ name: "Wireframes" });
      const dir = path.join(repo, "designs/wireframes");
      const shared = path.join(repo, "designs/assets/logo.svg");
      yield* fs.makeDirectory(path.join(dir, "assets"), { recursive: true });
      yield* fs.writeFileString(path.join(dir, "assets/logo.svg"), "<svg/>");
      yield* fs.makeDirectory(path.dirname(shared), { recursive: true });
      yield* fs.writeFileString(shared, "<svg/>");
      yield* client["canvases.delete"]({ id: "wireframes" });
      assert.isFalse(yield* fs.exists(dir));
      // The shared assets are every canvas's, and stay.
      assert.isTrue(yield* fs.exists(shared));
      assert.notInclude(
        (yield* client["pages.list"]()).canvases.map((c) => c.id),
        "wireframes"
      );
    })
  );
});
