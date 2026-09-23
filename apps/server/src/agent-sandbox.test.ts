import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AgentSandbox } from "./services/threads/agent-sandbox.ts";

const machine = { home: homedir(), path: process.env.PATH ?? "" };

/** The sandbox as the server would build it, with the bubblewrap it is given. */
const sandboxWith = (bubblewrap: string) =>
  Effect.gen(function* () {
    return yield* AgentSandbox;
  }).pipe(
    Effect.provide(
      Layer.provide(
        AgentSandbox.layerFor(machine, {
          tools: { bubblewrap, platform: "linux" },
        }),
        NodeServices.layer
      )
    )
  );

/** A stand-in for bubblewrap that refuses, as it does on a kernel restricting user namespaces. */
const refusing = (message: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-bwrap-"));
  const file = path.join(dir, "bwrap");
  writeFileSync(file, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
};

describe("AgentSandbox, when the sandbox it has refuses to start", () => {
  it.effect("says it cannot confine the agent, and why", () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith(
        refusing("bwrap: setting up uid map: Permission denied")
      );
      assert.isFalse(sandbox.available);
      assert.include(
        sandbox.problem ?? "",
        "setting up uid map: Permission denied"
      );
    })
  );

  it.effect("gives the exit code when there is nothing else to go on", () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith("/usr/bin/false");
      assert.isFalse(sandbox.available);
      assert.include(sandbox.problem ?? "", "exit code 1");
    })
  );

  it.effect("then starts the agent unconfined rather than not at all", () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith("/usr/bin/false");
      const session = yield* sandbox.session({
        config: {
          args: ["--flag"],
          builtIn: false,
          command: "agent",
          env: {},
          id: "a",
          name: "A",
        },
        root: tmpdir(),
        tmpDir: tmpdir(),
      });
      assert.strictEqual(session.launch.command, "agent");
    })
  );
});
