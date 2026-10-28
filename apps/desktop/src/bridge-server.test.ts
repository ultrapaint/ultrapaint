import { assert, describe, it } from "@effect/vitest";
import {
  type InvokeName,
  SHELL_BRIDGE,
} from "@ultrapaint/contracts/shell-bridge";
import { Effect } from "effect";
import { channelOf, progressChannelOf } from "./bridge.ts";
import {
  answer,
  type BridgeHandlers,
  type BridgeSender,
  bridgeInfo,
  serveBridge,
} from "./bridge-server.ts";
import { BridgeInputError, HiddenCapability } from "./errors.ts";

/** Handlers that record their calls; each answers what `overrides` says, or dies. */
const handlersWith = (
  calls: unknown[][],
  overrides: Partial<BridgeHandlers<never>>
) =>
  Object.fromEntries(
    (Object.keys(SHELL_BRIDGE) as InvokeName[]).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        const handler = overrides[name] as
          | ((...a: unknown[]) => Effect.Effect<unknown>)
          | undefined;
        return handler ? handler(...args) : Effect.die(`${name} is not faked`);
      },
    ])
  ) as unknown as BridgeHandlers<never>;

const noReport = () => Effect.void;

/** What a call failed with. */
const failureOf = <E, R>(call: Effect.Effect<unknown, E, R>) =>
  Effect.flip(Effect.asVoid(call));

describe("answer", () => {
  it.effect(
    "refuses input its Schema does not take, before the handler runs",
    () =>
      Effect.gen(function* () {
        const calls: unknown[][] = [];
        const respond = answer(handlersWith(calls, {}), Effect.succeed(false));
        const wrong = yield* failureOf(
          respond("projects.open", [42], noReport)
        );
        assert.instanceOf(wrong, BridgeInputError);
        assert.include(wrong.message, "Expected string");
        const unknownAgent = yield* failureOf(
          respond("agents.download", ["gpt"], noReport)
        );
        assert.instanceOf(unknownAgent, BridgeInputError);
        const missing = yield* failureOf(
          respond("projects.addRemote", [{ host: "devbox" }], noReport)
        );
        assert.instanceOf(missing, BridgeInputError);
        assert.deepStrictEqual(calls, []);
      })
  );

  it.effect(
    "runs the handler with the input decoded, and encodes its answer",
    () =>
      Effect.gen(function* () {
        const calls: unknown[][] = [];
        const respond = answer(
          handlersWith(calls, {
            "agents.setApiKey": () => Effect.void,
            pickFolder: (options) =>
              Effect.succeed(options?.title === "Where?" ? "/work" : null),
          }),
          Effect.succeed(false)
        );
        assert.strictEqual(
          yield* respond("pickFolder", [{ title: "Where?" }], noReport),
          "/work"
        );
        assert.isNull(yield* respond("pickFolder", [undefined], noReport));
        yield* respond("agents.setApiKey", ["claude-code", null], noReport);
        assert.deepStrictEqual(calls, [
          ["pickFolder", { title: "Where?" }],
          ["pickFolder", undefined],
          ["agents.setApiKey", "claude-code", null],
        ]);
      })
  );

  it.effect("hides this machine's capabilities from a remote project", () =>
    Effect.gen(function* () {
      const calls: unknown[][] = [];
      const respond = answer(
        handlersWith(calls, {
          "agents.list": () => Effect.succeed([]),
          "projects.current": () => Effect.succeed("p1"),
        }),
        Effect.succeed(true)
      );
      const hidden = yield* failureOf(respond("agents.list", [], noReport));
      assert.instanceOf(hidden, HiddenCapability);
      assert.strictEqual(
        hidden.message,
        "agents.list is not shown for a project on another machine"
      );
      assert.strictEqual(
        yield* respond("projects.current", [], noReport),
        "p1"
      );
      assert.deepStrictEqual(calls, [["projects.current"]]);
    })
  );

  it.effect("reports each step of a call with progress, encoded", () =>
    Effect.gen(function* () {
      const steps: unknown[] = [];
      const respond = answer(
        handlersWith([], {
          "newDesign.create": (_input, report) =>
            Effect.gen(function* () {
              yield* report({ state: "active", step: "folder" });
              yield* report({ detail: "made", state: "done", step: "folder" });
              return {};
            }),
        }),
        Effect.succeed(false)
      );
      const outcome = yield* respond(
        "newDesign.create",
        [
          {
            code: "app",
            folder: "/work/shop",
            git: false,
            name: "Shop",
            template: "blank",
          },
        ],
        (step) => Effect.sync(() => steps.push(step))
      );
      assert.deepStrictEqual(outcome, {});
      assert.deepStrictEqual(steps, [
        { state: "active", step: "folder" },
        { detail: "made", state: "done", step: "folder" },
      ]);
    })
  );

  it.effect("passes the handler's failure on, as its message", () =>
    Effect.gen(function* () {
      const respond = answer(
        handlersWith([], {
          "projects.open": () => Effect.fail({ message: "no project p9" }),
        }),
        Effect.succeed(false)
      );
      const failure = yield* failureOf(
        respond("projects.open", ["p9"], noReport)
      );
      assert.strictEqual(failure.message, "no project p9");
    })
  );
});

describe("bridgeInfo", () => {
  it("shows the page every capability, the states given with their values", () => {
    const info = bridgeInfo(false, {
      shellStatus: { message: "Reconnecting" },
    });
    const names = info.shown.map((s) => s.name);
    assert.include(names, "agents.list");
    assert.include(names, "notices");
    assert.notInclude(names, "windowControls");
    assert.deepInclude(info.shown, {
      kind: "state",
      name: "shellStatus",
      value: { message: "Reconnecting" },
    });
    assert.deepInclude(info.shown, {
      kind: "invoke",
      name: "newDesign.create",
      progress: true,
    });
    assert.deepInclude(info.shown, {
      kind: "invoke",
      name: "projects.open",
      progress: false,
    });
  });

  it("shows a remote project none of this machine's agents and notices", () => {
    const names = bridgeInfo(true, {
      shellStatus: null,
      windowControls: { fullScreen: false, inset: 86 },
    }).shown.map((s) => s.name);
    assert.isFalse(names.some((n) => n.startsWith("agents.")));
    assert.notInclude(names, "notices");
    assert.include(names, "projects.open");
    assert.include(names, "windowControls");
  });
});

describe("serveBridge", () => {
  const sender = (sent: unknown[][]): BridgeSender => ({
    send: (channel, payload) => sent.push([channel, payload]),
  });

  const served = (own: BridgeSender) => {
    const listeners = new Map<
      string,
      (event: { sender: BridgeSender }, ...args: unknown[]) => Promise<unknown>
    >();
    serveBridge({
      fromWindow: (s) => s === own,
      handlers: handlersWith([], {
        "newDesign.create": (_input, report) =>
          Effect.as(report({ state: "active", step: "write" }), {}),
        "projects.current": () => Effect.succeed("p1"),
      }),
      ipc: { handle: (channel, listener) => listeners.set(channel, listener) },
      remote: Effect.succeed(false),
      run: Effect.runPromise,
    });
    return listeners;
  };

  it("registers a channel for every call, none for the states", () => {
    const listeners = served(sender([]));
    assert.isTrue(listeners.has(channelOf("projects.open")));
    assert.isFalse(listeners.has(channelOf("shellStatus")));
    assert.isFalse(listeners.has(channelOf("windowControls")));
  });

  it("answers only the app's own window, and sends the steps to the caller", async () => {
    const sent: unknown[][] = [];
    const own = sender(sent);
    const listeners = served(own);
    const current = listeners.get(channelOf("projects.current"));
    assert.strictEqual(await current?.({ sender: own }), "p1");
    let refused: unknown = null;
    await current?.({ sender: sender([]) }).catch((error: unknown) => {
      refused = error;
    });
    assert.strictEqual(
      (refused as Error | null)?.message,
      "not the app's window"
    );
    await listeners.get(channelOf("newDesign.create"))?.(
      { sender: own },
      { code: "app", folder: "/f", git: true, name: "F", template: "starter" }
    );
    assert.deepStrictEqual(sent, [
      [
        progressChannelOf("newDesign.create"),
        { state: "active", step: "write" },
      ],
    ]);
  });
});
