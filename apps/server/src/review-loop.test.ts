/**
 * A design's review loop (ADR 0063) against agents the test plays, in-process
 * (`testing/threads.ts`): a design turn that changed a page is reviewed by fresh review models,
 * whose answers become the round's scores; the findings go back to the designer, who fixes or
 * declines them; a model that doesn't answer hands the round on; Stop stops it; the findings log
 * is kept when asked. No editor is open, so the reviewers get the page's document and no picture,
 * unless the test plays one: then it draws each page and answers what its checks measured, which
 * go to the designer and never to the reviewers (ADR 0081).
 */
import path from "node:path";
import { assert, describe } from "@effect/vitest";
import type { CreateElicitationRequest } from "@ultrapaint/acp/acp-agent";
import { MAX_ROUNDS, type ReviewSettings } from "@ultrapaint/contracts/review";
import type {
  RenderedFinding,
  ScreenshotRequest,
} from "@ultrapaint/contracts/screenshots";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { Question, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, Fiber, FileSystem, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ProfileService } from "./services/profile.ts";
import { STOPPED } from "./services/review/review-loop.ts";
import {
  REVIEWER_ROLE,
  REVIEWER_RULES,
} from "./services/review/review-prompts.ts";
import { TIMED_OUT, UNREADABLE } from "./services/review/review-rounds.ts";
import { Screenshots } from "./services/screenshots.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { perTest } from "./testing/each-test.ts";
import {
  type LaunchedAgent,
  ScriptedAgents,
} from "./testing/scripted-agents.ts";
import {
  briefingFor,
  onThread,
  promptThread,
  ThreadFixture,
  ThreadTest,
  type ThreadTestServices,
  threadTest,
  threadWhen,
} from "./testing/threads.ts";
import { turnEnded, turnsEnded } from "./testing/turns.ts";

/**
 * A test on its own thread services, on a project with `settings`, on the test clock from
 * `TEST_EPOCH` (docs/TESTING.md rule 3).
 */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>,
  settings?: Partial<Settings>
) =>
  perTest(settings ? threadTest({ settings }) : ThreadTest).effect(name, body);

/**
 * A test whose project has every service, as the composition root builds it: an editor the test
 * plays draws its pages, which the review reads and their documents.
 */
const drawnTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>
) => perTest(threadTest({ fullProject: true })).effect(name, body);

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
 * `purpose` makes it an implement thread. Its page's padding is `padding`, 16 by default, a step
 * of the spacing scale; 13 is off it.
 */
const designed = Effect.fnUntraced(function* (
  options: {
    /** Questions the designer leaves on a card before its turn ends, as one that cannot wait. */
    readonly asking?: readonly Question[];
    readonly file?: string;
    readonly padding?: number;
    readonly purpose?: "implement";
    readonly review?: ReviewSettings;
    readonly skills?: readonly string[];
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
  yield* store.update(threadId, {
    review: options.review,
    skills: options.skills,
  });
  yield* promptThread({ attachments: [], text: REQUEST, threadId });
  const designer = yield* agents.next;
  const turn = yield* designer.nextTurn;
  yield* designer.host.writeTextFile({
    content: `{ "version": 1, "root": { "id": "c_1", "type": "page", "padding": ${options.padding ?? 16}, "children": [] } }\n`,
    path: path.join(repo, options.file ?? PAGE),
    sessionId: turn.sessionId,
  });
  const { asking } = options;
  if (asking) {
    yield* onThread(threadId, (session) => session.cards.ask(asking));
  }
  yield* turn.end();
  return { designer, threadId };
});

/**
 * The person prompts the design thread again, and the designer's turn writes its page with a
 * root of `fields`, as `designed` wrote it, and ends.
 */
const designTurn = Effect.fnUntraced(function* (
  threadId: string,
  designer: LaunchedAgent,
  fields: object
) {
  const { repo } = yield* ThreadFixture;
  yield* promptThread({ attachments: [], text: "Once more", threadId });
  const turn = yield* designer.nextTurn;
  yield* designer.host.writeTextFile({
    content: `${JSON.stringify({ root: { children: [], id: "c_1", type: "page", ...fields }, version: 1 })}\n`,
    path: path.join(repo, PAGE),
    sessionId: turn.sessionId,
  });
  yield* turn.end();
});

/** The next review model started, and the prompt it was given. */
const nextReviewer = Effect.gen(function* () {
  const agents = yield* ScriptedAgents;
  const reviewer = yield* agents.next;
  const turn = yield* reviewer.nextTurn;
  return { reviewer, turn };
});

/**
 * A design whose root's 13px padding the designer declined in the first run, then a prompt of
 * the person's naming the page: its root changed, its spacing as it was declined. Its review
 * model approves. The findings log is kept.
 */
const declinedThenNamed = Effect.gen(function* () {
  const { designer, threadId } = yield* designed({
    padding: 13,
    review: { findingsLog: true },
  });
  const first = yield* nextReviewer;
  yield* first.turn.say(answer([], true));
  yield* first.turn.end();
  const fixing = yield* designer.nextTurn;
  assert.include(
    fixing.texts.join("\n"),
    "1. **Hand-set spacing 13px on c_1**"
  );
  yield* fixing.say("Declined: 1 — the page's own inset");
  yield* fixing.end();
  yield* threadWhen(threadId, turnsEnded(2));
  yield* TestClock.adjust("1 second");
  yield* designTurn(threadId, designer, { name: "Home", padding: 13 });
  const second = yield* nextReviewer;
  yield* second.turn.say(answer([], true));
  yield* second.turn.end();
  return { designer, threadId };
});

const reviewsOf = (items: readonly ThreadItem[]) =>
  items.flatMap((i) => (i.kind === "review" ? [i] : []));

/** The review is over: its last round says why, and the thread is idle again. */
const reviewEnded = (
  thread: { readonly status: string },
  items: readonly ThreadItem[]
) => reviewsOf(items).at(-1)?.end !== undefined && thread.status === "idle";

/** The findings log's lines, as they were written. */
const logged = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { home, repo } = yield* ThreadFixture;
  const text = yield* fs.readFileString(
    path.join(home, "findings", `${path.basename(repo)}.jsonl`)
  );
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
});

describe("a design's review", () => {
  test("runs in a chat that chose no design skill when its own review is on", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({
        review: { on: true },
        skills: [],
      });
      const { reviewer, turn } = yield* nextReviewer;
      yield* threadWhen(threadId, (t) => t.status === "reviewing");
      yield* turn.say(answer([], true));
      yield* turn.end();
      yield* reviewer.stopped;
    }));

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
      // Told the skill's rules, as the lab's told reviewers are (ADR 0077).
      assert.include(said, REVIEWER_RULES);
      assert.include(said, "<rules>");
      // The review's method is the skill's (ADR 0111): its job, its scope and its severities,
      // which the role no longer says of its own.
      assert.include(REVIEWER_RULES, "<review-job>");
      assert.include(
        REVIEWER_RULES,
        "A careful designer would not ship what is drawn"
      );
      assert.include(REVIEWER_RULES, "A second look");
      assert.notInclude(REVIEWER_ROLE, "it fails at its job");
      assert.notInclude(
        REVIEWER_ROLE,
        "asking for more of them makes the design bigger"
      );
      assert.include(said, REQUEST);
      assert.include(said, PAGE);
      assert.include(said, "no editor is open to draw it");
      assert.include(said, '"type":"page"');
      // Nothing the checks measured (ADR 0081).
      assert.notInclude(said, "What the checks measured");
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
      assert.strictEqual(round?.maxRounds, MAX_ROUNDS);
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
      assert.include(asked, "Declined: <the finding's number> — <your reason>");
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

  test("sends the designer only blockers and majors, the minor ones kept in the round", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed();
      const reviewing = yield* nextReviewer;
      yield* reviewing.turn.say(
        answer(
          [
            { ...finding("Tight label"), severity: "minor" },
            finding("Uneven gap"),
          ],
          false
        )
      );
      yield* reviewing.turn.end();
      const fixing = yield* designer.nextTurn;
      const asked = fixing.texts.join("\n");
      assert.include(asked, "Uneven gap");
      assert.notInclude(asked, "Tight label");
      const { items } = yield* threadWhen(
        threadId,
        (t) => t.status === "running"
      );
      assert.deepStrictEqual(
        reviewsOf(items)[0]?.findings.map((f) => [f.title, f.severity]),
        [
          ["Uneven gap", "major"],
          ["Tight label", "minor"],
        ]
      );
    }));

  test("looks a second time at what it sent and new blockers only, then ends at the cap", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed();
      const first = yield* nextReviewer;
      yield* first.turn.say(answer([finding("Uneven gap")], false));
      yield* first.turn.end();
      const fixing = yield* designer.nextTurn;
      yield* fixing.say("Evened the gap out.");
      yield* fixing.end();
      // The second look is told what was sent, and gives back a new major (let go) and the gap.
      const second = yield* nextReviewer;
      assert.include(second.turn.texts.join("\n"), "This is a second look");
      assert.include(second.turn.texts.join("\n"), "Uneven gap");
      yield* second.turn.say(
        answer([finding("Uneven gap"), finding("A new major")], false)
      );
      yield* second.turn.end();
      // At the cap, what is left is sent once more and the review ends.
      const last = yield* designer.nextTurn;
      assert.include(last.texts.join("\n"), "Uneven gap");
      assert.notInclude(last.texts.join("\n"), "A new major");
      const { items } = yield* threadWhen(
        threadId,
        (_, all) => reviewsOf(all)[1]?.end !== undefined
      );
      assert.strictEqual(reviewsOf(items)[1]?.end?.reason, "max-rounds");
      assert.deepStrictEqual(
        reviewsOf(items)[1]?.findings.map((f) => f.title),
        ["Uneven gap"]
      );
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

  test("is stopped by a queued prompt sent now, which goes to the designer instead (ADR 0137)", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const { designer, threadId } = yield* designed();
      const { reviewer } = yield* nextReviewer;
      yield* threadWhen(threadId, (t) => t.status === "reviewing");
      yield* promptThread({
        attachments: [],
        text: "Make the title smaller",
        threadId,
      });
      const id = (yield* store.get(threadId))?.queued?.[0]?.id ?? "";
      yield* onThread(threadId, (session) => session.sendNow(id));
      yield* reviewer.stopped;
      const fixing = yield* designer.nextTurn;
      assert.include(fixing.texts, "Make the title smaller");
      const { items, thread } = yield* threadWhen(
        threadId,
        (t) => t.status === "running"
      );
      assert.deepStrictEqual(thread.queued ?? [], []);
      assert.deepStrictEqual(reviewsOf(items).at(-1)?.end, {
        reason: "stopped",
        unmet: [],
      });
    }));

  test("stopped by the person, leaves what is queued waiting for them, an edit finished included (ADR 0137)", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const { threadId } = yield* designed();
      const { reviewer } = yield* nextReviewer;
      yield* threadWhen(threadId, (t) => t.status === "reviewing");
      yield* promptThread({
        attachments: [],
        text: "Then the footer",
        threadId,
      });
      const id = (yield* store.get(threadId))?.queued?.[0]?.id ?? "";
      yield* onThread(threadId, (session) => session.stop);
      yield* reviewer.stopped;
      yield* threadWhen(threadId, reviewEnded);
      yield* onThread(threadId, (session) =>
        session.editQueued(id, { action: "start" })
      );
      yield* onThread(threadId, (session) =>
        session.editQueued(id, { action: "cancel" })
      );
      const thread = yield* store.get(threadId);
      assert.strictEqual(thread?.status, "idle");
      assert.deepStrictEqual(
        thread?.queued?.map((q) => q.text),
        ["Then the footer"]
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

  /** A design whose first round sent "Uneven gap" to the designer, the findings log kept. */
  const sentToDesigner = Effect.gen(function* () {
    const { designer, threadId } = yield* designed({
      review: { findingsLog: true },
    });
    const reviewing = yield* nextReviewer;
    yield* reviewing.turn.say(answer([finding("Uneven gap")], false));
    yield* reviewing.turn.end();
    return { designer, fixing: yield* designer.nextTurn, threadId };
  });

  test("logs findings as unanswered when their thread is deleted before the designer answers", () =>
    Effect.gen(function* () {
      const { threadId } = yield* sentToDesigner;
      yield* (yield* ThreadSessions).delete(threadId);
      const lines = yield* logged;
      assert.strictEqual(lines.length, 1);
      assert.deepInclude(lines[0], {
        designer: { did: "unanswered" },
        round: 1,
        title: "Uneven gap",
      });
    }));

  test("logs findings as unanswered when the turn that answers them fails", () =>
    Effect.gen(function* () {
      const { designer, fixing, threadId } = yield* sentToDesigner;
      yield* fixing.fail("usage limit reached");
      yield* threadWhen(threadId, (t) => t.status === "error");
      // The person's next prompt starts another run: nothing answers that round any more.
      yield* promptThread({ attachments: [], text: "again", threadId });
      yield* Effect.andThen(designer.nextTurn, (t) => t.end());
      yield* threadWhen(threadId, turnEnded);
      const lines = yield* logged;
      assert.strictEqual(lines.length, 1);
      assert.deepInclude(lines[0], {
        designer: { did: "unanswered" },
        round: 1,
        title: "Uneven gap",
      });
    }));

  test("keeps the findings when the person keeps them, whatever the project says", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { home, repo } = yield* ThreadFixture;
      yield* (yield* ProfileService).set({ keepFindings: true });
      const logFile = path.join(
        home,
        "findings",
        `${path.basename(repo)}.jsonl`
      );
      const kept = yield* designed();
      const reviewer = yield* nextReviewer;
      yield* reviewer.turn.say(answer([finding("Uneven gap")], true));
      yield* reviewer.turn.end();
      yield* threadWhen(kept.threadId, reviewEnded);
      assert.isTrue(yield* fs.exists(logFile));
    }));
});

/** A 1×1 PNG, as an editor would deliver it. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * An editor open on the project, which draws every picture it is asked for and answers with
 * `findings`, what its checks measured on it (none: an editor that does not measure); open once
 * the screenshots count it. Gives the requests it was asked.
 */
const anEditor = (findings?: readonly RenderedFinding[]) =>
  Effect.gen(function* () {
    const screenshots = yield* Screenshots;
    const asked = yield* Ref.make<readonly ScreenshotRequest[]>([]);
    yield* screenshots.requests.pipe(
      Stream.runForEach((request) =>
        Effect.andThen(
          Ref.update(asked, (all) => [...all, request]),
          screenshots.deliver({
            dataUrl: `data:image/png;base64,${PNG}`,
            requestId: request.requestId,
            ...(findings !== undefined && { findings }),
          })
        )
      ),
      Effect.forkScoped
    );
    yield* Stream.runHead(Stream.filter(screenshots.editors, (n) => n > 0));
    return asked;
  });

/** The Components panel's two groups, 27px apart over rows 10px apart: under 3×. */
const GROUPS: RenderedFinding = {
  above: "App components",
  below: "System components",
  between: 27,
  box: { height: 287, width: 200, x: 0, y: 259 },
  kind: "groups-apart",
  ratio: 3,
  within: 10,
};

/** The Files list's filled rows, touching. */
const TOUCHING: RenderedFinding = {
  box: { height: 112, width: 240, x: 8, y: 40 },
  kind: "touching-rows",
  list: "Files",
  rowHeight: 28,
};

describe("a question left for the designer (ADR 0151)", () => {
  const QUESTIONS: readonly Question[] = [
    {
      id: "sidebar",
      options: [
        { id: "keep", label: "Keep it" },
        { id: "fold", label: "Fold it" },
      ],
      question: "Should the sidebar stay?",
    },
  ];
  const PRICING = "designs/pricing.page.json";

  /** The designer's next turn draws `file`, then ends. */
  const draws = Effect.fnUntraced(function* (
    designer: Effect.Success<ReturnType<typeof designed>>["designer"],
    file: string
  ) {
    const { repo } = yield* ThreadFixture;
    const turn = yield* designer.nextTurn;
    yield* designer.host.writeTextFile({
      content: `{ "version": 1, "root": { "id": "c_1", "type": "page", "padding": 16, "children": [] } }\n`,
      path: path.join(repo, file),
      sessionId: turn.sessionId,
    });
    yield* turn.end();
    return turn;
  });

  /** The card the designer's turn left open, once that turn has ended. */
  const heldCard = Effect.fnUntraced(function* (threadId: string) {
    const { items } = yield* threadWhen(threadId, turnEnded);
    const card = items.findLast((i) => i.kind === "question");
    assert.isDefined(card);
    return card?.id ?? "";
  });

  test("holds the round while it waits, and nothing but a turn's end starts it", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ asking: QUESTIONS });
      const card = yield* heldCard(threadId);
      // Not time, and not the card: one no agent waits on has no decline (ADR 0074, 0125).
      yield* TestClock.adjust("1 hour");
      const declined = yield* Effect.flip(
        onThread(threadId, (s) => s.cards.decline(card))
      );
      assert.strictEqual(declined._tag, "NotFound");
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(reviewsOf(items), []);
      assert.strictEqual(yield* (yield* ScriptedAgents).launched, 1);
    }));

  test("reviews the turn its answers began, with both turns' pages", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed({ asking: QUESTIONS });
      const card = yield* heldCard(threadId);
      yield* onThread(threadId, (s) => s.answer(card, { sidebar: "fold" }));
      const answering = yield* draws(designer, PRICING);
      assert.include(answering.texts.join("\n"), "Fold it");
      const { turn } = yield* nextReviewer;
      const said = turn.texts.join("\n");
      assert.include(said, PAGE);
      assert.include(said, PRICING);
    }));

  test("holds nothing once the person sends a different prompt: its turn's round has both turns' pages", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed({ asking: QUESTIONS });
      yield* heldCard(threadId);
      yield* promptThread({
        attachments: [],
        text: "Add a pricing page",
        threadId,
      });
      yield* draws(designer, PRICING);
      const { turn } = yield* nextReviewer;
      const said = turn.texts.join("\n");
      assert.include(said, PAGE);
      assert.include(said, PRICING);
    }));
});

describe("a decline put to the person (ADR 0157)", () => {
  /** The question a designer that cannot wait leaves on a card for a decline. */
  const KEEP_GAP: readonly Question[] = [
    {
      id: "gap",
      options: [
        { id: "keep", label: "Keep it as it is: the grid sets that gap" },
        { id: "fix", label: "Use the 16px step" },
      ],
      question: "Uneven gap: keep it, or even it out?",
    },
  ];

  /** The form a designer that waits within its turn asks about the second finding. */
  const keepForm = (sessionId: string) =>
    ({
      message: "Loud title",
      mode: "form",
      requestedSchema: {
        properties: {
          title: {
            oneOf: [
              { const: "keep", title: "Keep it as it is: they want it loud" },
              { const: "fix", title: "Quiet the title" },
            ],
            title: "Loud title: keep it, or quiet it?",
            type: "string",
          },
        },
        required: ["title"],
        type: "object",
      },
      sessionId,
    }) as CreateElicitationRequest;

  /** A first round of the review models' findings `titles`, sent to the designer: its turn. */
  const sentFindings = Effect.fnUntraced(function* (
    designer: Effect.Success<ReturnType<typeof designed>>["designer"],
    titles: readonly string[]
  ) {
    const reviewing = yield* nextReviewer;
    yield* reviewing.turn.say(answer(titles.map(finding), false));
    yield* reviewing.turn.end();
    return yield* designer.nextTurn;
  });

  test("tells the designer to ask the person first of a decline the page would show, its call suggested", () =>
    Effect.gen(function* () {
      const { designer } = yield* designed();
      const told = (yield* sentFindings(designer, ["Uneven gap"])).texts.join(
        "\n"
      );
      // Without the editor's tools, on the agent's own question tool.
      assert.include(told, "ask them with your own question tool");
      assert.include(told, '"Keep it as it is: <your reason>"');
      assert.include(told, "then the fix");
      assert.include(told, "or do what they wrote instead");
      assert.include(told, "a finding the design already meets");
      assert.include(
        told,
        "Declined by the user: <the finding's number> — <the reason>"
      );
      assert.include(told, "your reply says they haven't answered");
    }));

  test("keeps a decline the person kept when asked as theirs, on the round and in the findings log", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed({
        review: { findingsLog: true },
      });
      const fixing = yield* sentFindings(designer, [
        "Uneven gap",
        "Loud title",
      ]);
      // It waits on its question within the turn, and the person keeps its call.
      const reply = yield* Effect.forkChild(
        fixing.elicit(keepForm(fixing.sessionId))
      );
      const { items: asking } = yield* threadWhen(threadId, (_, all) =>
        all.some((i) => i.kind === "question")
      );
      const card = asking.findLast((i) => i.kind === "question");
      yield* onThread(threadId, (s) =>
        s.answer(card?.id ?? "", { title: "keep" })
      );
      yield* Fiber.join(reply);
      yield* fixing.say(
        "Declined: 1 — the grid sets that gap\nDeclined by the user: 2 — they want it loud"
      );
      yield* fixing.end();
      yield* nextReviewer;
      const { items } = yield* threadWhen(
        threadId,
        (_, all) => reviewsOf(all).length === 2
      );
      assert.deepStrictEqual(
        reviewsOf(items)[0]?.findings.map((f) => [
          f.title,
          f.declined,
          f.decidedBy,
        ]),
        [
          ["Uneven gap", "the grid sets that gap", undefined],
          ["Loud title", "they want it loud", "person"],
        ]
      );
      const lines = yield* logged;
      assert.deepStrictEqual(
        lines.map((l) => [l.title, l.designer]),
        [
          ["Uneven gap", { did: "declined", reason: "the grid sets that gap" }],
          [
            "Loud title",
            {
              decidedBy: "person",
              did: "declined",
              reason: "they want it loud",
            },
          ],
        ]
      );
    }));

  test("holds the next round until the turn the answers begin ends, for a findings reply that left its questions on a card", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const { designer, threadId } = yield* designed();
      const fixing = yield* sentFindings(designer, ["Uneven gap"]);
      yield* onThread(threadId, (s) => s.cards.ask(KEEP_GAP));
      yield* fixing.say("Declined: 1 — the grid sets that gap");
      yield* fixing.end();
      const { items } = yield* threadWhen(threadId, turnsEnded(2));
      assert.strictEqual(reviewsOf(items).length, 1);
      assert.strictEqual(yield* (yield* ScriptedAgents).launched, 2);
      const card = items.findLast((i) => i.kind === "question");
      yield* onThread(threadId, (s) =>
        s.answer(card?.id ?? "", { gap: "fix" })
      );
      const answering = yield* designer.nextTurn;
      assert.include(answering.texts.join("\n"), "Use the 16px step");
      yield* designer.host.writeTextFile({
        content: `{ "version": 1, "root": { "id": "c_1", "type": "page", "padding": 16, "gap": 16, "children": [] } }\n`,
        path: path.join(repo, PAGE),
        sessionId: answering.sessionId,
      });
      yield* answering.end();
      // The round after the answers' turn judges the design they produced.
      const { turn } = yield* nextReviewer;
      assert.include(turn.texts.join("\n"), '"gap":16');
    }));

  perTest(threadTest({ mcp: true })).effect(
    "names the editor's question tool to a designer that has its tools",
    () =>
      Effect.gen(function* () {
        const { designer } = yield* designed();
        const fixing = yield* sentFindings(designer, ["Uneven gap"]);
        assert.include(
          fixing.texts.join("\n"),
          "ask them with ask_user, one question per finding"
        );
      })
  );
});

describe("the checks' findings", () => {
  drawnTest(
    "go to the designer after the reviewers', each marked as a check's with what it measured",
    () =>
      Effect.gen(function* () {
        yield* anEditor([GROUPS, TOUCHING]);
        const { designer } = yield* designed({ padding: 13 });
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([finding("Loud title")], false));
        yield* reviewing.turn.end();
        const told = (yield* designer.nextTurn).texts.join("\n");
        assert.include(
          told,
          "1. **Loud title** (the settings groups; spacing, major)"
        );
        assert.include(
          told,
          "2. **“System components” too close to “App components”** (“App components” and “System components”; a check's, spacing): groups: 27px between “App components” and “System components”, 10px between the lines below: under 3×"
        );
        assert.include(
          told,
          "3. **Rows touching in “Files”** (the rows of “Files”; a check's, spacing): touching rows: rows of 28px"
        );
        assert.include(
          told,
          "4. **Hand-set spacing 13px on c_1** (c_1 (`padding`); a check's, spacing): off the system: 13px spacing, 1 place"
        );
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "are measured on the review's picture and shown to no reviewer",
    () =>
      Effect.gen(function* () {
        const asked = yield* anEditor([GROUPS, TOUCHING]);
        yield* designed({ padding: 13 });
        const reviewing = yield* nextReviewer;
        const shown = reviewing.turn.texts.join("\n");
        for (const measured of [
          "App components",
          "Files",
          "27px",
          "off the system",
          "What the checks measured",
        ]) {
          assert.notInclude(shown, measured);
        }
        assert.deepStrictEqual(
          (yield* Ref.get(asked)).map((r) => r.checks),
          [true]
        );
        yield* reviewing.turn.say(answer([], true));
        yield* reviewing.turn.end();
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "are sent alone when the reviewers approve, the review still ending approved",
    () =>
      Effect.gen(function* () {
        yield* anEditor([TOUCHING]);
        const { designer, threadId } = yield* designed();
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([], true));
        yield* reviewing.turn.end();
        const fixing = yield* designer.nextTurn;
        const told = fixing.texts.join("\n");
        assert.include(told, "is over");
        assert.include(told, "1. **Rows touching in “Files”**");
        yield* fixing.end();
        const { items } = yield* threadWhen(threadId, turnsEnded(2));
        const rounds = reviewsOf(items);
        assert.strictEqual(rounds.length, 1);
        assert.strictEqual(rounds[0]?.end?.reason, "approved");
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "ask the person nothing of them, only a review model's finding is (ADR 0157)",
    () =>
      Effect.gen(function* () {
        yield* anEditor([TOUCHING]);
        const { designer } = yield* designed();
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([], true));
        yield* reviewing.turn.end();
        const told = (yield* designer.nextTurn).texts.join("\n");
        assert.include(told, "Rows touching");
        assert.notInclude(told, "question tool");
        assert.notInclude(told, "Declined by the user");
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "keep a decline on the round and in the findings log with the check's kind",
    () =>
      Effect.gen(function* () {
        yield* anEditor([TOUCHING]);
        const { designer, threadId } = yield* designed({
          review: { findingsLog: true },
        });
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([], true));
        yield* reviewing.turn.end();
        const fixing = yield* designer.nextTurn;
        yield* fixing.say(
          "Declined: Rows touching in “Files” — the rows are one strip by design"
        );
        yield* fixing.end();
        const { items } = yield* threadWhen(threadId, turnsEnded(2));
        assert.deepStrictEqual(
          reviewsOf(items)[0]?.findings.map((f) => [
            f.title,
            f.check,
            f.reviewer,
            f.severity,
            f.declined,
          ]),
          [
            [
              "Rows touching in “Files”",
              "touching-rows",
              "check",
              "minor",
              "the rows are one strip by design",
            ],
          ]
        );
        const lines = yield* logged;
        assert.strictEqual(lines.length, 1);
        assert.deepInclude(lines[0], {
          check: "touching-rows",
          designer: {
            did: "declined",
            reason: "the rows are one strip by design",
          },
          title: "Rows touching in “Files”",
        });
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "log a reviewer's minor finding left beside them as not asked about, not as fixed",
    () =>
      Effect.gen(function* () {
        yield* anEditor([TOUCHING]);
        const { designer, threadId } = yield* designed({
          review: { findingsLog: true },
        });
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(
          answer(
            [{ ...finding("Caption a touch large"), severity: "minor" }],
            true
          )
        );
        yield* reviewing.turn.end();
        const fixing = yield* designer.nextTurn;
        assert.notInclude(fixing.texts.join("\n"), "Caption a touch large");
        yield* fixing.end();
        yield* threadWhen(threadId, turnsEnded(2));
        const lines = yield* logged;
        assert.deepStrictEqual(
          lines.map((l) => [l.title, l.designer]),
          [
            ["Caption a touch large", { did: "unanswered" }],
            ["Rows touching in “Files”", { did: "fixed" }],
          ]
        );
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "leave a design approved with a declined one left, which is not sent again",
    () =>
      Effect.gen(function* () {
        yield* anEditor([TOUCHING]);
        const { designer, threadId } = yield* designed();
        const first = yield* nextReviewer;
        yield* first.turn.say(answer([finding("Uneven gap")], false));
        yield* first.turn.end();
        const fixing = yield* designer.nextTurn;
        yield* fixing.say(
          "Evened the gap.\n\nDeclined: Rows touching in “Files” — one strip by design"
        );
        yield* fixing.end();
        const second = yield* nextReviewer;
        yield* second.turn.say(answer([], true));
        yield* second.turn.end();
        const { items } = yield* threadWhen(threadId, reviewEnded);
        const rounds = reviewsOf(items);
        assert.strictEqual(rounds[1]?.end?.reason, "approved");
        // Listed in the round as the decline it was, carried, and not sent.
        assert.deepStrictEqual(
          rounds[1]?.findings.map((f) => [f.title, f.declined, f.carried]),
          [["Rows touching in “Files”", "one strip by design", true]]
        );
        // The person's request and the first round's findings: nothing more is asked.
        assert.strictEqual(items.filter((i) => i.kind === "user").length, 2);
      }).pipe(Effect.scoped)
  );

  test("hold a finding declined in one of the thread's runs back from the next, carried in its round", () =>
    Effect.gen(function* () {
      const { threadId } = yield* declinedThenNamed;
      const { items } = yield* threadWhen(
        threadId,
        (t, all) => reviewsOf(all).length === 2 && reviewEnded(t, all)
      );
      assert.strictEqual(reviewsOf(items)[1]?.end?.reason, "approved");
      assert.deepStrictEqual(
        reviewsOf(items)[1]?.findings.map((f) => [
          f.title,
          f.declined,
          f.carried,
        ]),
        [["Hand-set spacing 13px on c_1", "the page's own inset", true]]
      );
      // Two prompts of the person's and the first round's findings: nothing more is asked.
      assert.strictEqual(items.filter((i) => i.kind === "user").length, 3);
    }));

  test("log a decline carried into a later run once, with its kind", () =>
    Effect.gen(function* () {
      const { threadId } = yield* declinedThenNamed;
      yield* threadWhen(
        threadId,
        (t, all) => reviewsOf(all).length === 2 && reviewEnded(t, all)
      );
      assert.deepStrictEqual(
        (yield* logged).map((l) => [l.check, l.designer]),
        [["off-system", { did: "declined", reason: "the page's own inset" }]]
      );
    }));

  test("send a finding declined before again once its node has another value of its kind", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* declinedThenNamed;
      yield* threadWhen(
        threadId,
        (t, all) => reviewsOf(all).length === 2 && reviewEnded(t, all)
      );
      // A wider inset is another value on the node: the finding comes back.
      yield* TestClock.adjust("1 second");
      yield* designTurn(threadId, designer, { name: "Home", padding: 15 });
      const third = yield* nextReviewer;
      yield* third.turn.say(answer([], true));
      yield* third.turn.end();
      assert.include(
        (yield* designer.nextTurn).texts.join("\n"),
        "1. **Hand-set spacing 15px on Home**"
      );
    }));

  test("read only the nodes the turn changed on a page made before it", () =>
    Effect.gen(function* () {
      const { designer, threadId } = yield* designed({ padding: 13 });
      const first = yield* nextReviewer;
      yield* first.turn.say(answer([], true));
      yield* first.turn.end();
      yield* Effect.andThen(designer.nextTurn, (t) => t.end());
      yield* threadWhen(threadId, turnsEnded(2));
      yield* TestClock.adjust("1 second");
      // A footer added, its text size set by hand; the root's 13px left as it was.
      yield* designTurn(threadId, designer, {
        children: [
          {
            id: "c_2",
            name: "Footer",
            role: "paragraph",
            size: 15,
            text: "Made with care",
            type: "text",
          },
        ],
        padding: 13,
      });
      const second = yield* nextReviewer;
      yield* second.turn.say(answer([], true));
      yield* second.turn.end();
      const told = (yield* designer.nextTurn).texts.join("\n");
      assert.include(told, "1. **Hand-set text size 15px on Footer**");
      assert.notInclude(told, "13px");
    }));

  drawnTest("go nowhere when no review model could score the design", () =>
    Effect.gen(function* () {
      yield* anEditor([TOUCHING]);
      const { threadId } = yield* designed();
      const reviewing = yield* nextReviewer;
      yield* reviewing.turn.say("Looks great to me!");
      yield* reviewing.turn.end();
      const { items } = yield* threadWhen(threadId, reviewEnded);
      assert.strictEqual(reviewsOf(items)[0]?.end?.reason, "no-scores");
      assert.strictEqual(items.filter((i) => i.kind === "user").length, 1);
    }).pipe(Effect.scoped)
  );

  drawnTest(
    "leave the round as it was when the editor answers with no findings: the reviewers' and the document's go on",
    () =>
      Effect.gen(function* () {
        yield* anEditor();
        const { designer } = yield* designed({ padding: 13 });
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([finding("Uneven gap")], false));
        yield* reviewing.turn.end();
        const told = (yield* designer.nextTurn).texts.join("\n");
        assert.include(told, "1. **Uneven gap**");
        assert.include(told, "2. **Hand-set spacing 13px on c_1**");
        assert.notInclude(told, "3. ");
      }).pipe(Effect.scoped)
  );

  drawnTest(
    "are none on a page with neither fault: an approval asks the designer nothing",
    () =>
      Effect.gen(function* () {
        yield* anEditor([]);
        const { threadId } = yield* designed();
        const reviewing = yield* nextReviewer;
        yield* reviewing.turn.say(answer([], true));
        yield* reviewing.turn.end();
        const { items } = yield* threadWhen(threadId, reviewEnded);
        assert.strictEqual(reviewsOf(items)[0]?.end?.reason, "approved");
        assert.deepStrictEqual(reviewsOf(items)[0]?.findings, []);
        assert.strictEqual(items.filter((i) => i.kind === "user").length, 1);
      }).pipe(Effect.scoped)
  );
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

  test("in a chat that chose no design skill", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ skills: [] });
      yield* noReview(threadId);
    }));

  test("in an implement thread", () =>
    Effect.gen(function* () {
      const { threadId } = yield* designed({ purpose: "implement" });
      yield* noReview(threadId);
    }));

  /** What the designer of a new thread, its review settings `review`, is briefed with. */
  const briefed = Effect.fnUntraced(function* (review?: ReviewSettings) {
    const threads = yield* ThreadSessions;
    const agents = yield* ScriptedAgents;
    const store = yield* ThreadStore;
    const { id: threadId } = yield* threads.create({ agentId: "scripted" });
    if (review) {
      yield* store.update(threadId, { review });
    }
    yield* promptThread({ attachments: [], text: REQUEST, threadId });
    const turn = yield* Effect.flatMap(agents.next, (a) => a.nextTurn);
    return turn.texts[0];
  });

  test("is announced to a designer whose review is off", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* briefed(), briefingFor("design"));
      assert.strictEqual(
        yield* briefed({ on: false }),
        briefingFor("design", false, false)
      );
    }));

  test(
    "is announced to a designer when the project's review is off, unless its own is on",
    () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* briefed(),
          briefingFor("design", false, false)
        );
        assert.strictEqual(yield* briefed({ on: true }), briefingFor("design"));
      }),
    { review: { on: false } }
  );
});
