import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  forwardArgs,
  loginShellCommand,
  masterArgs,
  NO_FOLDER_EXIT,
  remotePathWord,
  serverScript,
  sessionArgs,
  shellQuote,
  sshEnv,
  sshFailure,
} from "./ssh.ts";

/** Runs a remote command string as sshd would: the login shell's `-c`. */
const runRemote = (command: string, home: string) =>
  execFileSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { HOME: home, PATH: process.env.PATH ?? "", SHELL: "/bin/sh" },
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("shell quoting", () => {
  it("quotes a word so that a shell reads it back as it was", () => {
    for (const word of [
      "plain",
      "with space",
      "it's",
      `"$HOME" \`x\` \\n`,
      "",
    ]) {
      assert.strictEqual(
        execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(word)}`], {
          encoding: "utf8",
        }),
        word
      );
    }
  });

  it("puts ~ and ~/… under the remote home, and quotes the rest", () => {
    assert.strictEqual(remotePathWord("~"), '"$HOME"');
    assert.strictEqual(remotePathWord("~/a b"), `"$HOME"/'a b'`);
    assert.strictEqual(remotePathWord("/srv/it's"), `'/srv/it'\\''s'`);
  });

  it("runs the command in the folder with the app's flags, through two shells", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ultrapaint-ssh-test-"));
    try {
      const folder = path.join(home, `it's a "project" $USER`);
      mkdirSync(folder);
      const out = runRemote(
        loginShellCommand(
          serverScript({
            command: `sh -c 'pwd; printf "[%s]" "$@"' sh`,
            path: `~/${path.basename(folder)}`,
            sessionDir: "~/.ultrapaint/desktop-sessions/p1",
          })
        ),
        home
      );
      const [cwd, args] = out.split("\n");
      assert.strictEqual(cwd, folder);
      assert.strictEqual(
        args,
        `[--host][127.0.0.1][--port][0][--ready-json][--stop-with-stdin][--session-dir][${home}/.ultrapaint/desktop-sessions/p1]`
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("exits with its own code and says so when the folder is not there", () => {
    try {
      runRemote(
        loginShellCommand(
          serverScript({
            command: "true",
            path: "/no/such",
            sessionDir: "/tmp",
          })
        ),
        tmpdir()
      );
      assert.fail("it ran");
    } catch (error) {
      const failed = error as { status: number; stderr: string };
      assert.strictEqual(failed.status, NO_FOLDER_EXIT);
      assert.include(failed.stderr, "ultrapaint: no folder /no/such");
    }
  });
});

describe("ssh arguments", () => {
  const target = { configFile: "/tmp/cfg", host: "me@box", port: 2222 };

  it("makes a master in the foreground, without prompts or the configuration's forwards", () => {
    const args = masterArgs(target, "/tmp/d/s");
    assert.deepStrictEqual(args.slice(0, 4), ["-F", "/tmp/cfg", "-p", "2222"]);
    for (const option of [
      "BatchMode=yes",
      "ControlMaster=yes",
      "ControlPersist=no",
      "ClearAllForwardings=yes",
      "RemoteCommand=none",
    ]) {
      assert.include(args, option);
    }
    assert.deepStrictEqual(args.slice(-3), [
      "--",
      "me@box",
      "exec cat >/dev/null",
    ]);
  });

  it("runs a session and forwards on the master's socket", () => {
    const session = sessionArgs({ host: "box" }, "/tmp/d/s", "echo hi");
    assert.deepStrictEqual(session.slice(-3), ["--", "box", "echo hi"]);
    assert.include(session, "ControlMaster=no");
    assert.notInclude(session, "-F");
    assert.deepStrictEqual(
      forwardArgs(target, "/tmp/d/s", {
        local: 41_000,
        remoteHost: "127.0.0.1",
        remotePort: 4770,
      }),
      [
        "-F",
        "/tmp/cfg",
        "-S",
        "/tmp/d/s",
        "-O",
        "forward",
        "-L",
        "127.0.0.1:41000:127.0.0.1:4770",
        "--",
        "me@box",
      ]
    );
  });

  it("keeps what is the app's alone out of ssh's environment", () => {
    assert.deepStrictEqual(
      sshEnv(
        {
          ELECTRON_RUN_AS_NODE: "1",
          HOME: "/home/me",
          PATH: "/usr/bin",
          ULTRAPAINT_AGENT_RUNTIME: "{}",
        },
        { PATH: "/opt/bin:/usr/bin", SSH_AUTH_SOCK: "/run/agent" }
      ),
      {
        HOME: "/home/me",
        PATH: "/opt/bin:/usr/bin",
        SSH_AUTH_SOCK: "/run/agent",
      }
    );
  });
});

describe("sshFailure", () => {
  const fail = (exitCode: number, stderr: string) =>
    sshFailure({
      command: "ultrapaint",
      exitCode,
      host: "box",
      path: "~/shop",
      stderr,
    });

  it("tells the connection's failures apart", () => {
    const refused = fail(
      255,
      "ssh: connect to host box port 22: Connection refused"
    );
    assert.include(refused.message, "box could not be reached");
    assert.isTrue(refused.retryable);
    const key = fail(255, "Host key verification failed.");
    assert.include(key.message, "Connect once in a terminal with ssh box");
    assert.isFalse(key.retryable);
    const auth = fail(255, "me@box: Permission denied (publickey,password).");
    assert.include(auth.message, "cannot type a password");
    assert.isFalse(auth.retryable);
  });

  it("tells a missing command from missing Node, and a missing folder", () => {
    const shell =
      "bash: cannot set terminal process group (-1): Inappropriate ioctl for device\nbash: no job control in this shell\n";
    const command = fail(
      127,
      `${shell}/bin/sh: 2: exec: ultrapaint: not found`
    );
    assert.include(command.message, "ultrapaint is not installed on box");
    assert.notInclude(command.message, "job control");
    const node = fail(127, "/usr/bin/env: 'node': No such file or directory");
    assert.include(
      node.message,
      "Node.js is not on the PATH of box's login shell"
    );
    assert.strictEqual(
      fail(NO_FOLDER_EXIT, "ultrapaint: no folder ~/shop").message,
      "There is no folder ~/shop on box"
    );
    assert.include(
      fail(1, "Error: boom").message,
      "stopped before it said where it listens (1):\nError: boom"
    );
  });
});
