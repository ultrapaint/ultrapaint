import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { checkNode, nodeNotice, supportedNode } from "./node-check.ts";

/** A directory with a `node` that says it is `version`. */
const fakeNode = (version: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const node = path.join(dir, "node");
    yield* fs.writeFileString(node, `#!/bin/sh\necho ${version}\n`);
    yield* fs.chmod(node, 0o755);
    return dir;
  });

describe("the user's Node", () => {
  it("is supported where a new application's Vite runs", () => {
    assert.isTrue(supportedNode("v24.1.0"));
    assert.isTrue(supportedNode("v22.12.0"));
    assert.isTrue(supportedNode("v20.19.2"));
    assert.isFalse(supportedNode("v22.11.0"));
    assert.isFalse(supportedNode("v20.18.0"));
    assert.isFalse(supportedNode("v18.20.0"));
    assert.isFalse(supportedNode("not a version"));
  });

  it.effect("is found on the PATH, with its version", () =>
    Effect.gen(function* () {
      const dir = yield* fakeNode("v24.3.0");
      const status = yield* checkNode(`/nonexistent:${dir}`);
      assert.deepStrictEqual(status, {
        _tag: "Found",
        path: path.join(dir, "node"),
        supported: true,
        version: "v24.3.0",
      });
      assert.isTrue(Option.isNone(nodeNotice(status, "linux")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("is a notice with the install step when missing or too old", () =>
    Effect.gen(function* () {
      const missing = yield* checkNode("/nonexistent");
      assert.deepStrictEqual(missing, { _tag: "Missing" });
      const notice = Option.getOrThrow(nodeNotice(missing, "darwin"));
      assert.strictEqual(notice.title, "Node.js is not installed");
      assert.strictEqual(notice.command, "brew install node");
      assert.include(notice.link?.url ?? "", "nodejs.org");

      const old = yield* checkNode(yield* fakeNode("v18.19.0"));
      assert.strictEqual(
        Option.getOrThrow(nodeNotice(old, "linux")).title,
        "Node.js v18.19.0 is too old"
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
