/**
 * The desktop app (ADR 0031): a window around the same server and the same web build the
 * `ultrapaint` command serves. The app keeps a list of projects, starts the server of the one
 * open, loads its editor, and fills the editor's `Platform` with what a browser cannot do.
 * Nothing of the editor lives here; what the app decides lives in its services, and this file
 * connects them to Electron.
 */
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from "electron";
import { Channel, type ListedProject, type PickFolderOptions } from "./ipc.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectServer } from "./project-server.ts";
import { ProjectStore } from "./projects.ts";
import { Shell, type View } from "./shell.ts";

// A data directory of its own, for trying the app without touching the user's.
if (process.env.ULTRAPAINT_DESKTOP_USER_DATA) {
  app.setPath(
    "userData",
    path.resolve(process.env.ULTRAPAINT_DESKTOP_USER_DATA)
  );
}

/** In development, how the server is started from its sources; packaged, its bundle beside this. */
const DevServerArgs = Schema.fromJsonString(Schema.Array(Schema.String));

const appDir = app.getAppPath();
const dataDir = app.getPath("userData");
const devServer = process.env.ULTRAPAINT_DESKTOP_SERVER_ARGS;
const serverArgs = devServer
  ? Schema.decodeUnknownSync(DevServerArgs)(devServer)
  : [path.join(appDir, "server", "bin.mjs")];

let window: BrowserWindow | null = null;

const showView = (view: View) =>
  Effect.promise(async () => {
    if (!window) {
      return;
    }
    if (view._tag === "Editor") {
      await window.loadURL(view.url);
      return;
    }
    await window.loadFile(
      path.join(appDir, "welcome.html"),
      view.problem ? { query: { problem: view.problem } } : {}
    );
  }).pipe(
    // A page that did not finish loading (the user switched again meanwhile) is not an error.
    Effect.catchDefect(() => Effect.void)
  );

const ElectronShell = Layer.succeed(
  Shell,
  Shell.of({
    confirm: ({ action, detail, message }) =>
      Effect.promise(async () => {
        const options = {
          buttons: [action, "Cancel"],
          cancelId: 1,
          defaultId: 1,
          detail,
          message,
          type: "question" as const,
        };
        const answer = window
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options);
        return answer.response === 0;
      }),
    pickFolder: (title) =>
      Effect.promise(async () => {
        const options = {
          properties: ["openDirectory", "createDirectory"] as Array<
            "openDirectory" | "createDirectory"
          >,
          title,
        };
        const picked = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options);
        return Option.fromNullishOr(
          picked.canceled ? undefined : picked.filePaths[0]
        );
      }),
    show: showView,
  })
);

const runtime = ManagedRuntime.make(
  OpenProject.layer(dataDir).pipe(
    Layer.provideMerge(ProjectStore.layer(dataDir)),
    Layer.provideMerge(
      ProjectServer.layer({
        args: serverArgs,
        command: process.execPath,
        webDist: path.join(appDir, "web"),
      })
    ),
    Layer.provideMerge(ElectronShell),
    Layer.provideMerge(NodeServices.layer)
  )
);

/** Only the app's own window may call the main process. */
const handle = <A>(
  channel: string,
  respond: (...args: unknown[]) => Promise<A>
) =>
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!window || event.sender !== window.webContents) {
      return Promise.reject(new Error("not the app's window"));
    }
    return respond(...args);
  });

handle(Channel.pickFolder, async (options) => {
  const { defaultPath, title } = (options ?? {}) as PickFolderOptions;
  if (!window) {
    return null;
  }
  const picked = await dialog.showOpenDialog(window, {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ["openDirectory", "createDirectory"],
    title: title ?? "Choose a folder",
  });
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
});

handle(Channel.projectsList, () =>
  runtime.runPromise(
    Effect.map(
      ProjectStore.use((store) => store.list),
      (projects) =>
        projects.map(
          (p): ListedProject => ({ detail: p.path, id: p.id, name: p.name })
        )
    )
  )
);

handle(Channel.projectsCurrent, () =>
  runtime.runPromise(
    Effect.map(
      OpenProject.use((o) => o.current),
      (current) => Option.getOrNull(current)?.id ?? null
    )
  )
);

handle(Channel.projectsOpen, (id) =>
  runtime.runPromise(OpenProject.use((o) => o.open(String(id))))
);

handle(Channel.projectsAdd, () =>
  runtime.runPromise(Effect.asVoid(OpenProject.use((o) => o.add)))
);

/** A folder named on the command line, after the app's own path in development. */
const folderArgument = (argv: readonly string[]) =>
  argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-"));

const makeWindow = () => {
  const created = new BrowserWindow({
    backgroundColor: "#1a1a1d",
    height: 950,
    show: false,
    title: "Ultrapaint",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(appDir, "preload.cjs"),
      sandbox: true,
    },
    width: 1500,
  });
  // Kept hidden for automated checks, which drive it through the DevTools protocol.
  if (!process.env.ULTRAPAINT_DESKTOP_HIDDEN) {
    created.once("ready-to-show", () => created.show());
  }
  // The editor stays on its server; a link elsewhere opens in the user's browser.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  created.webContents.on("will-navigate", (event, url) => {
    const current = created.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault();
    }
  });
  created.on("closed", () => {
    window = null;
  });
  return created;
};

const start = async () => {
  await app.whenReady();
  window = makeWindow();
  const folder = folderArgument(process.argv);
  await runtime.runPromise(
    OpenProject.use((o) =>
      folder ? Effect.ignore(o.openFolder(path.resolve(folder))) : o.start
    )
  );
};

// One app at a time: a second start brings the first forward, with the folder it was given.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    if (window?.isMinimized()) {
      window.restore();
    }
    window?.focus();
    const folder = folderArgument(argv);
    if (folder) {
      runtime
        .runPromise(
          Effect.ignore(
            OpenProject.use((o) =>
              o.openFolder(path.resolve(workingDirectory, folder))
            )
          )
        )
        .catch(() => undefined);
    }
  });
} else {
  app.quit();
}

/*
 * Closing the window quits (D13). The server the app started stops first, once the user agreed
 * to stop agents at work in it; a signal does not wait for an answer. `quitting` lets the close
 * and the quit through once that is done.
 */
let quitting = false;
let asking = false;
const quit = (ask: boolean) => {
  // A signal is not held up by a question already on screen.
  if (quitting || (asking && ask)) {
    return;
  }
  asking = asking || ask;
  runtime
    .runPromise(OpenProject.use((o) => o.stop({ ask })))
    .then(async (stopped) => {
      asking = false;
      if (!stopped) {
        return;
      }
      quitting = true;
      await runtime.dispose();
      app.quit();
    })
    .catch(() => {
      quitting = true;
      app.quit();
    });
};

app.on("browser-window-created", (_event, created) => {
  created.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      quit(true);
    }
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    quit(true);
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => quit(false));
}

if (app.hasSingleInstanceLock()) {
  start().catch((error: unknown) => {
    dialog.showErrorBox(
      "Ultrapaint could not start",
      error instanceof Error ? error.message : String(error)
    );
    app.exit(1);
  });
}
