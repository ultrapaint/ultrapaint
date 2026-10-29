import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import { SYSTEM_FROM } from "@ultrapaint/contracts/spec-names";
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
      "starts a system component's spec from its default look, and makes a draft of a node",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          // A system component (ADR 0040): nothing of the repository's is read, its parts are the
          // catalogue's, and its look starts as the system component's default.
          const read = yield* client["specs.fromCode"]({ component: "Button" });
          const { spec } = read;
          assert.strictEqual(read.file, "specs/Button.spec.json");
          assert.strictEqual(spec?.look, "design");
          assert.strictEqual(spec?.from, SYSTEM_FROM);
          assert.deepStrictEqual(
            spec?.slots.map((s) => s.name),
            ["root", "button-spinner"]
          );
          assert.strictEqual(spec?.base.root?.fill, "$color-primary");

          // The design changes the look.
          if (!spec) {
            return;
          }
          yield* client["specs.write"]({
            spec: {
              ...spec,
              base: { root: { fill: "#ff0000" } },
              look: "design",
            },
          });
          const listed = yield* client["specs.list"]();
          assert.strictEqual(listed.specs[0]?.spec?.look, "design");
          const bound = yield* client["implementation.list"]();
          assert.strictEqual(
            statusOf(bound.items, "spec:Button")?.kind,
            "spec"
          );
          const refusedSpec = yield* Effect.flip(
            client["specs.write"]({
              spec: { ...spec, component: "not-a-name" },
            })
          );
          assert.include(refusedSpec.message, "PascalCase");

          // A node becomes a draft component: its tree in the spec, an instance in its place.
          const draft = yield* client["specs.draftFrom"]({
            id: HOME,
            name: "Hero title",
            nodeId: "heading",
          });
          assert.strictEqual(draft.spec?.component, "HeroTitle");
          assert.strictEqual(draft.spec?.from, "#draft");
          assert.strictEqual(draft.spec?.draft?.type, "text");
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
            from: "#draft",
            id: "heading",
            type: "instance",
          });

          yield* client["specs.remove"]({ component: "Button" });
          assert.isFalse(
            yield* fs.exists(path.join(repo, "designs/specs/Button.spec.json"))
          );
        }),
      90_000
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
