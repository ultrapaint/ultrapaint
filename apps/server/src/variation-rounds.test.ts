/**
 * A turn of variations (ADR 0098) against an agent the test plays, on a project of its own: the
 * server makes the working copies before the turn and names them in the task; the agent changes
 * a copy and hands it in by renaming it, or leaves it, and ends its turn.
 */
import path from "node:path";
import { assert, it } from "@effect/vitest";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { findNode } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem, type Layer, type Scope } from "effect";
import { OpenProject, type ProjectServices } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { EditorTools } from "./services/mcp/route.ts";
import { PagesService } from "./services/pages.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { VariationRounds } from "./services/variation-rounds.ts";
import { VariationsService } from "./services/variations.ts";
import { callTool, ProjectFixture, ProjectTest } from "./testing/project.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";
import { promptThread, threadWhen } from "./testing/threads.ts";
import { turnEnded } from "./testing/turns.ts";

const HOME = "home.page.json";
const COPY_RE = /^\d+\. (designs\/\.working-copies\/\S+)$/gm;

const textOf = (root: DesignNode | null, id: string) => {
  const node = findNode(root, id);
  return node?.type === "text" ? node.text : undefined;
};

/** A test on a project of its own, its services and its threads, the agent played by the test. */
const inProject = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof ProjectTest>> | Scope.Scope
  >
) =>
  it.effect(name, () =>
    body().pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

/** What the open project's services answer. */
const inProjectOf = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(OpenProject, (project) => project.use(effect));

/**
 * Two takes on the home page's heading asked for in a new chat: the agent's turn, and the
 * working copies its task names.
 */
const variationsTurn = Effect.gen(function* () {
  const threads = yield* ThreadSessions;
  const agents = yield* ScriptedAgents;
  const { id: threadId } = yield* threads.create();
  yield* promptThread({
    attachments: [],
    text: `/variations ${HOME}#heading 2 the tone`,
    threadId,
  });
  const agent = yield* agents.next;
  const turn = yield* agent.nextTurn;
  const task = turn.texts.join("\n");
  const copies = [...task.matchAll(COPY_RE)].map((m) => m[1] ?? "");
  return { agent, copies, task, threadId, turn };
});

/** The agent's take in a copy: the heading's words changed, then the copy named. */
const handIn = Effect.fnUntraced(function* (
  copy: string,
  threadId: string,
  words: string,
  name: string
) {
  yield* callTool(
    EditorTools,
    "apply_operations",
    {
      ops: [{ id: "heading", op: "update", set: { text: words } }],
      route: copy,
    },
    threadId
  );
  yield* callTool(EditorTools, "rename_page", { name, route: copy }, threadId);
});

const exists = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const { repo } = yield* ProjectFixture;
  return yield* fs.exists(path.join(repo, file));
});

inProject(
  "the task names a working copy per take, made before the turn, and none is a page of the canvas",
  () =>
    Effect.gen(function* () {
      const { copies, task } = yield* variationsTurn;
      assert.strictEqual(copies.length, 2);
      assert.include(task, "What should vary: the tone");
      for (const copy of copies) {
        assert.isTrue(yield* exists(copy));
      }
      const listed = yield* inProjectOf(
        Effect.flatMap(PagesService, (p) => p.list)
      );
      assert.deepStrictEqual(
        listed.pages.map((p) => p.file),
        ["designs/home.page.json"]
      );
    })
);

inProject(
  "a take's working copy makes no component, which would stay placed nowhere if the take went (UP-230)",
  () =>
    Effect.gen(function* () {
      const { copies, threadId } = yield* variationsTurn;
      const refused = yield* Effect.flip(
        callTool(
          EditorTools,
          "apply_operations",
          {
            ops: [{ ids: ["heading"], name: "Title", op: "makeComponent" }],
            route: copies[0] ?? "",
          },
          threadId
        )
      );
      assert.include(
        refused.message,
        "makeComponent works on a page, not a take's working copy"
      );
      assert.isFalse(yield* exists("designs/components/Title.component.json"));
    })
);

inProject(
  "a take handed in is saved into the set by the name the agent gave it, the page as it was, its copy gone",
  () =>
    Effect.gen(function* () {
      const { copies, threadId } = yield* variationsTurn;
      const [first = ""] = copies;
      yield* handIn(
        first,
        threadId,
        "Hello, friend",
        "Warm · Tone of the copy"
      );
      assert.isFalse(yield* exists(first));
      const sets = yield* inProjectOf(
        Effect.flatMap(VariationsService, (v) => v.sets(HOME))
      );
      assert.strictEqual(sets.heading?.inUse, "original");
      assert.deepStrictEqual(
        sets.heading?.variations.map((v) => [
          v.name,
          v.varied,
          textOf(v.tree ?? null, "heading"),
        ]),
        [
          ["Original", undefined, undefined],
          ["Warm", "Tone of the copy", "Hello, friend"],
        ]
      );
      const page = yield* inProjectOf(
        Effect.flatMap(DocumentService, (d) => d.get(HOME))
      );
      assert.strictEqual(textOf(page.root, "heading"), "Hello");
    })
);

inProject(
  "the agent's edits of its copies are no undo steps: the take saved is one",
  () =>
    Effect.gen(function* () {
      const { copies, threadId } = yield* variationsTurn;
      yield* handIn(copies[0] ?? "", threadId, "Hello, friend", "Warm");
      const undo = yield* inProjectOf(
        Effect.flatMap(EditService, (e) => e.state)
      );
      assert.strictEqual(undo.undoLabel, "Variation “Warm”");
    })
);

inProject(
  "a copy still unnamed when the turn ends fails, its copy removed, and the chat says so",
  () =>
    Effect.gen(function* () {
      const { copies, threadId, turn } = yield* variationsTurn;
      const [first = "", second = ""] = copies;
      yield* handIn(first, threadId, "Hello, friend", "Warm");
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.isFalse(yield* exists(second));
      assert.isTrue(
        items.some(
          (i) =>
            i.kind === "status" &&
            i.text.startsWith("1 of 2 variations did not come back")
        )
      );
      const rounds = yield* inProjectOf(
        Effect.flatMap(VariationRounds, (r) => r.list)
      );
      assert.deepStrictEqual(
        rounds.map((r) => r.takes.map((t) => t.state)),
        [["handedIn", "failed"]]
      );
    })
);

inProject("a turn of variations is never reviewed", () =>
  Effect.gen(function* () {
    const { agent, threadId, turn } = yield* variationsTurn;
    const { repo } = yield* ProjectFixture;
    // A page the turn wrote would be reviewed on any other turn.
    yield* agent.host.writeTextFile({
      content:
        '{ "version": 1, "root": { "id": "c_1", "type": "page", "children": [] } }\n',
      path: path.join(repo, "designs/extra.page.json"),
      sessionId: turn.sessionId,
    });
    yield* turn.end();
    const { items, thread } = yield* threadWhen(threadId, turnEnded);
    assert.strictEqual(thread.status, "idle");
    assert.isFalse(items.some((i) => i.kind === "review"));
  })
);

inProject("a copy renamed twice at once is handed in once", () =>
  Effect.gen(function* () {
    const { copies, threadId } = yield* variationsTurn;
    const [first = ""] = copies;
    const rename = (name: string) =>
      Effect.exit(
        callTool(EditorTools, "rename_page", { name, route: first }, threadId)
      );
    const exits = yield* Effect.all([rename("Warm"), rename("Cool")], {
      concurrency: "unbounded",
    });
    assert.strictEqual(exits.filter((e) => e._tag === "Success").length, 1);
    const sets = yield* inProjectOf(
      Effect.flatMap(VariationsService, (v) => v.sets(HOME))
    );
    assert.strictEqual(sets.heading?.variations.length, 2);
  })
);

inProject(
  "a turn of variations queued after a design turn starts no review of what that turn changed",
  () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const { repo } = yield* ProjectFixture;
      const { id: threadId } = yield* threads.create();
      yield* promptThread({ attachments: [], text: "A calmer home", threadId });
      const agent = yield* agents.next;
      const design = yield* agent.nextTurn;
      yield* agent.host.writeTextFile({
        content:
          '{ "version": 1, "root": { "id": "c_1", "type": "page", "children": [] } }\n',
        path: path.join(repo, "designs/extra.page.json"),
        sessionId: design.sessionId,
      });
      // Asked while the design turn runs: it waits in the queue, and the review with it.
      yield* promptThread({
        attachments: [],
        text: `/variations ${HOME}#heading 2`,
        threadId,
      });
      yield* design.end();
      const variations = yield* agent.nextTurn;
      yield* variations.end();
      const { items, thread } = yield* threadWhen(
        threadId,
        (t, all) =>
          turnEnded(t, all) &&
          all.filter((i) => i.kind === "turn_end").length === 2
      );
      assert.strictEqual(thread.status, "idle");
      assert.isFalse(items.some((i) => i.kind === "review"));
    })
);
