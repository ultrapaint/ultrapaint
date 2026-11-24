/**
 * A thread against an agent that replays what a real one did (`testing/replay-agents.ts`): the
 * editor's side of ACP, the SDK included, must send what the transcript says it sent, and hears
 * what the agent answered. The transcripts are under `testing/transcripts/`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe } from "@effect/vitest";
import type { ReplayAgent } from "@ultrapaint/acp/replay-agent";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect } from "effect";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { perTest } from "./testing/each-test.ts";
import { ReplayAgents } from "./testing/replay-agents.ts";
import {
  onThread,
  promptThread,
  type ThreadTestServices,
  threadTest,
  threadWhen,
} from "./testing/threads.ts";

const transcript = (name: string) =>
  readFileSync(
    path.join(import.meta.dirname, "testing", "transcripts", name),
    "utf8"
  );

const replaying = (name: string) => {
  const world = threadTest({ replay: transcript(name) });
  return <A, E>(
    title: string,
    body: () => Effect.Effect<A, E, ThreadTestServices>
  ) => perTest(world).effect(title, body);
};

/** `waited` as soon as it holds, or the replay's mismatch as soon as the editor strays. */
const unlessStrayed = <A, E, R>(
  replay: ReplayAgent,
  waited: Effect.Effect<A, E, R>
) =>
  Effect.raceFirst(
    waited,
    Effect.andThen(Effect.orDie(replay.done), Effect.never)
  );

const questionsOf = (items: readonly ThreadItem[]) =>
  items.filter((i) => i.kind === "question");

describe("Claude Code asking with ask_user (claude-agent-acp 0.95)", () => {
  const test = replaying("claude-code-ask-user.ndjson");

  test("the answer reaches the agent, which carries on in its turn", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const replays = yield* ReplayAgents;
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* promptThread({
        attachments: [],
        text: "Ask me which plan to design for, then say what you will do.",
        threadId,
      });
      const replay = yield* replays.next;
      const { items } = yield* unlessStrayed(
        replay,
        threadWhen(threadId, (_, all) => questionsOf(all).length > 0)
      );
      const [card] = questionsOf(items);
      yield* onThread(threadId, (s) =>
        s.answer(card?.id ?? "", { plan: "pro" })
      );
      yield* replay.done;
      const ended = yield* threadWhen(
        threadId,
        (thread, all) =>
          thread.status === "idle" && all.some((i) => i.kind === "turn_end")
      );
      const [answered] = questionsOf(ended.items);
      assert.strictEqual(
        answered?.kind === "question" && answered.settled?.how,
        "answered"
      );
      assert.isTrue(
        ended.items.some(
          (i) => i.kind === "agent" && i.text.includes("the Pro plan")
        )
      );
    }));
});
