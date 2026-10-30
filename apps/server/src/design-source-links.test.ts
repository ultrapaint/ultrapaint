import path from "node:path";
import { assert, describe } from "@effect/vitest";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import { Effect, FileSystem } from "effect";
import { perTest } from "./testing/each-test.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { callMcp } from "./testing/mcp.ts";
import { ProjectRpc } from "./testing/project.ts";
import { waitFor } from "./testing/wait-for.ts";

const HOME = "home.page.json";

const THEME = `@theme {
  --color-brand: #2563eb;
  --color-ink: #111827;
  --radius-card: 0.75rem;
}
`;

const BUTTON = `declare namespace JSX { interface Element {} }
declare const cva: (base: string, config?: unknown) => (props?: unknown) => JSX.Element;
const buttonVariants = cva("inline-flex rounded-card h-9 px-4 bg-brand text-ink hover:bg-ink", {
  variants: { variant: { default: "", danger: "bg-ink text-brand" } },
  defaultVariants: { variant: "default" },
});
export const Button = (props: { variant?: string }): JSX.Element => {
  void '<span data-slot="button-spinner" />';
  return buttonVariants(props);
};
`;

const statusOf = (items: readonly ImplementationItem[], target: string) =>
  items.find((i) => i.target === target);

/** The text of a tool's answer, as an agent reads it. */
const toolText = (response: Response) =>
  Effect.promise(
    () =>
      response.json() as Promise<{
        result?: {
          content?: { text: string }[];
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

/** The project set up with a stylesheet, a cva Button and a design system read from them. */
const setUp = Effect.gen(function* () {
  const { client, repo, settings } = yield* TestEnv;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(path.join(repo, "styles"), { recursive: true });
  yield* fs.writeFileString(path.join(repo, "styles/app.css"), THEME);
  yield* fs.makeDirectory(path.join(repo, "designs/ui"), { recursive: true });
  yield* fs.writeFileString(path.join(repo, "designs/ui/button.tsx"), BUTTON);
  yield* fs.makeDirectory(path.join(repo, "src"), { recursive: true });
  yield* fs.writeFileString(
    path.join(repo, "src/home.tsx"),
    "export const Home = () => null;\n"
  );
  yield* client["settings.set"]({
    ...settings,
    hostCss: ["../../styles/app.css"],
    libraryDirs: ["designs/ui"],
  });
  yield* client["designSystem.detect"]();
});

/** Each test on a project of its own, the editor's requests in-process (docs/TESTING.md rule 3). */
const inProject = perTest(ProjectRpc({ git: true }));

/**
 * What crosses the socket or a real watch: an agent's `handoff` over the editor's MCP server,
 * and another tool's change to the tokens file.
 */
const onAServer = perTest(TestServer, {
  realClock:
    "handoff answers over the editor's MCP server, and a file another tool writes is heard by the real watch of the designs",
});

describe("bringing the code up to the design, and existing projects in (ADR 0028–0030)", () => {
  /** `handoff` called as an agent calls it. */
  const handoff = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      const { client, port } = yield* TestEnv;
      const { token } = yield* client["mcp.connection"]();
      return yield* Effect.flatMap(
        callMcp(port, token, {
          method: "tools/call",
          params: { arguments: args, name: "handoff" },
        }),
        toolText
      );
    });

  onAServer.effect(
    "names the tokens a page waits on, brings them to the code through handoff, and only then lets an agent mark it",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* setUp;
        const css = () => fs.readFileString(path.join(repo, "styles/app.css"));
        const { hash } = yield* client["documents.get"]({ doc: HOME });
        yield* client["documents.apply"]({
          edits: [
            {
              doc: HOME,
              expectedHash: hash,
              ops: [
                {
                  id: "heading",
                  op: "update",
                  set: { color: "$color-brand" },
                },
              ],
            },
          ],
        });
        // A token changed in the design alone waits for the code (ADR 0028).
        yield* client["designSystem.edit"]({
          ops: [{ name: "color-brand", op: "setValue", value: "#ff0000" }],
        });
        assert.notInclude(yield* css(), "#ff0000");
        const listed = yield* client["implementation.list"]();
        assert.deepStrictEqual(statusOf(listed.items, HOME)?.tokens, [
          "color-brand",
        ]);

        const task = yield* handoff({ action: "read", target: "/home" });
        assert.include(
          task,
          "Tokens this design uses whose value has not reached the code"
        );
        assert.include(task, "- color-brand: design #ff0000, code #2563eb");
        assert.include(
          task,
          'handoff with action "export" and tokens ["color-brand"]'
        );

        const refused = yield* handoff({
          action: "mark",
          files: ["src/home.tsx"],
          target: HOME,
        });
        assert.include(refused, "color-brand");
        assert.include(refused, "Bring them over first");
        assert.include(
          yield* handoff({ action: "export", tokens: ["nope"] }),
          "neither the design system nor the code has nope"
        );
        assert.include(
          yield* handoff({ action: "export", tokens: ["color-brand"] }),
          "1 token value brought to the code"
        );
        assert.include(yield* css(), "#ff0000");
        assert.isUndefined(
          statusOf((yield* client["implementation.list"]()).items, HOME)?.tokens
        );
        assert.include(
          yield* handoff({
            action: "mark",
            files: ["src/home.tsx"],
            target: HOME,
          }),
          "implemented"
        );

        // Both sides change the same token: an export leaves it for the user, an import by
        // name takes the code's.
        yield* fs.writeFileString(
          path.join(repo, "styles/app.css"),
          (yield* css()).replace("#111827", "#000000")
        );
        yield* client["designSystem.edit"]({
          ops: [{ name: "color-ink", op: "setValue", value: "#333333" }],
        });
        const left = yield* handoff({ action: "export" });
        assert.include(left, "Nothing to bring to the code.");
        assert.include(left, "color-ink (code #000000, design #333333)");
        assert.include(
          yield* handoff({ action: "import", tokens: ["color-ink"] }),
          "brought into the design"
        );
        const ds = (yield* client["designSystem.get"]()).designSystem;
        const ink = ds?.colors
          .flatMap((g) => g.tokens)
          .find((t) => t.name === "color-ink");
        assert.strictEqual(ink?.value, "#000000");

        // The command says what each argument does, the design system matched to, not the code.
        const command = (yield* client["commands.list"]()).find(
          (c) => c.name === "sync"
        );
        assert.include(command?.argument ?? "", "code");
        assert.include(
          command?.description ?? "",
          "`figma` match Figma's tokens to the design system's"
        );
        assert.notInclude(command?.description ?? "", "the code's");
      }),
    90_000
  );

  onAServer.effect(
    "keeps a system component's behaviour notes in its file, and tells the implementation of them",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* setUp;
        yield* client["components.fromDefault"]({ name: "Button" });
        // What implements a system component's look is the application's own component (ADR 0040).
        yield* client["implementation.mark"]({
          files: ["designs/ui/button.tsx"],
          target: "component:Button",
        });
        const button = statusOf(
          (yield* client["implementation.list"]()).items,
          "component:Button"
        );
        assert.strictEqual(button?.status, "implemented");
        assert.deepStrictEqual(button?.files, ["designs/ui/button.tsx"]);

        const noted = yield* client["components.change"]({
          change: {
            op: "addNote",
            slot: "button-spinner",
            text: "Spins while the action runs",
          },
          name: "Button",
        });
        assert.strictEqual(
          noted.component?.notes?.at(-1)?.slot,
          "button-spinner"
        );
        assert.include(
          yield* handoff({
            action: "note",
            target: "component:Button",
            text: "Submits the form it is in",
          }),
          "Noted on Button."
        );
        assert.include(
          yield* handoff({
            action: "note",
            node: "nope",
            target: "component:Button",
            text: "Never",
          }),
          "has no part nope"
        );
        const changed = yield* client["implementation.changes"]({
          target: "component:Button",
        });
        assert.include(
          changed.text,
          "- new behaviour note on button-spinner: Spins while the action runs"
        );
        assert.include(
          changed.text,
          "- new behaviour note: Submits the form it is in"
        );
        assert.isTrue(
          statusOf(
            (yield* client["implementation.list"]()).items,
            "component:Button"
          )?.designChanged
        );

        const task = yield* handoff({
          action: "read",
          target: "component:Button",
        });
        assert.include(task, "Behaviour notes on the component");
        assert.include(
          task,
          "- on button-spinner: Spins while the action runs"
        );
        assert.include(task, "Implement each behaviour note in the component");

        // Started from its default again, the file keeps what it says the code must do.
        const again = yield* client["components.fromDefault"]({
          name: "Button",
        });
        assert.deepStrictEqual(
          again.component?.notes?.map((n) => n.text),
          ["Spins while the action runs", "Submits the form it is in"]
        );
      }),
    60_000
  );

  inProject.effect(
    "moves a page's link to the code to another canvas with it, and starts a copy without one",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* setUp;
        const orders = yield* client["pages.create"]({
          canvas: "",
          name: "Orders",
        });
        yield* client["implementation.mark"]({
          files: ["src/home.tsx"],
          target: orders.id,
        });
        const items = () =>
          Effect.map(client["implementation.list"](), (l) => l.items);

        const [copy] = yield* client["pages.copyTo"]({
          ids: [orders.id],
          move: false,
          target: { name: "Redesign" },
        });
        assert.strictEqual(
          statusOf(yield* items(), copy?.id ?? "")?.status,
          "draft"
        );
        assert.strictEqual(
          statusOf(yield* items(), orders.id)?.status,
          "implemented"
        );

        const [moved] = yield* client["pages.copyTo"]({
          ids: [orders.id],
          move: true,
          target: { name: "Later" },
        });
        assert.strictEqual(moved?.id, "later/orders.page.json");
        assert.strictEqual(
          statusOf(yield* items(), "later/orders.page.json")?.status,
          "implemented"
        );
        assert.isTrue(
          yield* fs.exists(
            path.join(
              repo,
              "designs/_implemented/later/orders.implemented.json"
            )
          )
        );
        assert.isFalse(
          yield* fs.exists(
            path.join(repo, "designs/_implemented/orders.implemented.json")
          )
        );
        yield* client["edit.undo"]();
        assert.strictEqual(
          statusOf(yield* items(), orders.id)?.status,
          "implemented"
        );
        yield* client["edit.redo"]();

        // A canvas deleted takes its pages' links along.
        yield* client["canvases.delete"]({ id: "later" });
        const linked = JSON.parse(
          yield* fs.readFileString(
            path.join(repo, "designs/implementation.json")
          )
        ) as { items: Record<string, unknown> };
        assert.notProperty(linked.items, "later/orders.page.json");
      })
  );

  inProject.effect("marks pages ready at once", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* setUp;
      yield* client["implementation.mark"]({
        files: ["src/home.tsx"],
        target: HOME,
      });
      for (const name of ["Billing", "Team"]) {
        yield* client["pages.create"]({ canvas: "", name });
      }
      const { pages } = yield* client["pages.list"]();
      const ids = pages.filter((p) => p.canvas === "").map((p) => p.id);
      assert.strictEqual(ids.length, 3);
      // Home is implemented already: it is left as it is.
      const { changed } = yield* client["implementation.setReadyAll"]({
        ready: true,
        targets: ids,
      });
      assert.strictEqual(changed, ids.length - 1);
      const { items } = yield* client["implementation.list"]();
      assert.strictEqual(statusOf(items, HOME)?.status, "implemented");
      assert.isTrue(
        ids
          .filter((id) => id !== HOME)
          .every((id) => statusOf(items, id)?.status === "ready")
      );
    })
  );

  onAServer.effect(
    "keeps every value in design.tokens.json, and takes another tool's change to it as the design's (ADR 0035)",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const tokensFile = path.join(repo, "designs/design.tokens.json");
        const systemFile = path.join(repo, "designs/design-system.json");
        const tokensOf = (ds: DesignSystem | null) =>
          new Map(
            (ds?.colors ?? [])
              .flatMap((g) => g.tokens)
              .concat(ds?.radius ?? [])
              .map((t) => [t.name, t.value])
          );
        const current = () =>
          Effect.map(client["designSystem.get"](), (s) => s.designSystem);
        yield* setUp;
        yield* client["designSystem.edit"]({
          ops: [{ name: "color-brand", op: "setValue", value: "#ff0000" }],
        });

        // design-system.json keeps no value; the tokens file has them.
        const written = (yield* fs.readFileString(systemFile)) as string;
        const system = JSON.parse(written) as {
          colors: { tokens: Record<string, unknown>[] }[];
          designTokens?: unknown;
          spacing: Record<string, unknown>;
        };
        assert.isTrue(
          system.colors
            .flatMap((g) => g.tokens)
            .every((t) => !("value" in t || "values" in t))
        );
        assert.isUndefined(system.designTokens);
        assert.isFalse("base" in system.spacing);
        assert.include(yield* fs.readFileString(tokensFile), "#ff0000");
        const before = yield* current();
        assert.strictEqual(tokensOf(before).get("color-brand"), "#ff0000");

        // Another tool changes the brand colour and adds one: both are the design's at once.
        const json = JSON.parse(yield* fs.readFileString(tokensFile)) as {
          color: Record<string, unknown>;
        };
        json.color.brand = { $type: "color", $value: "#00ff00" };
        json.color.accent = { $type: "color", $value: "#123456" };
        yield* fs.writeFileString(
          tokensFile,
          `${JSON.stringify(json, null, 2)}\n`
        );
        const taken = yield* waitFor(
          current(),
          (ds) => tokensOf(ds).get("color-brand") === "#00ff00"
        );
        assert.strictEqual(tokensOf(taken).get("color-accent"), "#123456");

        // A change in the editor writes both files, and loses nothing of either.
        yield* client["designSystem.edit"]({
          ops: [{ name: "radius-card", op: "setValue", value: "1rem" }],
        });
        const after = yield* current();
        const expected = new Map(tokensOf(taken)).set("radius-card", "1rem");
        assert.deepStrictEqual(tokensOf(after), expected);
        assert.deepStrictEqual(after?.typography, taken?.typography);
        assert.deepStrictEqual(after?.spacing, taken?.spacing);
        const tokensText = yield* fs.readFileString(tokensFile);
        assert.include(tokensText, "#00ff00");
        assert.include(tokensText, "#123456");
        assert.notInclude(yield* fs.readFileString(systemFile), "#00ff00");

        // A tokens file that does not read: the design system stays, says why, and is not
        // written over it.
        const good = tokensText;
        yield* fs.writeFileString(tokensFile, "{");
        const broken = yield* waitFor(client["designSystem.get"](), (s) =>
          (s.problem ?? "").includes("design.tokens.json")
        );
        assert.isNotNull(broken.designSystem);
        const refused = yield* Effect.flip(
          client["designSystem.edit"]({
            ops: [{ name: "radius-card", op: "setValue", value: "2rem" }],
          })
        );
        assert.include(String(refused.message), "design.tokens.json");
        assert.strictEqual(yield* fs.readFileString(tokensFile), "{");
        yield* fs.writeFileString(tokensFile, good);
        yield* waitFor(
          client["designSystem.get"](),
          (s) => s.problem === undefined
        );

        // A design-system.json written before ADR 0035, its values and the tokens file's old
        // baseline in it, with no tokens file: it reads as it is, and the next change moves its
        // values out.
        const legacy = {
          ...after,
          designTokens: { agreed: {}, at: 0 },
        };
        yield* fs.writeFileString(
          systemFile,
          `${JSON.stringify(legacy, null, 2)}\n`
        );
        yield* fs.remove(tokensFile);
        const read = yield* waitFor(
          current(),
          (ds) => tokensOf(ds).get("radius-card") === "1rem" && ds !== null
        );
        assert.deepStrictEqual(tokensOf(read), tokensOf(after));
        yield* client["designSystem.edit"]({
          ops: [{ name: "color-accent", op: "setValue", value: "#654321" }],
        });
        assert.include(yield* fs.readFileString(tokensFile), "#00ff00");
        const moved = yield* fs.readFileString(systemFile);
        assert.notInclude(moved, "designTokens");
        assert.notInclude(moved, "#00ff00");
        assert.strictEqual(
          tokensOf(yield* current()).get("color-accent"),
          "#654321"
        );
      }),
    60_000
  );

  inProject.effect(
    "writes a node's code through the project's style system",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* setUp;
        const { code, language } = yield* client["code.write"]({
          node: {
            children: [
              { id: "t", role: "paragraph", text: "Hi", type: "text" },
            ],
            fill: "$color-brand",
            gap: 16,
            id: "row",
            type: "row",
          },
          parent: "column",
        });
        assert.strictEqual(language, "tsx");
        assert.include(code, '<div className="flex gap-4 bg-brand">');
        assert.include(code, "<p>Hi</p>");
      })
  );
});
