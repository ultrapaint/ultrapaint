/**
 * Does the sandbox hold? Asked of the sandbox itself: the real `AgentSandbox` service and the
 * real launch configuration, but running plain shell commands through `confine` instead of an
 * agent. No model is involved, so this answers the question that matters — whether the policy is
 * enforced — on any machine, for free, and without an agent's cooperation.
 *
 * It is the check `verify-scope.ts` cannot be: an agent may decline to try, or try in a way that
 * proves nothing. A shell does exactly what it is told.
 *
 * node --experimental-strip-types apps/server/spike/probe-sandbox.ts [claude-code|codex]
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { builtInAgents } from "@ultrapaint/acp/configs";
import { Effect, FileSystem, Layer } from "effect";
import { runCommand } from "../src/process.ts";
import { AgentSandbox } from "../src/services/threads/agent-sandbox.ts";

const agentId = process.argv[2] ?? "claude-code";

/** A probe passes when the sandbox behaves as the ADR says it should. */
interface Probe {
  readonly expect: "allowed" | "denied";
  readonly name: string;
  readonly script: string;
}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sandbox = yield* AgentSandbox;
  const config = builtInAgents.find((a) => a.id === agentId);
  if (!config) {
    return yield* Effect.die(`unknown agent ${agentId}`);
  }

  /**
   * The repository lives in the home directory, where a user's repositories live, and the
   * directory it must not reach is its sibling. That is the case worth probing: the home
   * directory is denied wholesale and the repository allowed back over it, so this exercises the
   * order the rules are written in, which is the part that would silently be wrong.
   */
  const home = process.env.HOME ?? "";
  const stem = `${home}/.ultrapaint-probe-${Date.now()}`;
  const root = yield* fs.realPath(
    yield* Effect.as(
      fs.makeDirectory(`${stem}/repo`, { recursive: true }),
      `${stem}/repo`
    )
  );
  const outside = yield* fs.realPath(
    yield* Effect.as(
      fs.makeDirectory(`${stem}/other`, { recursive: true }),
      `${stem}/other`
    )
  );
  const tmpDir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const homeSecret = `${home}/.ultrapaint-probe-secret.txt`;
  const outsideSecret = `${outside}/secret.txt`;
  yield* fs.writeFileString(homeSecret, "HOME-SECRET-9191\n");
  yield* fs.writeFileString(outsideSecret, "OUTSIDE-SECRET-4242\n");
  yield* fs.writeFileString(`${root}/inside.txt`, "INSIDE-1111\n");
  yield* runCommand("git", ["init", "-q"], { cwd: root });

  const probes: readonly Probe[] = [
    {
      expect: "allowed",
      name: "read inside the repo",
      script: "cat inside.txt",
    },
    {
      expect: "allowed",
      name: "write inside the repo",
      script: "echo x > made.txt && cat made.txt",
    },
    {
      expect: "allowed",
      name: "write its own temp dir",
      script: `echo x > "${tmpDir}/t.txt" && cat "${tmpDir}/t.txt"`,
    },
    {
      expect: "allowed",
      name: "run the toolchain",
      script: "node --version && git --version",
    },
    {
      expect: "allowed",
      name: "reach the network",
      script:
        'curl -sS -o /dev/null -w "%{http_code}" https://registry.npmjs.org/',
    },
    {
      expect: "denied",
      name: "read a secret in $HOME",
      script: `cat "${homeSecret}"`,
    },
    {
      // Linux blanks the home directory rather than refusing it, so listing it succeeds and
      // shows nothing but the mount points. What must never appear is the user's own files.
      expect: "denied",
      name: "find a file in $HOME",
      script: `ls -a "${home}" | grep ultrapaint-probe-secret`,
    },
    {
      expect: "denied",
      name: "read the next repo over",
      script: `cat "${outsideSecret}"`,
    },
    {
      expect: "denied",
      name: "write into $HOME",
      script: `echo x > "${home}/.ultrapaint-probe-pwn.txt"`,
    },
    {
      expect: "denied",
      name: "write the next repo over",
      script: `echo x > "${outside}/pwn.txt"`,
    },
    {
      // Linux: another process's `/proc/<pid>/root` is the whole filesystem as that process sees
      // it, home directory included. `find /` walks straight into it. No `/proc` on macOS.
      expect: "denied",
      name: "read $HOME via /proc/<pid>/root",
      script: `cat "/proc/${process.pid}/root${homeSecret}"`,
    },
    {
      expect: "denied",
      name: "read the user's ssh keys",
      script: `ls "${home}/.ssh"`,
    },
  ];

  const { confine } = yield* sandbox.session({ config, root, tmpDir });
  yield* Effect.log(`agent: ${agentId}`);
  yield* Effect.log(
    `platform: ${process.platform}, sandboxed: ${sandbox.available}`
  );

  let failures = 0;
  for (const probe of probes) {
    const launch = confine({
      args: ["-c", probe.script],
      command: "sh",
      env: {},
    });
    const result = yield* runCommand(launch.command, [...launch.args], {
      cwd: root,
      timeout: "30 seconds",
    }).pipe(
      Effect.orElseSucceed(() => ({
        exitCode: -1,
        stderr: "spawn failed",
        stdout: "",
      }))
    );
    const worked = result.exitCode === 0;
    // A denied probe that "worked" leaked; an allowed one that failed broke the agent's tools.
    const ok = worked === (probe.expect === "allowed");
    if (!ok) {
      failures += 1;
    }
    const detail = `${result.stdout}${result.stderr}`
      .trim()
      .replaceAll("\n", " ")
      .slice(0, 70);
    yield* Effect.log(
      `${ok ? "  ok " : "FAIL "} ${probe.name.padEnd(26)} ${probe.expect.padEnd(7)} → ${worked ? "worked" : "refused"}  ${detail}`
    );
  }

  /*
   * The same repository opened through a symlink, which is how `/tmp` is reached on macOS and
   * how many people keep their code. Seatbelt sees the resolved path, so the rules must name it.
   */
  const linked = `${stem}/linked`;
  yield* fs.symlink(root, linked);
  const throughLink = (yield* sandbox.session({ config, root: linked, tmpDir }))
    .confine;
  {
    const launch = throughLink({
      args: ["-c", "echo x > via-link.txt && cat via-link.txt"],
      command: "sh",
      env: {},
    });
    const result = yield* runCommand(launch.command, [...launch.args], {
      cwd: linked,
      timeout: "30 seconds",
    }).pipe(
      Effect.orElseSucceed(() => ({
        exitCode: -1,
        stderr: "spawn failed",
        stdout: "",
      }))
    );
    const ok = result.exitCode === 0;
    if (!ok) {
      failures += 1;
    }
    yield* Effect.log(
      `${ok ? "  ok " : "FAIL "} ${"write a symlinked repo".padEnd(26)} allowed → ${ok ? "worked" : "refused"}  ${`${result.stdout}${result.stderr}`.trim().slice(0, 70)}`
    );
  }

  // Nothing the probes may have leaked is left lying about.
  yield* fs.remove(homeSecret).pipe(Effect.ignore);
  yield* fs.remove(`${home}/.ultrapaint-probe-pwn.txt`).pipe(Effect.ignore);
  yield* fs.remove(stem, { recursive: true }).pipe(Effect.ignore);
  yield* Effect.log(
    failures === 0 ? "all probes as expected" : `${failures} probe(s) wrong`
  );
  if (failures > 0) {
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
});

program.pipe(
  Effect.scoped,
  Effect.provide(
    Layer.provideMerge(
      // A script at the edge reads the environment itself; the server resolves it in bin.ts.
      AgentSandbox.layerFor({
        home: process.env.HOME ?? "",
        path: process.env.PATH ?? "",
      }),
      NodeServices.layer
    )
  ),
  NodeRuntime.runMain
);
