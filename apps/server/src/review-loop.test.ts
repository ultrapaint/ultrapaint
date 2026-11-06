/**
 * A design's review loop (ADR 0063) against agents the test plays, in-process
 * (`testing/threads.ts`): a design turn that changed a page is reviewed by fresh review models,
 * whose answers become the round's scores; the findings go back to the designer, who fixes or
 * declines them; a model that doesn't answer hands the round on; Stop stops it; the findings log
 * is kept when asked. No editor is open, so the reviewers get the page's document and no picture.
 */
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { ReviewSettings } from "@ultrapaint/contracts/review";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { TestClock } from "effect/testing";
import { STOPPED } from "./services/review/review-loop.ts";
import { REVIEWER_ROLE } from "./services/review/review-prompts.ts";
import { TIMED_OUT, UNREADABLE } from "./services/review/review-rounds.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";
import {
  onThread,
  promptThread,
  ThreadFixture,
  ThreadTest,
  type ThreadTestServices,
  threadTest,
  threadWhen,
} from "./testing/threads.ts";
import { turnEnded } from "./testing/turns.ts";

/** A test on its own thread services, on a project with `settings`. */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>,
  settings?: Partial<Settings>
) =>
  it.effect(name, () =>
    Effect.provide(body(), settings ? threadTest({ settings }) : ThreadTest)
  );

const PAGE = "designs/home.page.json";
const REQUEST = "A calm settings page";

const finding = (title: string) => ({
  category: "spacing",
  fix: "Use the 16px step.",
  problem: "The gap between the groups is uneven.",
  rule: "references/spacing.md › one step between groups",
  severity: "major",
  title,
  where: "the settings groups",
});

/** A review model's answer: its findings, and whether it approves the page. */
const answer = (findings: readonly object[], done: boolean) =>
  `Here is my review.\n\`\`\`json\n${JSON.stringify({
    findings,
    reached: ["content"],
    signOff: { done, left: done ? "" : "Even out the groups." },
  })}\n\`\`\``;

/**
 * A design thread, its review settings `review`, whose first turn wrote `file`: the designer.
 * `purpose` makes it an implement thread.
 */
const designed = Effect.fnUntraced(function* (
  options: {
    readonly file?: string;
    readonly purpose?: "implement";
    readonly review?: ReviewSettings;
  } = {}
) {
  const threads = yield* ThreadSessions;
  const agents = yield* ScriptedAgents;
  const store = yield* ThreadStore;
  const { repo } = yield* ThreadFixture;
  const { id: threadId } = yield* threads.create({
    agentId: "scripted",
    purpose: options.purpose,
  });
  if (options.review) {
    yield* store.update(threadId, { review: options.review });
  }
  yield* promptThread({ attachments: [], text: REQUEST, threadId });
  const designer = yield* agents.next;
  const turn = yield* designer.nextTurn;
  yield* designer.host.writeTextFile({
    content: '{ "root": { "id": "c_1", "type": "main" } }\n',
    path: path.join(repo, options.file ?? PAGE),
    sessionId: turn.sessionId,
  });
  yield* turn.end();
  return { designer, threadId };
});

/** The next review model started, and the prompt it was given. */
const nextReviewer = Effect.gen(function* () {
  const agents = yield* ScriptedAgents;
  const reviewer = yield* agents.next;
  const turn = yield* reviewer.nextTurn;
  return { reviewer, turn };
});

const reviewsOf = (items: readonly ThreadItem[]) =>
  items.flatMap((i) => (i.kind === "review" ? [i] : []));

/** The review is over: its last round says why, and the thread is idle again. */
const reviewEnded = (
  thread: { readonly status: string },
  items: readonly ThreadItem[]
) => reviewsOf(items).at(-1)?.end !== undefined && thread.status === "idle";

describe("a design's review", () => {
  test("starts when a design turn that changed a page ends, the thread reviewing meanwhile", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const { threadId } = yield* designed();
      const { reviewer, turn } = yield* nextReviewer;
      const { items, thread } = yield* threadWhen(
        threadId,
        (t) => t.status === "reviewing"
      );
      assert.strictEqual(thread.status, "reviewing");
      const [round] = reviewsOf(items);
      assert.deepStrictEqual(round?.reviewers, [
        { findings: 0, key: "scripted:fast", name: "Fast", status: "looking" },
      ]);
      // It only looks: no thread to work for, the repository read-only around a directory of its own.
      assert.strictEqual(reviewer.root, repo);
      assert.isDefined(reviewer.writable);
      assert.strictEqual(reviewer.writable, reviewer.tmpDir);
      assert.isFalse(reviewer.writable?.startsWith(repo));
      const said = turn.texts.join("\n");
      assert.include(said, REVIEWER_ROLE);
      assert.include(said, REQUEST);
      assert.include(said, PAGE);
      assert.include(said, "no editor is open to draw it");
      assert.include(said, '"type":"main"');
      yield* turn.say(answer([], true));
      yield* turn.end();
      yield* reviewer.stopped;
    }));

  test("scores the round from the reviewer's answer, and an approval ends it with nothing sent", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed();
      const { turn } = yield* nextReviewer;
      yield* turn.say(answer([finding("Uneven gap")], true));
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, reviewEnded);
      const [round] = reviewsOf(items);
      assert.deepStrictEqual(round?.reviewers, [
        {
          approved: true,
          findings: 1,
          key: "scripted:fast",
          name: "Fast",
          score: 98,
          status: "done",
        },
      ]);
      assert.deepStrictEqual(round?.end, {
        best: 1,
        reason: "approved",
        unmet: [],
      });
      assert.strictEqual(round?.round, 1);
      assert.strictEqual(round?.maxRounds, 6);
      // The designer is asked nothing.
      assert.strictEqual(items.filter((i) => i.kind === "user").length, 1);
    }));

  test("sends the findings to the designer, marked as the round's, and reads what it declined", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed();
      const reviewing = yield* nextReviewer;
      yield* reviewing.turn.say(
        answer([finding("Uneven gap"), finding("Loud title")], false)
      );
      yield* reviewing.turn.end();
      const fixing = yield* designer.nextTurn;
      const asked = fixing.texts.join("\n");
      assert.include(asked, "Uneven gap");
      assert.include(asked, "Loud title");
      assert.include(asked, "Declined: <the finding's title> — <your reason>");
      const sent = yield* threadWhen(threadId, (t) => t.status === "running");
      const [round] = reviewsOf(sent.items);
      const prompt = sent.items.findLast((i) => i.kind === "user");
      assert.strictEqual(
        prompt?.kind === "user" ? prompt.review : undefined,
        round?.id
      );
      yield* fixing.say(
        "Evened the title out.\n\nDeclined: Uneven gap — the grid sets that gap"
      );
      yield* fixing.end();
      // The designer changed no page: the next round looks at the same one again.
      yield* nextReviewer;
      const { items } = yield* threadWhen(
        threadId,
        (_, all) => reviewsOf(all).length === 2
      );
      const [answered, next] = reviewsOf(items);
      assert.strictEqual(answered?.fixed, 1);
      assert.deepStrictEqual(
        answered?.findings.map((f) => [f.title, f.declined, f.reviewer]),
        [
          ["Uneven gap", "the grid sets that gap", "scripted:fast"],
          ["Loud title", undefined, "scripted:fast"],
        ]
      );
      assert.strictEqual(next?.round, 2);
    }));

  test("hands the round on when a review model doesn't answer in 5 minutes", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({
        review: {
          approval: "one",
          eachRound: "one",
          reviewModels: [
            { agentId: "scripted", model: "fast" },
            { agentId: "other", model: "fast" },
          ],
        },
      });
      const silent = yield* nextReviewer;
      assert.strictEqual(silent.reviewer.config.id, "scripted");
      yield* TestClock.adjust("5 minutes");
      yield* silent.reviewer.stopped;
      const standIn = yield* nextReviewer;
      assert.strictEqual(standIn.reviewer.config.id, "other");
      yield* standIn.turn.say(answer([], true));
      yield* standIn.turn.end();
      const { items } = yield* threadWhen(threadId, reviewEnded);
      const [round] = reviewsOf(items);
      assert.deepStrictEqual(
        round?.reviewers.map((r) => [r.key, r.status, r.score, r.reason]),
        [
          ["scripted:fast", "no-score", undefined, TIMED_OUT],
          ["other:fast", "done", 100, undefined],
        ]
      );
      assert.strictEqual(round?.end?.reason, "approved");
    }));

  test("has every review model look before it ends when all are to approve", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({
        review: {
          reviewModels: [
            { agentId: "scripted", model: "fast" },
            { agentId: "other", model: "fast" },
          ],
        },
      });
      const first = yield* nextReviewer;
      yield* first.turn.say(answer([], true));
      yield* first.turn.end();
      // No designer turn between: the same page, by both.
      const closing = [yield* nextReviewer, yield* nextReviewer];
      for (const { turn } of closing) {
        yield* turn.say(answer([], true));
        yield* turn.end();
      }
      const { items } = yield* threadWhen(threadId, reviewEnded);
      const rounds = reviewsOf(items);
      assert.deepStrictEqual(
        rounds.map((r) => [r.round, r.closing, r.reviewers.map((x) => x.key)]),
        [
          [1, undefined, ["scripted:fast"]],
          [2, true, ["scripted:fast", "other:fast"]],
        ]
      );
      assert.isUndefined(rounds[0]?.end);
      assert.strictEqual(rounds[1]?.end?.reason, "approved");
      assert.strictEqual(items.filter((i) => i.kind === "user").length, 1);
    }));

  test("has no score from a model whose answer can't be read, and ends without scores", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed();
      const { turn } = yield* nextReviewer;
      yield* turn.say("Looks great to me!");
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, reviewEnded);
      const [round] = reviewsOf(items);
      assert.strictEqual(round?.reviewers[0]?.reason, UNREADABLE);
      assert.strictEqual(round?.end?.reason, "no-scores");
    }));

  test("ends stopped when the thread is stopped while it reviews", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed();
      const { reviewer } = yield* nextReviewer;
      yield* onThread(threadId, (session) => session.stop);
      yield* reviewer.stopped;
      const { items } = yield* threadWhen(threadId, reviewEnded);
      const [round] = reviewsOf(items);
      assert.deepStrictEqual(round?.end, { reason: "stopped", unmet: [] });
      assert.deepStrictEqual(
        round?.reviewers.map((r) => [r.status, r.reason]),
        [["no-score", STOPPED]]
      );
    }));

  test("keeps the findings log only when it is on", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { home, repo } = yield* ThreadFixture;
      const logFile = path.join(
        home,
        "findings",
        `${path.basename(repo)}.jsonl`
      );
      const off = yield* designed();
      const first = yield* nextReviewer;
      yield* first.turn.say(answer([finding("Uneven gap")], true));
      yield* first.turn.end();
      yield* threadWhen(off.threadId, reviewEnded);
      assert.isFalse(yield* fs.exists(logFile));

      const on = yield* designed({
        file: "designs/settings.page.json",
        review: { findingsLog: true },
      });
      const second = yield* nextReviewer;
      yield* second.turn.say(answer([finding("Uneven gap")], true));
      yield* second.turn.end();
      yield* threadWhen(on.threadId, reviewEnded);
      const lines = (yield* fs.readFileString(logFile)).trim().split("\n");
      assert.strictEqual(lines.length, 1);
      assert.deepInclude(JSON.parse(lines[0] ?? "{}"), {
        designer: { did: "unanswered" },
        page: "designs/settings.page.json",
        project: path.basename(repo),
        reviewer: "scripted:fast",
        round: 1,
        title: "Uneven gap",
      });
    }));
});

describe("no review", () => {
  /** The turn is over and nothing more was started for it: one agent, the designer. */
  const noReview = (threadId: string) =>
    Effect.gen(function* () {
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(reviewsOf(items), []);
      assert.strictEqual(yield* (yield* ScriptedAgents).launched, 1);
    });

  test("when the turn changed no page", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ file: "designs/notes.tsx" });
      yield* noReview(threadId);
    }));

  test("when the design's review is off", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ review: { on: false } });
      yield* noReview(threadId);
    }));

  test(
    "when the project's review is off",
    () =>
      Effect.gen(function* () {
        const { threadId } = yield* designed();
        yield* noReview(threadId);
      }),
    { review: { on: false } }
  );

  test("in an implement thread", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ purpose: "implement" });
      yield* noReview(threadId);
    }));
});
