import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { runCommand } from "./process.ts";
import { AgentSandbox } from "./services/threads/agent-sandbox.ts";

const machine = {
  home: homedir(),
  path: process.env.PATH ?? "",
  tmpdir: tmpdir(),
  uid: process.getuid?.(),
};

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

describe("AgentSandbox, on a Linux machine with bubblewrap", () => {
  it.effect(
    "runs a command with its variables inside, in a /tmp and a process tree of its own",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* AgentSandbox;
        if (!(sandbox.available && process.platform === "linux")) {
          return;
        }
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const tmpDir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        yield* fs.writeFileString(path.join(tmpDir, "mine"), "");
        // Something another program left in the machine's /tmp.
        const outside = yield* fs.makeTempFileScoped({ prefix: "outside-" });
        const session = yield* sandbox.session({
          config: {
            args: [],
            builtIn: false,
            command: "agent",
            env: {},
            id: "a",
            name: "A",
          },
          root,
          tmpDir,
        });
        const launch = session.confine({
          args: [
            "-c",
            [
              'echo "foo=$FOO tmpdir=$TMPDIR"',
              '[ -z "$DBUS_SESSION_BUS_ADDRESS" ] || echo bus-address-set',
              "ls /tmp",
              `test -e ${outside} && echo outside-visible`,
              `test -e /run/user/${process.getuid?.()}/bus && echo bus-visible`,
              `test -e /run/user/${process.getuid?.()}/systemd && echo systemd-visible`,
              "echo pid=$$",
            ].join("\n"),
          ],
          command: "/bin/sh",
          env: { FOO: "inside" },
        });
        // In the environment bubblewrap hands on, not on its command line.
        assert.deepStrictEqual(launch.env, { FOO: "inside" });
        assert.notInclude(launch.args, "inside");
        const result = yield* runCommand(launch.command, [...launch.args], {
          cwd: root,
          env: {
            ...launch.env,
            DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/0/bus",
          },
          timeout: "10 seconds",
        });
        assert.strictEqual(result.exitCode, 0, result.stderr);
        const lines = result.stdout.trim().split("\n");
        assert.strictEqual(lines[0], "foo=inside tmpdir=/tmp");
        assert.notInclude(lines, "bus-address-set");
        assert.include(lines, "mine");
        assert.notInclude(lines, "outside-visible");
        // The runtime directory, where the bus and the user's systemd listen, is closed.
        assert.notInclude(lines, "bus-visible");
        assert.notInclude(lines, "systemd-visible");
        // The shell is all but alone in its process tree.
        const pid = Number(lines.at(-1)?.slice("pid=".length));
        assert.isBelow(pid, 10);
      }).pipe(
        Effect.provide(
          Layer.provideMerge(AgentSandbox.layerFor(machine), NodeServices.layer)
        )
      )
  );
});
