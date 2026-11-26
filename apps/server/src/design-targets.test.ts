import { assert, describe } from "@effect/vitest";
import { APP_FROM } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { emptySystemComponent } from "@ultrapaint/contracts/testing/components";
import { walk } from "@ultrapaint/design-document/tree";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { type Context, Effect } from "effect";
import { OpenProject, type ProjectServices } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ComponentService } from "./services/components.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { ImplementationService } from "./services/implementation.ts";
import { EditorTools } from "./services/mcp/route.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { eachTest } from "./testing/each-test.ts";
import { callTool, ProjectTest } from "./testing/project.ts";

/** The Button, with a file of its own: the project owns its look. */
const BUTTON_FILE = `${JSON.stringify(emptySystemComponent("Button"))}\n`;

const handoff = (
  parameters: Parameters<
    typeof callTool<typeof EditorTools.tools, "handoff">
  >[2]
) =>
  Effect.map(callTool(EditorTools, "handoff", parameters), ({ text }) => text);

const refusal = (
  parameters: Parameters<
    typeof callTool<typeof EditorTools.tools, "handoff">
  >[2]
) =>
  Effect.map(
    Effect.flip(callTool(EditorTools, "handoff", parameters)),
    ({ message }) => message
  );

/** One service of the open project, asked one thing. */
const project = <I extends ProjectServices, S, A, E>(
  key: Context.Key<I, S>,
  f: (service: S) => Effect.Effect<A, E>
) => Effect.flatMap(OpenProject, (p) => p.service(key)(f));

/** `/implement`'s task for a target, as the slash command or the Components panel asks. */
const implementTask = (target: string) =>
  Effect.flatMap(AgentTasks, (tasks) =>
    Effect.map(tasks.task({ _tag: "Implement", target }), ({ text }) => text)
  );

/** An app component Plan, with a choice tone, placed on Home as loud. */
const planOnHome = Effect.gen(function* () {
  yield* project(ComponentService, (c) => c.create("Plan"));
  yield* project(ComponentService, (c) =>
    c.change("Plan", {
      op: "addProperty",
      property: {
        default: "plain",
        kind: "choice",
        members: ["plain", "loud"],
        name: "tone",
      },
    })
  );
  yield* callTool(EditorTools, "apply_operations", {
    ops: [
      {
        node: {
          component: "Plan",
          from: APP_FROM,
          id: "plan",
          props: { tone: "loud" },
          type: "instance",
        },
        op: "insert",
        parent: null,
      },
    ],
    route: "/home",
  });
});

describe("a design target, named once", () => {
  eachTest(
    ProjectTest({
      files: { "designs/components/Button.component.json": BUTTON_FILE },
    })
  )((it) => {
    it.effect("pins a note on a node reference to its node", () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* handoff({
            action: "note",
            target: "/home#heading",
            text: "Greets by first name",
          }),
          "Noted on designs/home.page.json (heading)."
        );
        const { comments } = yield* project(CommentsService, (c) => c.list(""));
        const note = comments.find((c) => c.text === "Greets by first name");
        assert.strictEqual(note?.kind, "behaviour");
        assert.strictEqual(note?.nodeId, "heading");
        assert.strictEqual(note?.page, "home.page.json");
      })
    );

    it.effect("refuses a node reference and another node", () =>
      Effect.gen(function* () {
        assert.include(
          yield* refusal({
            action: "note",
            node: "root",
            target: "/home#heading",
            text: "Never",
          }),
          "the target names the node heading, and node says root"
        );
        // A node reference names its page for the other actions too.
        assert.include(
          yield* handoff({ action: "read", target: "/home#heading" }),
          "Implement the page Home of the design"
        );
        // The same node said twice is the same note.
        assert.strictEqual(
          yield* handoff({
            action: "note",
            node: "heading",
            target: "/home#heading",
            text: "Waves",
          }),
          "Noted on designs/home.page.json (heading)."
        );
      })
    );

    it.effect("reads, marks and notes a component named by its name", () =>
      Effect.gen(function* () {
        const task = yield* handoff({ action: "read", target: "Button" });
        assert.include(
          task,
          "Implement the look of the Button system component as its file says"
        );
        assert.strictEqual(
          yield* handoff({
            action: "note",
            target: "Button",
            text: "Submits the form it is in",
          }),
          "Noted on Button."
        );
        assert.include(
          yield* handoff({
            action: "mark",
            files: ["ui/button.tsx"],
            target: "Button",
          }),
          "- component:Button (Button): implemented → ui/button.tsx"
        );
        const changes = yield* project(ImplementationService, (i) =>
          i.changes("component:Button")
        );
        assert.isTrue(changes.implemented);
        const components = yield* project(
          ComponentService,
          (c) => c.components
        );
        assert.deepStrictEqual(
          components[0]?.notes?.map((n) => n.text),
          ["Submits the form it is in"]
        );
        // The note is the component's, which /implement reads it from, by either name.
        for (const target of ["Button", "component:Button"]) {
          const implement = yield* implementTask(target);
          assert.include(implement, "- Submits the form it is in");
        }
      })
    );

    it.effect(
      "changes a component through handoff, a rename following into its instances' props (ADR 0122)",
      () =>
        Effect.gen(function* () {
          yield* planOnHome;
          assert.strictEqual(
            yield* handoff({
              action: "change",
              change: { name: "tone", op: "renameProperty", to: "mood" },
              target: "component:Plan",
            }),
            "Changed Plan."
          );
          const home = yield* project(DocumentService, (d) =>
            d.get("home.page.json")
          );
          const plan = [...walk(home.root as DesignNode)].find(
            (n) => n.id === "plan"
          );
          assert.deepStrictEqual(
            (plan as { props?: object } | undefined)?.props,
            { mood: "loud" }
          );
        })
    );

    it.effect(
      "refuses a component change the component cannot take, saying why",
      () =>
        Effect.gen(function* () {
          yield* planOnHome;
          assert.strictEqual(
            yield* refusal({
              action: "change",
              change: { name: "size", op: "renameProperty", to: "x" },
              target: "component:Plan",
            }),
            "Plan has no property size"
          );
          assert.include(
            yield* refusal({
              action: "change",
              change: { op: "renameEverything" },
              target: "component:Plan",
            }),
            "change is no component change"
          );
        })
    );

    it.effect("refuses a change to a page, or one not said", () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* refusal({
            action: "change",
            change: { name: "tone", op: "removeProperty" },
            target: "/home",
          }),
          "a page changes through apply_operations: change takes a component (target component:<Name>)"
        );
        assert.strictEqual(
          yield* refusal({ action: "change", target: "component:Button" }),
          "say the change in change: one {op, …} of the component"
        );
      })
    );

    it.effect("says which kind a miss is, and lists that kind", () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* refusal({ action: "read", target: "component:Nope" }),
          "no component is component:Nope; the components with a file are:\n- Button"
        );
        assert.strictEqual(
          yield* refusal({ action: "mark", files: ["x"], target: "/nowhere" }),
          "no page is /nowhere; the pages are:\n- Home, /home: designs/home.page.json"
        );
        assert.strictEqual(
          yield* refusal({ action: "note", target: "Nope", text: "x" }),
          "no component is Nope (a page is named by its URL or its file); the components with a file are:\n- Button"
        );
        const implement = yield* Effect.flip(implementTask("component:Nope"));
        assert.strictEqual(
          implement.message,
          "no component is component:Nope; the components with a file are:\n- Button"
        );
        assert.strictEqual(implement.next, "Ask which one.");
      })
    );
  });

  eachTest(ProjectTest())((it) => {
    it.effect("names a page for the other tools by the same rule", () =>
      Effect.gen(function* () {
        const { id } = yield* callTool(EditorTools, "create_canvas", {
          name: "Marketing",
        });
        yield* callTool(EditorTools, "create_page", {
          canvas: id,
          name: "Pricing",
          route: "/pricing",
        });
        // A canvas written first, as a node reference has it, without a node.
        const read = yield* callTool(EditorTools, "read_page", {
          route: `${id}:/pricing`,
        });
        assert.strictEqual(read.file, `designs/${id}/pricing.page.json`);
        const miss = (route: string, canvas?: string) =>
          Effect.map(
            Effect.flip(
              callTool(EditorTools, "read_page", {
                route,
                ...(canvas === undefined ? {} : { canvas }),
              })
            ),
            ({ message }) => message
          );
        const pages = `the pages are:\n- Home, /home: designs/home.page.json\n- Pricing, /pricing: designs/${id}/pricing.page.json`;
        assert.strictEqual(
          yield* miss("/nowhere"),
          `no page is /nowhere; ${pages}`
        );
        assert.strictEqual(
          yield* miss("/home", id),
          `no page is /home in canvas "${id}"; ${pages}`
        );
        assert.strictEqual(
          yield* miss("nowhere.page.json"),
          `no page is nowhere.page.json; ${pages}`
        );
        // A node beside the pages is read where it is, in the canvas its reference says.
        assert.strictEqual(
          yield* miss(`${id}:canvas#c_1`),
          `no node c_1 in designs/${id}/canvas.json; read it without a node to see its ids`
        );
      })
    );
  });
});

describe("a system component's look, changed through handoff (UP-227)", () => {
  eachTest(ProjectTest())((it) => {
    /** The Button as the Library lists it: its file, and what reads of it. */
    const buttonListed = project(ComponentService, (c) =>
      Effect.map(c.list, ({ components }) =>
        components.find((e) => e.file === "components/Button.component.json")
      )
    );
    const SET_HEIGHT = {
      op: "setStyle",
      place: { state: null, variant: null },
      slot: "root",
      style: { height: 48 },
    };

    it.effect(
      "starts a component's file from its default look with its first change, in one undo step",
      () =>
        Effect.gen(function* () {
          assert.isUndefined(yield* buttonListed);
          // An agent of the editor's thread reads the part's style as drawn, and sets all of it.
          const { look: drawn } = yield* callTool(
            EditorTools,
            "get_component",
            {
              name: "Button",
            }
          );
          const { root } = (drawn as { base: { root: object } }).base;
          const { text } = yield* callTool(
            EditorTools,
            "handoff",
            {
              action: "change",
              change: { ...SET_HEIGHT, style: { ...root, height: 48 } },
              target: "component:Button",
            },
            "thread-1"
          );
          assert.strictEqual(text, "Changed Button.");
          const look = (yield* buttonListed)?.component;
          assert.strictEqual(look?.origin, "system");
          if (look?.origin !== "system") {
            return;
          }
          const start = defaultLookOf("Button");
          // The default look, the part's style set over it: the rest as the default has it.
          assert.deepStrictEqual(look.base.root, {
            ...start?.base.root,
            height: 48,
          });
          assert.deepStrictEqual(look.variants, start?.variants);
          const journal = yield* project(EditService, (e) => e.state);
          assert.strictEqual(journal.undoLabel, "Change Button's look at base");
        })
    );

    it.effect(
      "changes the look every instance is drawn from, and takes it back in one undo step",
      () =>
        Effect.gen(function* () {
          yield* handoff({
            action: "change",
            change: SET_HEIGHT,
            target: "component:Button",
          });
          yield* handoff({
            action: "change",
            change: { ...SET_HEIGHT, style: { height: 40 } },
            target: "Button",
          });
          // The catalogue every page's instances are drawn from has it.
          const height = project(ComponentService, (c) =>
            Effect.map(c.components, (files) => {
              const button = files.find((f) => f.name === "Button");
              return button?.origin === "system"
                ? button.base.root?.height
                : undefined;
            })
          );
          assert.strictEqual(yield* height, 40);
          yield* project(EditService, (e) => e.undo);
          assert.strictEqual(yield* height, 48);
          // The first change goes in one step, its file with it: the default look again.
          yield* project(EditService, (e) => e.undo);
          assert.isUndefined(yield* buttonListed);
        })
    );

    it.effect(
      "refuses a part, a member or a state the component lacks, listing those it has",
      () =>
        Effect.gen(function* () {
          assert.strictEqual(
            yield* refusal({
              action: "change",
              change: { ...SET_HEIGHT, slot: "button-label" },
              target: "component:Button",
            }),
            "Button has no part button-label; its parts are root, button-spinner"
          );
          assert.strictEqual(
            yield* refusal({
              action: "change",
              change: {
                ...SET_HEIGHT,
                place: { state: null, variant: { axis: "size", member: "xl" } },
              },
              target: "component:Button",
            }),
            "Button's size has no member xl; its members are md, sm, lg, icon"
          );
          assert.strictEqual(
            yield* refusal({
              action: "change",
              change: {
                ...SET_HEIGHT,
                place: { state: "hover", variant: null },
              },
              target: "component:Badge",
            }),
            "Badge has no state hover; it has none"
          );
          // Nothing was started for a change refused.
          assert.isUndefined(yield* buttonListed);
        })
    );

    it.effect(
      "takes a change from an agent outside the editor through the same tool",
      () =>
        Effect.gen(function* () {
          // No calling thread: an agent connected from outside the editor (ADR 0083).
          const { text: badgeSaid } = yield* callTool(EditorTools, "handoff", {
            action: "change",
            change: {
              op: "setStyle",
              place: {
                state: null,
                variant: { axis: "variant", member: "secondary" },
              },
              slot: "root",
              style: { border: { color: "$color-border", width: 1 } },
            },
            target: "component:Badge",
          });
          assert.strictEqual(badgeSaid, "Changed Badge.");
          const badge = yield* project(ComponentService, (c) =>
            Effect.map(c.components, (files) =>
              files.find((f) => f.name === "Badge")
            )
          );
          assert.deepStrictEqual(
            badge?.origin === "system"
              ? badge.variants.variant?.secondary?.root?.border
              : undefined,
            { color: "$color-border", width: 1 }
          );
        })
    );
  });

  eachTest(
    ProjectTest({
      files: {
        // Written by hand before the check: a known part beside one Button does not have.
        "designs/components/Button.component.json": `${JSON.stringify({
          ...emptySystemComponent("Button"),
          base: { label: { color: "red" }, root: { height: 48 } },
        })}\n`,
      },
    })
  )((it) => {
    it.effect(
      "fixes a look whose file does not read one change at a time, saying what is left",
      () =>
        Effect.gen(function* () {
          assert.strictEqual(
            yield* handoff({
              action: "change",
              change: {
                op: "setStyle",
                place: { state: null, variant: null },
                slot: "root",
                style: { height: 40 },
              },
              target: "component:Button",
            }),
            "Changed Button; its file still does not read: base: Button has no part label; its parts are root, button-spinner"
          );
          assert.strictEqual(
            yield* handoff({
              action: "change",
              change: {
                op: "setStyle",
                place: { state: null, variant: null },
                slot: "label",
                style: {},
              },
              target: "component:Button",
            }),
            "Changed Button."
          );
          const button = yield* project(ComponentService, (c) =>
            Effect.map(c.components, (files) =>
              files.find((f) => f.name === "Button")
            )
          );
          assert.deepStrictEqual(
            button?.origin === "system" ? button.base : undefined,
            { root: { height: 40 } }
          );
        })
    );
  });
});
