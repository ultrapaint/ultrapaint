/**
 * Steering, read off what the agent says: whether it takes a prompt into the turn under way
 * (`initialize`'s own `_meta`), and where a steer went by its answer.
 */
import { assert, describe, it } from "vitest";
import { steeredOf } from "./acp-agent.ts";
import { negotiated } from "./negotiated.ts";

describe("steering", () => {
  it("is what an agent says it does beside its capabilities, and nothing when it says nothing", () => {
    assert.isTrue(
      negotiated({
        _meta: { steering: { supported: true } },
        protocolVersion: 1,
      }).steering
    );
    assert.isFalse(negotiated({ protocolVersion: 1 }).steering);
    assert.isFalse(
      negotiated({
        _meta: { steering: { supported: false } },
        protocolVersion: 1,
      }).steering
    );
  });

  it("reached the agent when it says so, or started a turn with it itself", () => {
    assert.strictEqual(steeredOf({ outcome: "injected" }), "injected");
    // Codex, with no turn running, starts one with the prompt whatever the host asked.
    assert.strictEqual(steeredOf({ outcome: "startedNewTurn" }), "injected");
    assert.strictEqual(
      steeredOf({ outcome: "promptRequired", reason: "noRunningTurn" }),
      "noTurn"
    );
    assert.strictEqual(steeredOf({ outcome: "failed" }), "noTurn");
    assert.strictEqual(steeredOf(null), "noTurn");
  });
});
