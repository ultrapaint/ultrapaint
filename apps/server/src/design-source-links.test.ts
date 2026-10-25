import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { callMcp } from "./testing/mcp.ts";

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
  void '<span data-slot="button-icon" />';
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

/** Reads until `done` holds, every 100 ms, for up to fifteen seconds. */
const waitFor = <A, E>(read: Effect.Effect<A, E>, done: (a: A) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 150; i += 1) {
      const a = yield* read;
      if (done(a)) {
        return a;
      }
      yield* Effect.sleep("100 millis");
    }
    return yield* Effect.die(new Error("timed out waiting"));
  });

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
  yield* waitFor(client["catalogue.get"]({ refresh: false }), (c) =>
    c.components.some((m) => m.name === "Button")
  );
});

layer(TestServer, { excludeTestServices: true, timeout: "120 seconds" })(
  "bringing the code up to the design, and existing projects in (ADR 0028–0030)",
  (it) => {
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

    /** A command sent in a new thread, and the first line of the task its agent received. */
    const taskOf = (text: string) =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        yield* client["threads.prompt"]({
          attachments: [],
          text,
          threadId: thread.id,
        });
        const items = yield* waitFor(
          client["threads.items"]({ threadId: thread.id }),
          (all: readonly ThreadItem[]) => all.some((i) => i.kind === "turn_end")
        );
        const listed = yield* client["threads.list"]();
        return {
          purpose: listed.find((t) => t.id === thread.id)?.purpose,
          said: items.flatMap((i) => (i.kind === "agent" ? [i.text] : [])),
        };
      });

    it.effect(
      "names the tokens a page waits on, brings them to the code through handoff, and only then lets an agent mark it",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* setUp;
          const css = () =>
            fs.readFileString(path.join(repo, "styles/app.css"));
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
          yield* client["designSystem.setToken"]({
            name: "color-brand",
            value: "#ff0000",
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
            statusOf((yield* client["implementation.list"]()).items, HOME)
              ?.tokens
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
          yield* client["designSystem.setToken"]({
            name: "color-ink",
            value: "#333333",
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
          const sync = yield* taskOf("/sync code");
          assert.include(
            sync.said.join("\n"),
            "task:sync The user ran /sync code. The code has every value of the design"
          );
        }),
      90_000
    );

    it.effect(
      "reads every component's spec off the code, linked to its file, and keeps a component's behaviour notes",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const read = yield* client["specs.fromCodeAll"]({});
          assert.deepStrictEqual(read, { linked: 1, read: 1 });
          const button = statusOf(
            (yield* client["implementation.list"]()).items,
            "spec:Button"
          );
          assert.strictEqual(button?.status, "implemented");
          assert.deepStrictEqual(button?.files, ["designs/ui/button.tsx"]);
          // Read again, nothing is left to read.
          assert.deepStrictEqual(yield* client["specs.fromCodeAll"]({}), {
            linked: 0,
            read: 0,
          });

          const note = yield* client["specs.addNote"]({
            component: "Button",
            slot: "button-icon",
            text: "Spins while the action runs",
          });
          assert.strictEqual(note.slot, "button-icon");
          assert.include(
            yield* handoff({
              action: "note",
              target: "spec:Button",
              text: "Submits the form it is in",
            }),
            "Noted on Button."
          );
          assert.include(
            yield* handoff({
              action: "note",
              node: "nope",
              target: "spec:Button",
              text: "Never",
            }),
            "has no slot nope"
          );
          const changed = yield* client["implementation.changes"]({
            target: "spec:Button",
          });
          assert.include(
            changed.text,
            "- new behaviour note on button-icon: Spins while the action runs"
          );
          assert.include(
            changed.text,
            "- new behaviour note: Submits the form it is in"
          );
          assert.isTrue(
            statusOf(
              (yield* client["implementation.list"]()).items,
              "spec:Button"
            )?.designChanged
          );

          const task = yield* handoff({
            action: "read",
            target: "spec:Button",
          });
          assert.include(task, "Behaviour notes on the component");
          assert.include(task, "- on button-icon: Spins while the action runs");
          assert.include(
            task,
            "Implement each behaviour note in the component"
          );

          // Read off the code again, the spec keeps what it says the code must do.
          const again = yield* client["specs.fromCode"]({
            component: "Button",
          });
          assert.deepStrictEqual(
            again.spec?.notes?.map((n) => n.text),
            ["Spins while the action runs", "Submits the form it is in"]
          );
        }),
      60_000
    );

    it.effect(
      "moves a page's link to the code to another canvas with it, and starts a copy without one",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
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
        }),
      60_000
    );

    it.effect(
      "marks pages ready at once, and has a design thread link pages built already to their code",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
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

          const adopt = yield* taskOf('/implement --adopt ""');
          assert.include(
            adopt.said.join("\n"),
            "task:implement These pages of the design are built in the application already"
          );
          // Linking changes no code: the thread stays one that designs.
          assert.isUndefined(adopt.purpose);
        }),
      60_000
    );

    it.effect(
      "takes what another tool changed in design.tokens.json, without its own writes ever reading as such",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "designs/design.tokens.json");
          const outcomes = () =>
            Effect.map(client["sync.tokens"]({ source: "dtcg" }), (c) =>
              Object.fromEntries(
                (c?.diffs ?? [])
                  .filter((d) => d.outcome !== "same")
                  .map((d) => [d.name, d.outcome])
              )
            );
          // The editor wrote the file with every change: nothing reads as another tool's.
          assert.deepStrictEqual(yield* outcomes(), {});
          const system = JSON.parse(
            yield* fs.readFileString(
              path.join(repo, "designs/design-system.json")
            )
          ) as { designTokens?: { agreed: Record<string, string> } };
          assert.strictEqual(
            system.designTokens?.agreed["color-brand"],
            "#ff0000"
          );

          // Another tool changes the brand colour.
          const json = JSON.parse(yield* fs.readFileString(file)) as {
            color: Record<string, unknown>;
          };
          json.color.brand = { $type: "color", $value: "#00ff00" };
          yield* fs.writeFileString(file, `${JSON.stringify(json, null, 2)}\n`);
          const plan = yield* waitFor(client["sync.plan"](), (p) =>
            p.steps.some((s) => s.kind === "dtcg-tokens")
          );
          assert.strictEqual(plan.facts.designTokens?.toDesign, 1);
          assert.deepStrictEqual(yield* outcomes(), {
            "color-brand": "to-design",
          });

          // The editor writes the design system meanwhile: the file keeps what the tool wrote.
          yield* client["designSystem.setToken"]({
            name: "radius-card",
            value: "1rem",
          });
          assert.include(yield* fs.readFileString(file), "#00ff00");
          assert.deepStrictEqual(yield* outcomes(), {
            "color-brand": "to-design",
            "radius-card": "source-behind",
          });

          const applied = yield* client["sync.apply"]({
            decisions: [],
            source: "dtcg",
          });
          assert.strictEqual(applied.written, 1);
          const ds = (yield* client["designSystem.get"]()).designSystem;
          assert.strictEqual(
            ds?.colors
              .flatMap((g) => g.tokens)
              .find((t) => t.name === "color-brand")?.value,
            "#00ff00"
          );
          // Written again from the design system: the design's change is in it, and they agree.
          assert.deepStrictEqual(yield* outcomes(), {});
          const after = JSON.parse(yield* fs.readFileString(file)) as {
            radius: { card: { $value: unknown } };
          };
          assert.deepStrictEqual(after.radius.card.$value, {
            unit: "rem",
            value: 1,
          });
          const settled = yield* waitFor(
            client["sync.plan"](),
            (p) => !p.steps.some((s) => s.kind === "dtcg-tokens")
          );
          assert.isUndefined(
            settled.steps.find((s) => s.kind === "dtcg-tokens")
          );
        }),
      60_000
    );

    it.effect(
      "writes a node's code through the project's style system",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
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
        }),
      30_000
    );
  }
);
