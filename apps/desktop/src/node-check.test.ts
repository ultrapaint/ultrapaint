import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import {
  checkNode,
  nodeNotice,
  statusOf,
  supportedNode,
} from "./node-check.ts";

/** A directory with a `node` whose `--version` runs `script`. */
const fakeNode = (script: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const node = path.join(dir, "node");
    yield* fs.writeFileString(node, `#!/bin/sh\n${script}\n`);
    yield* fs.chmod(node, 0o755);
    return { dir, node };
  });

const onPath = (dir: string, extra: Record<string, string> = {}) => ({
  PATH: `/nonexistent:${dir}`,
  ...extra,
});

describe("the user's Node", () => {
  it("is supported where a new application's Vite runs", () => {
    assert.isTrue(supportedNode("v24.1.0"));
    assert.isTrue(supportedNode("v22.12.0"));
    assert.isTrue(supportedNode("v20.19.2"));
    assert.isFalse(supportedNode("v22.11.0"));
    assert.isFalse(supportedNode("v20.18.0"));
    assert.isFalse(supportedNode("v18.20.0"));
    assert.isTrue(supportedNode("v25.0.0-rc.1"));
    assert.isFalse(supportedNode("v24.3.0 is not installed"));
    assert.isFalse(supportedNode("not a version"));
  });

  it.effect("is found on the PATH, with its version, and needs no notice", () =>
    Effect.gen(function* () {
      const { dir, node } = yield* fakeNode("echo v24.3.0");
      const status = yield* checkNode(onPath(dir));
      assert.deepStrictEqual(status, {
        _tag: "Ready",
        path: node,
        version: "v24.3.0",
      });
      assert.isTrue(Option.isNone(nodeNotice(status)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("is asked with the login shell's whole environment", () =>
    Effect.gen(function* () {
      // A version manager's shim that needs its own variable, as a shell's startup sets it.
      const { dir } = yield* fakeNode(
        '[ "$SHIM_HOME" = set ] || { echo "no version set" >&2; exit 1; }; echo v24.3.0'
      );
      const status = yield* checkNode(onPath(dir, { SHIM_HOME: "set" }));
      assert.strictEqual(status._tag, "Ready");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("is a notice opening About when missing or too old", () =>
    Effect.gen(function* () {
      const missing = yield* checkNode({ PATH: "/nonexistent" });
      assert.deepStrictEqual(missing, { _tag: "Missing" });
      assert.deepStrictEqual(Option.getOrThrow(nodeNotice(missing)), {
        id: "node",
        section: "about",
        title: "Node.js is not installed",
      });

      const { dir } = yield* fakeNode("echo v18.19.0");
      const old = yield* checkNode(onPath(dir));
      assert.strictEqual(old._tag, "TooOld");
      assert.strictEqual(
        Option.getOrThrow(nodeNotice(old)).title,
        "Node.js v18.19.0 is too old"
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("that fails says why, never that it is too old", () =>
    Effect.gen(function* () {
      const { dir, node } = yield* fakeNode(
        'echo "vp: no Node.js version set for /" >&2; exit 1'
      );
      const failed = yield* checkNode(onPath(dir));
      assert.deepStrictEqual(failed, {
        _tag: "Failed",
        path: node,
        reason: "vp: no Node.js version set for / (exit code 1)",
      });
      assert.strictEqual(
        Option.getOrThrow(nodeNotice(failed)).title,
        "Node.js didn’t run"
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  // real clock: a real process that outlasts the timeout under test.
  it.live("that does not answer in time says so", () =>
    Effect.gen(function* () {
      const { dir } = yield* fakeNode("exec /bin/sleep 5");
      const slow = yield* checkNode(onPath(dir), 1);
      assert.strictEqual(slow._tag, "Failed");
      assert.include(
        slow._tag === "Failed" ? slow.reason : "",
        "didn’t answer within 1 seconds"
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("reads what a node printed in place of its version", () => {
    assert.deepStrictEqual(
      statusOf("/bin/node", { exitCode: 0, stderr: "", stdout: "" }),
      { _tag: "Failed", path: "/bin/node", reason: "It printed nothing." }
    );
    assert.deepStrictEqual(
      statusOf("/bin/node", { exitCode: 2, stderr: "", stdout: "" }),
      { _tag: "Failed", path: "/bin/node", reason: "exit code 2" }
    );
    assert.strictEqual(
      statusOf("/bin/node", {
        exitCode: 0,
        stderr: "",
        stdout: "v24.3.0 is not installed\n",
      })._tag,
      "Failed"
    );
    assert.deepStrictEqual(
      statusOf("/bin/node", { exitCode: 0, stderr: "", stdout: "hello\n" }),
      {
        _tag: "Failed",
        path: "/bin/node",
        reason: "It printed “hello”, not a version.",
      }
    );
  });
});
