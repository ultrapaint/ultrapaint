/**
 * Desktop shell. It runs the same server and loads the same web bundle as the browser build;
 * the only native additions are a folder picker and a window. No editor feature lives here.
 *
 * The server is a child process in the program's scope. Quitting closes the scope, which ends
 * the server's process group before Electron is allowed to exit. A server that cannot start
 * ends the app with a non-zero code.
 */
import { createServer } from "node:net";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Exit, Schedule } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const freePort = Effect.callback<number>((resume) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

const healthy = (port: number) =>
  Effect.tryPromise(() => fetch(`http://127.0.0.1:${port}/api/health`)).pipe(
    Effect.filterOrFail((response) => response.ok)
  );

const startServer = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const port = yield* freePort;
  const sibling = (...segments: string[]) =>
    path.join(app.getAppPath(), "..", ...segments);
  yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      [
        sibling("server", "dist", "bin.mjs"),
        "--port",
        String(port),
        "--web-dist",
        sibling("web", "dist"),
      ],
      {
        env: { ELECTRON_RUN_AS_NODE: "1" },
        extendEnv: true,
        forceKillAfter: "3 seconds",
        stderr: "inherit",
        stdin: "ignore",
        stdout: "inherit",
      }
    )
  );
  yield* healthy(port).pipe(
    Effect.retry(Schedule.spaced("150 millis")),
    Effect.timeout("20 seconds"),
    Effect.orDie
  );
  return port;
});

const openWindow = Effect.gen(function* () {
  yield* Effect.promise(() => app.whenReady());
  const port = yield* startServer;
  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  const window = new BrowserWindow({
    backgroundColor: "#1a1a1d",
    height: 950,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
    },
    width: 1500,
  });
  app.on("window-all-closed", () => app.quit());
  yield* Effect.promise(() => window.loadURL(`http://127.0.0.1:${port}/`));
  return yield* Effect.never;
});

const program = Effect.gen(function* () {
  // Registered before anything starts: a quit during the seconds the server takes to come up
  // must also be held until the scope, and with it the server, has been closed.
  const quit = yield* Deferred.make<void>();
  app.once("before-quit", (event) => {
    event.preventDefault();
    Deferred.doneUnsafe(quit, Effect.void);
  });
  yield* Effect.raceFirst(openWindow, Deferred.await(quit));
});

program.pipe(
  Effect.scoped,
  Effect.tapCause((cause) => Effect.logError("desktop shell failed", cause)),
  Effect.onExit((exit) =>
    Effect.sync(() => app.exit(Exit.isSuccess(exit) ? 0 : 1))
  ),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
