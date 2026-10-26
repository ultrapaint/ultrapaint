/**
 * The desktop app (ADR 0031): a window around the same server and the same web build the
 * `ultrapaint` command serves. The app starts the server for the open project, loads its editor,
 * and fills the editor's `Platform` with what a browser cannot do. Nothing of the editor lives
 * here.
 */
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Exit, Layer, ManagedRuntime, Schema, Scope } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from "electron";
import { Channel, type PickFolderOptions } from "./ipc.ts";
import { ProjectServer } from "./project-server.ts";

/** In development, how the server is started from its sources; packaged, its bundle beside this. */
const DevServerArgs = Schema.fromJsonString(Schema.Array(Schema.String));

// A data directory of its own, for trying the app without touching the user's.
if (process.env.ULTRAPAINT_DESKTOP_USER_DATA) {
  app.setPath(
    "userData",
    path.resolve(process.env.ULTRAPAINT_DESKTOP_USER_DATA)
  );
}

const appDir = app.getAppPath();
const devServer = process.env.ULTRAPAINT_DESKTOP_SERVER_ARGS;
const serverArgs = devServer
  ? Schema.decodeUnknownSync(DevServerArgs)(devServer)
  : [path.join(appDir, "server", "bin.mjs")];

const runtime = ManagedRuntime.make(
  ProjectServer.layer({
    args: serverArgs,
    command: process.execPath,
    webDist: path.join(appDir, "web"),
  }).pipe(Layer.provideMerge(NodeServices.layer))
);

/** The folder given on the command line: after the app's own path in development. */
const folderArgument = () =>
  process.argv
    .slice(app.isPackaged ? 1 : 2)
    .find((arg) => !arg.startsWith("-"));

let window: BrowserWindow | null = null;
/** The open project's server lives in this scope; closing it stops the server. */
let serverScope: Scope.Closeable | null = null;

/** Only the editor's own pages may call the main process. */
const fromEditor = (event: IpcMainInvokeEvent) =>
  window !== null && event.sender === window.webContents;

ipcMain.handle(
  Channel.pickFolder,
  async (event, options: PickFolderOptions | undefined) => {
    if (!(fromEditor(event) && window)) {
      return null;
    }
    const picked = await dialog.showOpenDialog(window, {
      ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
      properties: ["openDirectory", "createDirectory"],
      title: options?.title ?? "Choose a folder",
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  }
);

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
  return created;
};

const openFolder = async (folder: string) => {
  const scope = await runtime.runPromise(Scope.make());
  serverScope = scope;
  const server = await runtime.runPromise(
    ProjectServer.use((s) =>
      s.start({
        cwd: folder,
        env: {},
        sessionDir: path.join(app.getPath("userData"), "sessions", "default"),
      })
    ).pipe(Scope.provide(scope))
  );
  console.error(`[desktop] ${folder}: the editor is at ${server.url}`);
  await window?.loadURL(server.url);
};

const start = async () => {
  await app.whenReady();
  window = makeWindow();
  window.on("closed", () => {
    window = null;
  });
  let folder = folderArgument();
  if (!folder) {
    const picked = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Open a project folder",
    });
    [folder] = picked.filePaths;
  }
  if (!folder) {
    app.quit();
    return;
  }
  await openFolder(path.resolve(folder));
};

// Closing the window quits; the server the app started stops before the app is gone.
app.on("window-all-closed", () => app.quit());
let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) {
    return;
  }
  stopping = true;
  event.preventDefault();
  const scope = serverScope;
  serverScope = null;
  (scope
    ? runtime.runPromise(Scope.close(scope, Exit.void))
    : Promise.resolve()
  )
    .then(() => runtime.dispose())
    .finally(() => app.quit());
});

// A signal quits as the window's close does, so that the servers stop first.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => app.quit());
}

start().catch((error: unknown) => {
  dialog.showErrorBox(
    "Ultrapaint could not start",
    error instanceof Error ? error.message : String(error)
  );
  app.exit(1);
});
