/**
 * A throwaway `sshd` for the app's SSH tests: run as the user, on a free loopback port, with a
 * host key, a client key and a configuration of its own in a temporary directory, so that the
 * user's `~/.ssh` is neither read nor written. Absent when this machine has no `sshd`, and the
 * tests that need one are skipped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { userInfo } from "node:os";
import path from "node:path";
import { Effect, FileSystem, Schedule, type Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const SSHD = ["/usr/sbin/sshd", "/usr/local/sbin/sshd"].find((file) =>
  existsSync(file)
);

const freePort = () =>
  Effect.callback<number>((resume) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resume(Effect.succeed(port)));
    });
  });

interface Sshd {
  /** The client's configuration: `Host test` reaches it, `Host unreachable` reaches nothing. */
  readonly configFile: string;
  readonly dir: string;
}

/** Starts it in the scope; it stops when the scope closes. */
export const startSshd: Effect.Effect<
  Sshd,
  never,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const dir = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "ultrapaint-sshd-" })
  );
  const file = (name: string) => path.join(dir, name);
  for (const key of ["host_key", "client_key"]) {
    execFileSync("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      file(key),
    ]);
  }
  yield* fs.copyFile(file("client_key.pub"), file("authorized_keys"));
  const port = yield* freePort();
  writeFileSync(
    file("sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${file("host_key")}`,
      `AuthorizedKeysFile ${file("authorized_keys")}`,
      "StrictModes no",
      "UsePAM no",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      `PidFile ${file("sshd.pid")}`,
      "AllowTcpForwarding yes",
      "",
    ].join("\n")
  );
  const user = userInfo().username;
  writeFileSync(
    file("ssh_config"),
    [
      "Host test",
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      `  User ${user}`,
      `  IdentityFile ${file("client_key")}`,
      "  IdentitiesOnly yes",
      `  UserKnownHostsFile ${file("known_hosts")}`,
      "  StrictHostKeyChecking accept-new",
      "Host unreachable",
      "  HostName 127.0.0.1",
      "  Port 1",
      `  UserKnownHostsFile ${file("known_hosts")}`,
      "",
    ].join("\n")
  );
  yield* spawner.spawn(
    ChildProcess.make(SSHD ?? "sshd", ["-D", "-e", "-f", file("sshd_config")], {
      forceKillAfter: "2 seconds",
      stdin: "ignore",
    })
  );
  // Listening once it accepts a connection.
  yield* Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
        socket.connect(port, "127.0.0.1");
      })
  ).pipe(
    Effect.retry(Schedule.spaced("50 millis")),
    Effect.timeout("10 seconds")
  );
  return { configFile: file("ssh_config"), dir };
}).pipe(Effect.orDie);
