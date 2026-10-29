import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { callMcp, initializeLegacy } from "./testing/mcp.ts";
import { waitFor } from "./testing/wait-for.ts";

const HOME = "home.page.json";

const statusOf = (items: readonly ImplementationItem[], target: string) =>
  items.find((i) => i.target === target);

/** The text of a tool's answer, as an agent reads it. */
const toolText = (response: Response) =>
  Effect.promise(
    () =>
      response.json() as Promise<{
        result?: {
          content?: { text: string }[];
          isError?: boolean;
          structuredContent?: { text?: string };
        };
      }>
  ).pipe(
    Effect.map(
      (json) =>
        json.result?.structuredContent?.text ??
        json.result?.content?.map((c) => c.text).join("\n") ??
        ""
    )
  );

layer(TestServer, { excludeTestServices: true, timeout: "120 seconds" })(
  "the design as the source, and its link to the code (ADR 0028–0030)",
  (it) => {
    it.effect(
      "links a page to the files that implement it, and says what changed on either side",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const list = () =>
            Effect.map(client["implementation.list"](), (l) => l.items);

          assert.strictEqual(statusOf(yield* list(), HOME)?.status, "draft");
          const ready = yield* client["implementation.setReady"]({
            ready: true,
            target: HOME,
          });
          assert.strictEqual(ready.status, "ready");

          yield* fs.makeDirectory(path.join(repo, "src"), { recursive: true });
          yield* fs.writeFileString(
            path.join(repo, "src/home.tsx"),
            "export const Home = () => null;\n"
          );
          const refused = yield* Effect.flip(
            client["implementation.mark"]({
              files: ["src/nowhere.tsx"],
              target: HOME,
            })
          );
          assert.include(refused.message, "src/nowhere.tsx");
          const marked = yield* client["implementation.mark"]({
            files: ["src/home.tsx"],
            target: HOME,
          });
          assert.strictEqual(marked.status, "implemented");
          assert.deepStrictEqual(marked.files, ["src/home.tsx"]);
          assert.isFalse(marked.ready);
          // The link and the design as it was are files of the designs, committed with them.
          assert.isTrue(
            yield* fs.exists(path.join(repo, "designs/implementation.json"))
          );
          assert.isTrue(
            yield* fs.exists(
              path.join(repo, "designs/_implemented/home.implemented.json")
            )
          );
          assert.isTrue(
            (yield* client["implementation.changes"]({ target: HOME })).empty
          );

          // The design changes: the heading's text, and a behaviour note.
          const { hash } = yield* client["documents.get"]({ doc: HOME });
          yield* client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                expectedHash: hash,
                ops: [{ id: "heading", op: "update", set: { text: "World" } }],
              },
            ],
          });
          yield* client["comments.create"]({
            canvas: "",
            element: "World",
            kind: "behaviour",
            nodeId: "heading",
            page: HOME,
            text: "Only signed-in users see the greeting",
            x: 0,
            y: 0,
          });
          yield* client["comments.create"]({
            canvas: "",
            element: "World",
            nodeId: "heading",
            page: HOME,
            text: "Nice",
            x: 0,
            y: 0,
          });
          const changed = statusOf(yield* list(), HOME);
          assert.strictEqual(changed?.status, "changed");
          assert.isTrue(changed?.designChanged);
          assert.isFalse(changed?.codeChanged);
          const changes = yield* client["implementation.changes"]({
            target: HOME,
          });
          assert.isFalse(changes.empty);
          assert.include(changes.text, '"Hello" → "World"');
          assert.include(
            changes.text,
            "new behaviour note on World (heading): Only signed-in users see the greeting"
          );
          // A plain comment is not part of the design, and its file does not say it is plain.
          assert.notInclude(changes.text, "Nice");
          const comments = yield* fs.readFileString(
            path.join(repo, "designs/comments.json")
          );
          assert.strictEqual(comments.match(/"kind"/g)?.length, 1);

          // Someone changes the code.
          yield* fs.writeFileString(
            path.join(repo, "src/home.tsx"),
            "export const Home = () => 'hi';\n"
          );
          const both = statusOf(yield* list(), HOME);
          assert.isTrue(both?.codeChanged);
          assert.deepStrictEqual(both?.changedFiles, ["src/home.tsx"]);

          yield* client["implementation.mark"]({
            files: ["src/home.tsx"],
            target: HOME,
          });
          assert.strictEqual(
            statusOf(yield* list(), HOME)?.status,
            "implemented"
          );

          yield* client["implementation.unbind"]({ target: HOME });
          assert.strictEqual(statusOf(yield* list(), HOME)?.status, "draft");
        }),
      60_000
    );

    it.effect(
      "draws a page in a state, which serves no URL and goes with its page",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const empty = yield* client["pages.createState"]({
            id: HOME,
            state: "Empty",
          });
          assert.strictEqual(empty.state, "empty");
          assert.isUndefined(empty.variant);
          assert.isUndefined(empty.route);
          assert.strictEqual(empty.id, "home@empty.page.json");
          const layout = yield* client["canvas.get"]({ canvas: "" });
          assert.deepStrictEqual(layout.states, ["empty"]);
          const listed = yield* client["pages.list"]();
          assert.deepStrictEqual(listed.canvases[0]?.states, ["empty"]);
          // A name the canvas uses for a variant is not a state's.
          yield* client["pages.createVariant"]({ id: HOME, variant: "bold" });
          const clash = yield* Effect.flip(
            client["pages.createState"]({ id: HOME, state: "bold" })
          );
          assert.include(clash.message, "variant");

          // Deleting the state leaves the page; deleting the page takes the state along.
          yield* client["pages.delete"]({ id: empty.id });
          const after = (yield* client["pages.list"]()).pages.map((p) => p.id);
          assert.include(after, HOME);
          assert.notInclude(after, empty.id);
          yield* client["edit.undo"]();
          assert.isTrue(
            yield* fs.exists(path.join(repo, "designs/home@empty.page.json"))
          );
        }),
      60_000
    );

    it.effect(
      "answers agents outside the editor through handoff, and tells them how when they connect",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { token } = yield* client["mcp.connection"]();
          const handoff = (args: Record<string, unknown>) =>
            Effect.flatMap(
              callMcp(port, token, {
                method: "tools/call",
                params: { arguments: args, name: "handoff" },
              }),
              toolText
            );
          const started = yield* initializeLegacy(port, token, "2025-06-18");
          assert.include(
            JSON.stringify(started),
            'call handoff with action \\"list\\"'
          );

          yield* client["implementation.setReady"]({
            ready: true,
            target: HOME,
          });
          assert.include(
            yield* handoff({ action: "list" }),
            `- ${HOME} (Home): ready`
          );
          const task = yield* handoff({ action: "read", target: "/home" });
          assert.include(task, '<ultrapaint-task command="implement">');
          assert.include(task, "Only signed-in users see the greeting");
          assert.include(task, "home@empty.page.json");
          assert.include(task, 'call handoff with action "mark"');

          assert.include(
            yield* handoff({
              action: "mark",
              files: ["src/home.tsx"],
              target: HOME,
            }),
            "implemented"
          );
          assert.include(
            yield* handoff({
              action: "note",
              node: "heading",
              target: HOME,
              text: "Greets by first name",
            }),
            "Noted"
          );
          const notes = (yield* client["comments.list"]({
            canvas: "",
          })).comments
            .filter((c) => c.kind === "behaviour")
            .map((c) => c.text);
          assert.include(notes, "Greets by first name");
          // The note is part of the design: it changed since it was implemented.
          const item = yield* client["implementation.setReady"]({
            ready: false,
            target: HOME,
          });
          assert.isTrue(item.designChanged);
        }),
      60_000
    );

    it.effect(
      "starts a system component's file from its default look, and makes an app component of nodes",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          // A system component (ADR 0040): nothing of the repository's is read, its parts are the
          // catalogue's, and its look starts as the system component's default.
          const read = yield* client["components.fromDefault"]({
            name: "Button",
          });
          const file = read.component;
          assert.strictEqual(read.file, "components/Button.component.json");
          assert.strictEqual(file?.origin, "system");
          if (file?.origin !== "system") {
            return;
          }
          assert.strictEqual(file.base.root?.fill, "$color-primary");

          // The design changes the look.
          yield* client["components.write"]({
            component: { ...file, base: { root: { fill: "#ff0000" } } },
          });
          const listed = yield* client["components.list"]();
          assert.strictEqual(listed.components[0]?.component?.origin, "system");
          const bound = yield* client["implementation.list"]();
          assert.strictEqual(
            statusOf(bound.items, "component:Button")?.kind,
            "component"
          );
          const refused = yield* Effect.flip(
            client["components.write"]({
              component: { ...file, name: "not-a-name" },
            })
          );
          assert.include(refused.message, "PascalCase");
          // An app component takes no system component's name, and cannot place itself.
          const clash = yield* Effect.flip(
            client["components.write"]({
              component: {
                name: "Card",
                origin: "app",
                properties: [],
                slots: [],
                tree: { children: [], id: "r", type: "row" },
                version: 1,
              },
            })
          );
          assert.include(clash.message, "a system component's name");
          const itself = yield* Effect.flip(
            client["components.write"]({
              component: {
                name: "Loop",
                origin: "app",
                properties: [],
                slots: [],
                tree: {
                  children: [
                    {
                      component: "Loop",
                      from: "#app",
                      id: "again",
                      type: "instance",
                    },
                  ],
                  id: "r",
                  type: "row",
                },
                version: 1,
              },
            })
          );
          assert.include(itself.message, "Loop places Loop");
          // A system component's look leaves out only an optional part, and templates only items.
          const fixedPart = yield* Effect.flip(
            client["components.write"]({
              component: { ...file, hidden: ["root"] },
            })
          );
          assert.include(fixedPart.message, "Button cannot leave out root");
          const noItems = yield* Effect.flip(
            client["components.write"]({
              component: {
                ...file,
                item: { tree: { children: [], id: "i", type: "row" } },
              },
            })
          );
          assert.include(noItems.message, "has no items to draw");

          // A node becomes an app component: its tree in the file, an instance in its place.
          const made = yield* client["components.makeApp"]({
            id: HOME,
            name: "Hero title",
            nodeIds: ["heading"],
          });
          assert.strictEqual(made.component?.name, "HeroTitle");
          assert.strictEqual(
            made.component?.origin === "app" && made.component.tree.type,
            "text"
          );
          const page = yield* client["documents.get"]({ doc: HOME });
          const [heading] = (
            page.root as unknown as {
              children: {
                component?: string;
                from?: string;
                id: string;
                type: string;
              }[];
            }
          ).children;
          assert.deepInclude(heading, {
            component: "HeroTitle",
            from: "#app",
            id: "heading",
            type: "instance",
          });
          // One step back takes both back: the page's node and the file.
          yield* client["edit.undo"]();
          assert.isFalse(
            yield* fs.exists(
              path.join(repo, "designs/components/HeroTitle.component.json")
            )
          );

          yield* client["components.remove"]({ name: "Button" });
          assert.isFalse(
            yield* fs.exists(
              path.join(repo, "designs/components/Button.component.json")
            )
          );
        }),
      90_000
    );

    it.effect(
      "changes an app component on its file as it is now, its variants and instances following, in one undo step",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["components.write"]({
            component: {
              name: "Plan",
              origin: "app",
              properties: [
                {
                  default: "plain",
                  kind: "choice",
                  members: ["plain", "loud"],
                  name: "tone",
                },
              ],
              slots: [],
              tree: {
                children: [
                  {
                    at: { "tone=loud": { color: "#ff0000" } },
                    id: "t",
                    role: "heading",
                    text: "Pro",
                    type: "text",
                  },
                ],
                id: "root",
                type: "column",
              },
              version: 1,
            },
          });
          yield* client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                ops: [
                  {
                    node: {
                      component: "Plan",
                      from: "#app",
                      id: "plan",
                      props: { tone: "loud" },
                      type: "instance",
                    },
                    op: "insert",
                    parent: null,
                  },
                ],
              },
            ],
          });
          // The tree edited in place; the inspector's change comes after, from its older copy.
          yield* client["documents.apply"]({
            edits: [
              {
                doc: "component:Plan",
                ops: [{ id: "t", op: "update", set: { text: "Max" } }],
              },
            ],
          });
          yield* client["components.change"]({
            change: { name: "tone", op: "renameProperty", to: "mood" },
            name: "Plan",
          });
          const read = () =>
            Effect.map(
              fs.readFileString(
                path.join(repo, "designs/components/Plan.component.json")
              ),
              (text) =>
                JSON.parse(text) as {
                  properties: { name: string }[];
                  tree: { children: { at?: object; text: string }[] };
                }
            );
          const plan = () =>
            Effect.map(client["documents.get"]({ doc: HOME }), (page) =>
              (
                page.root as unknown as {
                  children: { id: string; props?: object }[];
                }
              ).children.find((c) => c.id === "plan")
            );
          const file = yield* read();
          assert.deepStrictEqual(
            file.properties.map((p) => p.name),
            ["mood"]
          );
          assert.strictEqual(file.tree.children[0]?.text, "Max");
          assert.deepStrictEqual(file.tree.children[0]?.at, {
            "mood=loud": { color: "#ff0000" },
          });
          assert.deepStrictEqual((yield* plan())?.props, { mood: "loud" });
          const refused = yield* Effect.flip(
            client["components.change"]({
              change: {
                op: "addProperty",
                property: { default: "", kind: "text", name: "mood" },
              },
              name: "Plan",
            })
          );
          assert.include(refused.message, "two properties are named mood");

          // One step back takes the file and the instance back together.
          yield* client["edit.undo"]();
          assert.deepStrictEqual((yield* plan())?.props, { tone: "loud" });
          const before = yield* read();
          assert.deepStrictEqual(
            before.properties.map((p) => p.name),
            ["tone"]
          );
          assert.strictEqual(before.tree.children[0]?.text, "Max");
        }),
      60_000
    );

    it.effect(
      "lets a design thread write its designs only, and an implement thread the repository",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const run = (thread: Thread, text: string) =>
            Effect.gen(function* () {
              yield* client["threads.prompt"]({
                attachments: [],
                text,
                threadId: thread.id,
              });
              const items = yield* waitFor(
                client["threads.items"]({ threadId: thread.id }),
                (all: readonly ThreadItem[]) =>
                  all.some((i) => i.kind === "turn_end")
              );
              return items.flatMap((i) => (i.kind === "agent" ? [i.text] : []));
            });

          const designing = yield* client["threads.create"]({
            agentId: "fake",
          });
          assert.isUndefined(designing.purpose);
          const refused = yield* run(designing, "write src/agent.tsx");
          assert.include(refused.join(""), "outside the designs directory");
          assert.isFalse(yield* fs.exists(path.join(repo, "src/agent.tsx")));

          const implementing = yield* client["threads.create"]({
            agentId: "fake",
            purpose: "implement",
          });
          assert.strictEqual(implementing.purpose, "implement");
          const written = yield* run(implementing, "write src/agent.tsx");
          assert.include(written.join(""), "written");
          assert.isTrue(yield* fs.exists(path.join(repo, "src/agent.tsx")));
        }),
      60_000
    );

    it.effect(
      "moves a page's link to the code with the page, and takes it away with it",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const cart = yield* client["pages.create"]({
            canvas: "",
            name: "Cart",
          });
          yield* client["implementation.mark"]({
            files: ["src/home.tsx"],
            target: cart.id,
          });
          const renamed = yield* client["pages.rename"]({
            id: cart.id,
            name: "Basket",
          });
          const { items } = yield* client["implementation.list"]();
          assert.strictEqual(
            statusOf(items, renamed.id)?.status,
            "implemented"
          );
          assert.isUndefined(statusOf(items, cart.id));
          assert.isTrue(
            yield* fs.exists(
              path.join(repo, "designs/_implemented/basket.implemented.json")
            )
          );
          yield* client["pages.delete"]({ id: renamed.id });
          const linked = JSON.parse(
            yield* fs.readFileString(
              path.join(repo, "designs/implementation.json")
            )
          );
          assert.notProperty(linked.items, renamed.id);
          yield* client["edit.undo"]();
          assert.strictEqual(
            statusOf((yield* client["implementation.list"]()).items, renamed.id)
              ?.status,
            "implemented"
          );
        }),
      60_000
    );
  }
);
