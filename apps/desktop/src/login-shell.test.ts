import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  captureCommand,
  childEnvironment,
  extractEnvironment,
  mergePaths,
  shellCandidates,
} from "./login-shell.ts";

describe("the login shell's environment", () => {
  it("is read between marks, whatever the startup files print around it", () => {
    const names = ["PATH", "SSH_AUTH_SOCK", "LANG"];
    const output = [
      "Welcome back!",
      "__ULTRAPAINT_ENV_PATH_START__",
      "/home/me/.fnm/bin:/usr/bin",
      "__ULTRAPAINT_ENV_PATH_END__",
      "__ULTRAPAINT_ENV_SSH_AUTH_SOCK_START__",
      "__ULTRAPAINT_ENV_SSH_AUTH_SOCK_END__",
      "__ULTRAPAINT_ENV_LANG_START__",
      "en_GB.UTF-8",
      "nvm: a warning",
    ].join("\n");
    assert.deepStrictEqual(extractEnvironment(output, names), {
      PATH: "/home/me/.fnm/bin:/usr/bin",
    });
  });

  it.effect("comes back from a real shell as it went in", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const output = yield* spawner.string(
        ChildProcess.make("/bin/sh", ["-c", captureCommand(["PATH", "NOPE"])], {
          env: { PATH: "/a b/bin:/usr/bin:/bin" },
          extendEnv: false,
        })
      );
      assert.deepStrictEqual(extractEnvironment(output, ["PATH", "NOPE"]), {
        PATH: "/a b/bin:/usr/bin:/bin",
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it("puts the login shell's PATH first, each directory once", () => {
    assert.strictEqual(
      mergePaths("/home/me/.local/bin:/usr/bin", "/usr/bin:/bin", undefined),
      "/home/me/.local/bin:/usr/bin:/bin"
    );
  });

  it("adds what the app lacks, and keeps what it has", () => {
    assert.deepStrictEqual(
      childEnvironment(
        { LANG: "C", PATH: "/usr/bin" },
        {
          LANG: "en_GB.UTF-8",
          PATH: "/opt/homebrew/bin:/usr/bin",
          SSH_AUTH_SOCK: "/tmp/agent.sock",
        }
      ),
      {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
      }
    );
    // A shell that said nothing leaves the app's PATH as it was.
    assert.deepStrictEqual(childEnvironment({ PATH: "/usr/bin" }, {}), {
      PATH: "/usr/bin",
    });
  });

  it("asks the user's shell, then the platform's", () => {
    assert.deepStrictEqual(shellCandidates("/usr/bin/fish", "darwin"), [
      "/usr/bin/fish",
      "/bin/zsh",
    ]);
    assert.deepStrictEqual(shellCandidates(undefined, "linux"), ["/bin/bash"]);
  });
});
