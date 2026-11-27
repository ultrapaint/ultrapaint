/**
 * An app component's tree read and changed through the editor's tools, and one made of a page's
 * nodes (UP-230): `component:<Name>` where a page goes, `makeComponent` among the operations.
 * Each call is an agent's from outside the editor (ADR 0083), which every agent's call is too.
 */
import { assert, it } from "@effect/vitest";
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf, findNode } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem, type Layer, type Scope, Stream } from "effect";
import { componentText } from "./services/component-files.ts";
import { EditorTools } from "./services/mcp/route.ts";
import { nextEvent, TestEnv } from "./testing/harness.ts";
import { callTool, inAProject, type ProjectRpc } from "./testing/project.ts";

const PROMO_FILE = "designs/components/Promo.component.json";

/** Promo: a heading its title property sets, and a row its extra slot is. */
const PROMO: ComponentFile = {
  name: "Promo",
  origin: "app",
  properties: [
    { default: "Sale", kind: "text", name: "title", targets: [{ node: "t" }] },
  ],
  slots: [{ name: "extra", node: "x" }],
  tree: {
    children: [
      { id: "t", level: 2, role: "heading", text: "Sale", type: "text" },
      { children: [], id: "x", type: "row" },
    ],
    id: "r",
    type: "column",
  },
  version: 1,
};

/** The home page, placing Promo. */
const HOME_WITH_PROMO = `${JSON.stringify({
  root: {
    children: [
      { component: "Promo", from: "#app", id: "promo", type: "instance" },
    ],
    id: "root",
    padding: 16,
    type: "page",
  },
  version: 1,
})}\n`;

/** A test on a project of its own, Promo on its home page when `promo` says so. */
const inProject =
  (promo: boolean) =>
  <A, E>(
    name: string,
    body: () => Effect.Effect<
      A,
      E,
      Layer.Success<ReturnType<typeof ProjectRpc>> | Scope.Scope
    >
  ) =>
    it.effect(name, () =>
      inAProject(
        promo
          ? {
              files: {
                "designs/home.page.json": HOME_WITH_PROMO,
                [PROMO_FILE]: componentText(PROMO),
              },
            }
          : {}
      )(body())
    );
const withPromo = inProject(true);
const onItsOwn = inProject(false);

const tool = <Name extends keyof typeof EditorTools.tools & string>(
  name: Name,
  parameters: Parameters<typeof callTool<typeof EditorTools.tools, Name>>[2]
) => callTool(EditorTools, name, parameters);

/** Why a tool refused, in the words the agent reads. */
const refusal = <Name extends keyof typeof EditorTools.tools & string>(
  name: Name,
  parameters: Parameters<typeof callTool<typeof EditorTools.tools, Name>>[2]
) => Effect.map(Effect.flip(tool(name, parameters)), (f) => f.message);

/** A whole document as read_page gives it: its root. */
const rootOf = (document: unknown) => (document as { root: DesignNode }).root;

/** The text a node of Promo's tree shows, as read_page reads it. */
const promoText = (node: string) =>
  Effect.map(
    tool("read_page", { route: `component:Promo#${node}` }),
    ({ document }) => (document as { text?: string }).text
  );

withPromo(
  "reads an app component's tree by component:<Name>, and a node of it by its reference",
  () =>
    Effect.gen(function* () {
      const whole = yield* tool("read_page", { route: "component:Promo" });
      assert.strictEqual(whole.file, PROMO_FILE);
      assert.isString(whole.hash);
      const root = rootOf(whole.document);
      assert.strictEqual(root.id, "r");
      assert.isNotNull(findNode(root, "x"));
      // A reference names the component and its node, as the route or as the node.
      const byRoute = yield* tool("read_page", {
        route: "component:Promo#t",
      });
      const byNode = yield* tool("read_page", {
        node: "component:Promo#t",
        route: "component:Promo",
      });
      assert.strictEqual((byRoute.document as { id?: string }).id, "t");
      assert.deepStrictEqual(byNode.document, byRoute.document);
    })
);

withPromo(
  "changes an app component's tree as one undo step, told at once to the editor that draws every instance",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const { hash } = yield* tool("read_page", { route: "component:Promo" });
      const { event } = yield* nextEvent(
        client["events.document"]().pipe(
          Stream.filter((e) => e.doc === "component:Promo")
        ),
        tool("apply_operations", {
          expectedHash: hash ?? "",
          label: "Retitle the promo",
          ops: [
            {
              id: "component:Promo#t",
              op: "update",
              set: { text: "Spring sale" },
            },
          ],
          route: "component:Promo",
        })
      );
      // The editor draws every instance from the document it is told of.
      const after = yield* tool("read_page", { route: "component:Promo" });
      assert.strictEqual(event._tag === "Some" && event.value.hash, after.hash);
      assert.strictEqual(yield* promoText("t"), "Spring sale");
      // The main component's text is what every instance setting none draws.
      const { components } = yield* client["components.list"]();
      const promo = components.find((e) =>
        e.file.endsWith("Promo.component.json")
      );
      assert.strictEqual(
        promo?.component?.origin === "app" &&
          promo.component.properties[0]?.default,
        "Spring sale"
      );
      const undone = yield* client["edit.undo"]();
      assert.strictEqual(undone?.label, "Retitle the promo");
      assert.strictEqual(yield* promoText("t"), "Sale");
    })
);

withPromo(
  "refuses an edit that would break the component, and writes nothing",
  () =>
    Effect.gen(function* () {
      const { repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const before = yield* fs.readFileString(`${repo}/${PROMO_FILE}`);
      const edit = (op: Record<string, unknown>) =>
        refusal("apply_operations", { ops: [op], route: "component:Promo" });
      assert.include(
        yield* edit({ id: "x", op: "remove" }),
        "the slot extra is node x, which the edit takes out: take that out with handoff's change first"
      );
      assert.include(
        yield* edit({ id: "t", op: "remove" }),
        "the property title sets node t, which the edit takes out"
      );
      assert.include(
        yield* edit({
          node: { component: "Promo", from: "#app", type: "instance" },
          op: "insert",
          parent: "r",
        }),
        "Promo places Promo: a component cannot place itself"
      );
      assert.strictEqual(
        yield* fs.readFileString(`${repo}/${PROMO_FILE}`),
        before
      );
    })
);

withPromo(
  "refuses a system component or one there is not as a tree, and a tree where a tool takes a page",
  () =>
    Effect.gen(function* () {
      const button = yield* refusal("read_page", {
        route: "component:Button",
      });
      assert.include(button, "Button is a system component, which has no tree");
      assert.include(button, "handoff's change, target component:Button");
      assert.include(
        yield* refusal("apply_operations", {
          ops: [{ id: "t", op: "remove" }],
          route: "component:Nope",
        }),
        "no app component Nope; the app components are Promo"
      );
      assert.include(
        yield* refusal("focus", { route: "component:Promo" }),
        "name a page that places it"
      );
    })
);

onItsOwn(
  "makes sibling nodes of a page an app component, an instance in their place, as one undo step",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* tool("apply_operations", {
        ops: [
          {
            node: { id: "lede", role: "paragraph", text: "More", type: "text" },
            op: "insert",
            parent: "root",
          },
        ],
        route: "/home",
      });
      const { created } = yield* tool("apply_operations", {
        ops: [
          {
            ids: ["/home#heading", "lede"],
            name: "Intro",
            op: "makeComponent",
          },
        ],
        route: "/home",
      });
      const page = yield* tool("read_page", { route: "/home" });
      assert.deepStrictEqual(
        childrenOf(rootOf(page.document)).map((n) => [
          n.id,
          n.type === "instance" ? n.component : null,
        ]),
        [[created[0] ?? "", "Intro"]]
      );
      const intro = yield* tool("read_page", { route: "component:Intro" });
      const tree = rootOf(intro.document);
      assert.isNotNull(findNode(tree, "heading"));
      assert.isNotNull(findNode(tree, "lede"));

      const undone = yield* client["edit.undo"]();
      assert.strictEqual(undone?.label, "Make Intro an app component");
      const back = yield* tool("read_page", { route: "/home" });
      assert.deepStrictEqual(
        childrenOf(rootOf(back.document)).map((n) => n.id),
        ["heading", "lede"]
      );
    })
);

withPromo(
  "gives makeComponent no name that is taken or a system component's",
  () =>
    Effect.gen(function* () {
      yield* tool("apply_operations", {
        ops: [
          {
            node: { id: "note", role: "paragraph", text: "New", type: "text" },
            op: "insert",
            parent: "root",
          },
        ],
        route: "/home",
      });
      const make = (name: string) =>
        refusal("apply_operations", {
          ops: [{ ids: ["note"], name, op: "makeComponent" }],
          route: "/home",
        });
      assert.include(
        yield* make("Button"),
        "Button is a system component's name: an app component takes another"
      );
      assert.include(
        yield* make("Promo"),
        "there is a Promo component already"
      );
      const { components } = yield* Effect.flatMap(TestEnv, ({ client }) =>
        client["components.list"]()
      );
      assert.deepStrictEqual(
        components.map((e) => e.file),
        ["components/Promo.component.json"]
      );
    })
);

withPromo(
  "refuses makeComponent sent with other operations, or anywhere but on a page",
  () =>
    Effect.gen(function* () {
      assert.include(
        yield* refusal("apply_operations", {
          ops: [
            { ids: ["promo"], name: "Banner", op: "makeComponent" },
            { id: "promo", op: "update", set: { hidden: true } },
          ],
          route: "/home",
        }),
        "makeComponent is its own undo step: send it alone"
      );
      assert.include(
        yield* refusal("apply_operations", {
          ops: [{ ids: ["t"], name: "Card", op: "makeComponent" }],
          route: "component:Promo",
        }),
        "makeComponent makes a component of a page's nodes"
      );
      const page = yield* tool("read_page", { route: "/home" });
      assert.deepStrictEqual(
        childrenOf(rootOf(page.document)).map((n) => n.id),
        ["promo"]
      );
    })
);

withPromo(
  "lets the editor edit a component in place while another file is wrong, a slot going with its node",
  () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      // Written by hand: one that does not read, and one that places itself.
      yield* fs.writeFileString(
        `${repo}/designs/components/Broken.component.json`,
        "{ not json"
      );
      yield* fs.writeFileString(
        `${repo}/designs/components/Loop.component.json`,
        componentText({
          ...PROMO,
          name: "Loop",
          properties: [],
          slots: [],
          tree: { component: "Loop", from: "#app", id: "l", type: "instance" },
        })
      );
      yield* client["documents.apply"]({
        edits: [{ doc: "component:Promo", ops: [{ id: "x", op: "remove" }] }],
      });
      const { components } = yield* client["components.list"]();
      const promo = components.find((e) => e.component?.name === "Promo");
      assert.deepStrictEqual(
        promo?.component?.origin === "app" && promo.component.slots,
        []
      );
    })
);

withPromo(
  "changes the variation of a component's node in use, as on a page (ADR 0098)",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const doc = "component:Promo";
      const made = yield* client["variations.add"]({ doc, node: "t" });
      const [, second] = made.sets.t?.variations ?? [];
      yield* tool("apply_operations", {
        ops: [{ id: "t", op: "update", set: { text: "Hi" } }],
        route: doc,
      });
      yield* client["variations.use"]({
        doc,
        node: "t",
        variation: "original",
      });
      assert.strictEqual(yield* promoText("t"), "Sale");
      yield* client["variations.use"]({
        doc,
        node: "t",
        variation: second?.id ?? "",
      });
      assert.strictEqual(yield* promoText("t"), "Hi");
    })
);
