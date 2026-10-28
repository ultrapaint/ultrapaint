import { assert, describe, layer } from "@effect/vitest";
import { emptySpec } from "@ultrapaint/contracts/specs";
import { type Context, Effect } from "effect";
import { ProjectManager, type ProjectServices } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ImplementationService } from "./services/implementation.ts";
import { EditorTools } from "./services/mcp/tools.ts";
import { SpecService } from "./services/specs.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { callTool, ProjectTest } from "./testing/project.ts";

/** The fixture's Button, with a spec of its own. */
const BUTTON_SPEC = `${JSON.stringify(emptySpec("Button", "ui/button"))}\n`;

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
) => Effect.flatMap(ProjectManager, (p) => p.service(key)(f));

/** `/implement`'s task for a target, as the slash command or the Components panel asks. */
const implementTask = (target: string) =>
  Effect.flatMap(AgentTasks, (tasks) =>
    Effect.map(tasks.task({ _tag: "Implement", target }), ({ text }) => text)
  );

describe("a design target, named once", () => {
  layer(
    ProjectTest({ files: { "designs/specs/Button.spec.json": BUTTON_SPEC } }),
    { excludeTestServices: true }
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

    it.effect("reads, marks and notes a spec named by its component", () =>
      Effect.gen(function* () {
        const task = yield* handoff({ action: "read", target: "Button" });
        assert.include(task, "Implement the look of Button as its spec says");
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
          "- spec:Button (Button): implemented → ui/button.tsx"
        );
        const changes = yield* project(ImplementationService, (i) =>
          i.changes("spec:Button")
        );
        assert.isTrue(changes.implemented);
        const specs = yield* project(SpecService, (s) => s.specs);
        assert.deepStrictEqual(
          specs[0]?.notes?.map((n) => n.text),
          ["Submits the form it is in"]
        );
        // The note is the spec's, which /implement reads it from, by either name.
        for (const target of ["Button", "spec:Button"]) {
          const implement = yield* implementTask(target);
          assert.include(implement, "- Submits the form it is in");
        }
      })
    );

    it.effect("says which kind a miss is, and lists that kind", () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* refusal({ action: "read", target: "spec:Nope" }),
          "no component spec is spec:Nope; the component specs are:\n- Button"
        );
        assert.strictEqual(
          yield* refusal({ action: "mark", files: ["x"], target: "/nowhere" }),
          "no page is /nowhere; the pages are:\n- Home, /home: designs/home.page.json"
        );
        assert.strictEqual(
          yield* refusal({ action: "note", target: "Nope", text: "x" }),
          "no component spec is Nope (a page is named by its URL or its file); the component specs are:\n- Button"
        );
        const implement = yield* Effect.flip(implementTask("spec:Nope"));
        assert.strictEqual(
          implement.message,
          "no component spec is spec:Nope; the component specs are:\n- Button"
        );
        assert.strictEqual(implement.next, "Ask which one.");
      })
    );
  });

  layer(ProjectTest(), { excludeTestServices: true })((it) => {
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
        // A node beside the pages is no page: the tools take it with loose.
        assert.include(yield* miss("canvas#c_1"), "pass `loose: true`");
      })
    );
  });
});
