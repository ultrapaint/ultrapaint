import { request } from "node:http";
import { assert, layer } from "@effect/vitest";
import type { PageDocument } from "@ultrapaint/contracts/document";
import { type FigmaImport, MAX_FIG_BYTES } from "@ultrapaint/contracts/figma";
import type { FigGuid } from "@ultrapaint/figma-import/fig";
import {
  identity,
  makeFixture,
  PNG_BYTES,
  solid,
} from "@ultrapaint/figma-import/testing/fixture";
import { Effect, FileSystem, Path } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { toolCaller } from "./testing/mcp.ts";

/** A login frame using a Button component set with a Label property, and a picture. */
const loginFile = () => {
  const f = makeFixture();
  const labelDef: FigGuid = { localID: 5, sessionID: 9 };
  const set = f.add(f.internal, {
    componentPropDefs: [
      {
        id: labelDef,
        initialValue: { textValue: { characters: "Button" } },
        name: "Label#9:5",
        type: "TEXT",
      },
    ],
    isStateGroup: true,
    name: "Button",
    size: { x: 300, y: 120 },
    type: "FRAME",
  });
  const large = f.add(set, {
    fillPaints: [solid(0.2, 0.4, 1)],
    name: "Size=Large",
    size: { x: 120, y: 48 },
    stackHorizontalPadding: 16,
    stackMode: "HORIZONTAL",
    stackVerticalPadding: 8,
    transform: identity(),
    type: "SYMBOL",
  });
  f.add(large, {
    componentPropRefs: [
      { componentPropNodeField: "TEXT_DATA", defID: labelDef },
    ],
    fontName: { family: "Inter", postscript: "Inter-Bold", style: "Bold" },
    fontSize: 16,
    name: "Label",
    overrideKey: { localID: 100, sessionID: 9 },
    size: { x: 88, y: 24 },
    textAutoResize: "WIDTH_AND_HEIGHT",
    textData: { characters: "Button" },
    type: "TEXT",
  });
  const frame = f.add(f.page, {
    fillPaints: [solid(1, 1, 1)],
    name: "Login",
    size: { x: 400, y: 600 },
    stackCounterSizing: "FIXED",
    stackHorizontalPadding: 24,
    stackMode: "VERTICAL",
    stackPrimarySizing: "FIXED",
    stackSpacing: 16,
    stackVerticalPadding: 32,
    type: "FRAME",
  });
  f.add(frame, {
    fontName: { family: "Inter", postscript: "Inter-Bold", style: "Bold" },
    fontSize: 32,
    name: "Title",
    size: { x: 300, y: 40 },
    textAutoResize: "WIDTH_AND_HEIGHT",
    textData: { characters: "Welcome back" },
    type: "TEXT",
  });
  f.add(frame, {
    fillPaints: [
      {
        image: { hash: new Uint8Array(20).fill(0xab) },
        imageScaleMode: "FILL",
        type: "IMAGE",
        visible: true,
      },
    ],
    name: "Hero",
    size: { x: 352, y: 160 },
    type: "RECTANGLE",
  });
  f.add(frame, {
    componentPropAssignments: [
      { defID: labelDef, value: { textValue: { characters: "Sign in" } } },
    ],
    name: "Button",
    size: { x: 352, y: 48 },
    stackChildAlignSelf: "STRETCH",
    symbolData: { symbolID: large },
    type: "INSTANCE",
  });
  f.addImage("ab".repeat(20), PNG_BYTES);
  return f.build();
};

const upload = (port: number, name: string, bytes: Uint8Array) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}/api/figma/import`, {
      body: bytes,
      headers: {
        "content-type": "application/octet-stream",
        origin: `http://127.0.0.1:${port}`,
        "x-file-name": encodeURIComponent(name),
      },
      method: "POST",
    })
  );

/**
 * A body sent in chunks, with no length declared, until the server answers or `total` bytes are
 * out. Answers with the status and how much had been sent by then.
 */
const uploadChunked = (port: number, total: number) =>
  Effect.callback<{ readonly sent: number; readonly status: number }>(
    (resume) => {
      const chunk = new Uint8Array(1024 * 1024);
      let sent = 0;
      let done = false;
      const finish = (status: number) => {
        if (!done) {
          done = true;
          resume(Effect.succeed({ sent, status }));
        }
      };
      const req = request({
        agent: false,
        headers: {
          "content-type": "application/octet-stream",
          "transfer-encoding": "chunked",
          "x-file-name": "huge.fig",
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/api/figma/import",
        port,
      });
      req.on("response", (res) => {
        res.resume();
        finish(res.statusCode ?? 0);
      });
      req.on("error", () => finish(-1));
      const pump = () => {
        while (!done && sent < total) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once("drain", pump);
            return;
          }
        }
        if (!done) {
          req.end();
        }
      };
      pump();
    }
  );

layer(TestServer, { excludeTestServices: true, timeout: "120 seconds" })(
  "importing a Figma file",
  (it) => {
    it.effect("answers a file name that is not URI-encoded with a 400", () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        const response = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/api/figma/import`, {
            body: new Uint8Array(8),
            headers: {
              "content-type": "application/octet-stream",
              "x-file-name": "%E0%A4%A",
            },
            method: "POST",
          })
        );
        assert.strictEqual(response.status, 400);
      })
    );

    it.effect(
      "reads the file, lets an agent map its components, and writes a frame as a page",
      () =>
        Effect.gen(function* () {
          const { client, port, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });

          const response = yield* upload(port, "login.fig", loginFile());
          assert.strictEqual(response.status, 200);
          const imported = (yield* Effect.promise(() =>
            response.json()
          )) as FigmaImport;
          assert.deepStrictEqual(
            imported.pages.map((p) => p.frames.map((f) => f.name)),
            [["Login"]]
          );
          const [button] = imported.components;
          assert.strictEqual(button?.key, "Button");
          assert.deepStrictEqual(button?.variants, { Size: ["Large"] });
          assert.strictEqual(button?.uses, 1);
          // The repository's Button is offered as what it might be.
          assert.strictEqual(button?.candidates[0]?.name, "Button");
          const listed = yield* client["figma.list"]();
          assert.strictEqual(listed[0]?.id, imported.id);

          // Bytes that are not a Figma file are refused with a reason.
          const refused = yield* upload(
            port,
            "notes.txt",
            new TextEncoder().encode("hello")
          );
          assert.strictEqual(refused.status, 400);

          // The agent decides through the editor's tools, with the project's token.
          const { token } = yield* client["mcp.connection"]();
          const tool = toolCaller(port, token);

          const read = yield* tool("read_figma_import", {});
          assert.isNotTrue(read.result.isError);
          assert.strictEqual(read.result.structuredContent.id, imported.id);

          const wrong = yield* tool("map_figma_component", {
            component: "Button",
            mapping: { component: "Nope", kind: "component" },
          });
          assert.isTrue(wrong.result.isError);
          assert.include(
            wrong.result.content[0]?.text ?? "",
            "no component named Nope"
          );

          const mapped = yield* tool("map_figma_component", {
            component: "Button",
            mapping: {
              component: "Button",
              kind: "component",
              propMap: {
                Label: { prop: "label" },
                Size: { prop: "variant", values: { Large: "primary" } },
              },
            },
          });
          assert.isNotTrue(mapped.result.isError);
          assert.deepStrictEqual(mapped.result.structuredContent.undecided, []);
          const decided = mapped.result.structuredContent.mapping as {
            from: string;
          };
          assert.isString(decided.from);

          const frame = yield* tool("read_figma_frame", { frame: "Login" });
          assert.isNotTrue(frame.result.isError);
          const outline = frame.result.structuredContent.outline as string;
          assert.include(outline, 'instance "Button" [Size=Large]');
          assert.include(outline, "(mapped)");

          const written = yield* tool("write_figma_frame", {
            frame: "Login",
            route: "/login",
          });
          assert.isNotTrue(written.result.isError);
          assert.strictEqual(written.result.structuredContent.route, "/login");
          const pages = yield* client["pages.list"]();
          const login = pages.pages.find((p) => p.route === "/login");
          assert.isDefined(login);
          const document = JSON.parse(
            yield* fs.readFileString(path.join(repo, login?.file ?? ""))
          ) as PageDocument;
          assert.deepStrictEqual(document.root.padding, {
            bottom: 32,
            left: 24,
            right: 24,
            top: 32,
          });
          assert.strictEqual(document.root.gap, 16);
          const [title, hero, instance] = document.root.children;
          assert.strictEqual(title?.type, "text");
          assert.strictEqual(hero?.type, "image");
          assert.deepStrictEqual(instance, {
            component: "Button",
            from: decided.from,
            id: instance?.id ?? "",
            name: "Button",
            props: { label: "Sign in", variant: "primary" },
            type: "instance",
            width: "fill",
          });
          // The picture came along, and the frame is sized as in Figma.
          assert.isTrue(
            yield* fs.exists(
              path.join(repo, "designs", "assets", "figma-abababababab.png")
            )
          );
          const canvas = yield* client["canvas.get"]({ canvas: "" });
          assert.deepStrictEqual(canvas.frames["login.page.json"], {
            height: 600,
            preset: "custom",
            width: 400,
            x: 0,
            y: 0,
          });

          // A second write at the same route is refused.
          const again = yield* tool("write_figma_frame", {
            frame: "Login",
            route: "/login",
          });
          assert.isTrue(again.result.isError);
        }),
      30_000
    );

    it.effect(
      "puts an agent's questions to the user, whose answers reach the agent as a prompt",
      () =>
        Effect.gen(function* () {
          const { client, port, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const thread = yield* client["threads.create"]({ agentId: "fake" });
          yield* client["threads.prompt"]({
            attachments: [],
            text: "mcp",
            threadId: thread.id,
          });
          const settled = () =>
            client["threads.items"]({ threadId: thread.id }).pipe(
              Effect.tap(() => Effect.sleep("25 millis")),
              Effect.repeat({
                until: (all) => all.at(-1)?.kind === "turn_end",
              }),
              Effect.timeout("20 seconds")
            );
          const items = yield* settled();
          const said = items
            .map((i) => (i.kind === "agent" ? i.text : ""))
            .find((t) => t.startsWith("mcp:"));
          const [, token = ""] = (said ?? "").slice("mcp:".length).split("|");
          const tool = toolCaller(port, token);

          const asked = yield* tool("ask_user", {
            questions: [
              {
                allowOther: true,
                id: "button",
                options: [
                  { id: "Button", label: "Replace with Button" },
                  { id: "expand", label: "Custom: keep its layers" },
                ],
                question: "What is the Figma component Button?",
              },
            ],
          });
          assert.isNotTrue(asked.result.isError);
          const card = (yield* client["threads.items"]({
            threadId: thread.id,
          })).at(-1);
          assert.strictEqual(card?.kind, "question");
          if (card?.kind !== "question") {
            return;
          }
          assert.isNull(card.answers);

          yield* client["threads.answer"]({
            answers: { button: "Button" },
            itemId: card.id,
            threadId: thread.id,
          });
          const after = yield* settled();
          const answered = after.find((i) => i.id === card.id);
          assert.strictEqual(
            answered?.kind === "question" ? answered.answers?.button : null,
            "Button"
          );
          const prompt = after.find(
            (i) => i.kind === "user" && i.text.startsWith("Answers")
          );
          assert.strictEqual(
            prompt?.kind === "user" ? prompt.text : "",
            "Answers to your questions:\n1. What is the Figma component Button? — Replace with Button [Button]"
          );

          // Answering twice is refused: the agent already heard.
          const twice = yield* Effect.result(
            client["threads.answer"]({
              answers: { button: "expand" },
              itemId: card.id,
              threadId: thread.id,
            })
          );
          assert.strictEqual(twice._tag, "Failure");
        }),
      30_000
    );

    it.effect(
      "turns away a body past the cap that declared no length, without reading it all",
      () =>
        Effect.gen(function* () {
          const { port } = yield* TestEnv;
          const total = MAX_FIG_BYTES * 2;
          const { sent, status } = yield* uploadChunked(port, total);
          // Answered before the client had sent it all; a reset is the server hanging up on it.
          assert.include([413, -1], status);
          assert.isBelow(sent, total);
        })
    );
  }
);
