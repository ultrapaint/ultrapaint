/**
 * The desktop app (ADR 0031): a window around the same server and the same web build the
 * `ultrapaint` command serves. The app keeps a list of projects, starts the server of the one
 * open, loads its editor, and fills the editor's `Platform` with what a browser cannot do.
 * Nothing of the editor lives here; what the app decides lives in its services, and this file
 * connects them to Electron.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import type { StateName } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  type WebContents,
} from "electron";
import { autoUpdater } from "electron-updater";
import { AgentDownloads } from "./agent-downloads.ts";
import { releasesFor } from "./agent-releases.ts";
import { AgentSettings } from "./agent-settings.ts";
import { Agents } from "./agents.ts";
import { type BridgeInfo, INFO_CHANNEL } from "./bridge.ts";
import {
  type BridgeStates,
  bridgeInfo,
  type StateValue,
  serveBridge,
  stateMessage,
} from "./bridge-server.ts";
import { bridgeHandlers, remoteOpen } from "./handlers.ts";
import { LoginShell } from "./login-shell.ts";
import { NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectServer } from "./project-server.ts";
import { ProjectStore } from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { SecretError, Secrets } from "./secrets.ts";
import { Shell, type View } from "./shell.ts";
import { RemoteServers } from "./ssh-server.ts";
import { type InstallMode, Updater } from "./updater.ts";

// A data directory of its own, for trying the app without touching the user's.
if (process.env.ULTRAPAINT_DESKTOP_USER_DATA) {
  app.setPath(
    "userData",
    path.resolve(process.env.ULTRAPAINT_DESKTOP_USER_DATA)
  );
}

/**
 * An SSH configuration in place of `~/.ssh/config`, for every `ssh` the app runs and for the
 * hosts it suggests: for trying remote projects against a throwaway server.
 */
const sshConfig = process.env.ULTRAPAINT_DESKTOP_SSH_CONFIG
  ? path.resolve(process.env.ULTRAPAINT_DESKTOP_SSH_CONFIG)
  : undefined;

/** In development, how the server is started from its sources; packaged, its bundle beside this. */
const DevServerArgs = Schema.fromJsonString(Schema.Array(Schema.String));

const appDir = app.getAppPath();
const dataDir = app.getPath("userData");
const devServer = process.env.ULTRAPAINT_DESKTOP_SERVER_ARGS;
const serverArgs = devServer
  ? Schema.decodeUnknownSync(DevServerArgs)(devServer)
  : [path.join(appDir, "server", "bin.mjs")];

let window: BrowserWindow | null = null;

/**
 * On a Mac the window draws no title bar: its buttons sit inside the editor's title card, the
 * top-left of the floating cards (8px from the window's edges, 48px tall), centred on its
 * height. Elsewhere the system draws the frame.
 */
const ownTitleBar = process.platform === "darwin";
const TRAFFIC_LIGHTS = { x: 22, y: 26 };
/**
 * Where the editor's content may begin past the buttons: their width (52px) and a gap wide
 * enough that the mark reads as the project's row, not a fourth button.
 */
const CONTROLS_INSET = TRAFFIC_LIGHTS.x + 52 + 24;

/**
 * What the window tells the page as it changes (the bridge's states), kept for a page that loads
 * meanwhile: what the app is doing for the open project, and the window's buttons on a Mac.
 */
const states: BridgeStates = {
  shellStatus: null,
  update: null,
  ...(ownTitleBar
    ? { windowControls: { fullScreen: false, inset: CONTROLS_INSET } }
    : {}),
};

const tell = <K extends StateName>(name: K, value: StateValue<K>) => {
  states[name] = value;
  const { channel, value: encoded } = stateMessage(name, value);
  window?.webContents.send(channel, encoded);
};

/**
 * The editor's build, served to the window under the app's own scheme for the pages that have no
 * server behind them: the welcome page. Its absolute paths (`/assets/…`) resolve as they do
 * when a server serves it.
 */
const APP_SCHEME = "ultrapaint";
const webDir = path.join(appDir, "web");
protocol.registerSchemesAsPrivileged([
  {
    privileges: { secure: true, standard: true, supportFetchAPI: true },
    scheme: APP_SCHEME,
  },
]);

/** A file of the editor's build, and nothing outside it. */
const serveWeb = (request: Request) => {
  const file = path.join(
    webDir,
    decodeURIComponent(new URL(request.url).pathname)
  );
  return file.startsWith(webDir + path.sep)
    ? net.fetch(pathToFileURL(file).href)
    : new Response(null, { status: 404 });
};

const showView = (view: View) =>
  Effect.promise(async () => {
    if (!window) {
      return;
    }
    if (view._tag === "Editor") {
      const next = new URL(view.url);
      const was = window.webContents.getURL();
      if (view.keepLocation && was.startsWith("http")) {
        const current = new URL(was);
        next.pathname = current.pathname;
        next.search = current.search;
        next.hash = current.hash;
      }
      await window.loadURL(next.href);
      return;
    }
    const welcome = new URL(`${APP_SCHEME}://app/welcome.html`);
    if (view._tag === "Opening") {
      welcome.searchParams.set("opening", view.name);
      welcome.searchParams.set("detail", view.detail);
    } else if (view.problem) {
      welcome.searchParams.set("problem", view.problem);
    }
    if (view._tag === "Welcome" && view.back) {
      welcome.searchParams.set("back", view.back);
    }
    await window.loadURL(welcome.href);
  }).pipe(
    // A page that did not finish loading (the user switched again meanwhile) is not an error.
    Effect.catchDefect(() => Effect.void)
  );

/** The native picker, over the window when there is one; nothing when it is cancelled. */
const pickPath = (options: Electron.OpenDialogOptions) =>
  Effect.promise(async () => {
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return Option.fromNullishOr(
      picked.canceled ? undefined : picked.filePaths[0]
    );
  });

const ElectronShell = Layer.succeed(
  Shell,
  Shell.of({
    confirm: ({ action, detail, message }) =>
      // Interrupted (a signal answered it), the box closes as if cancelled.
      Effect.promise(async (signal) => {
        const options = {
          buttons: [action, "Cancel"],
          cancelId: 1,
          defaultId: 1,
          detail,
          message,
          signal,
          type: "question" as const,
        };
        const answer = window
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options);
        return answer.response === 0;
      }),
    pickFile: (title) =>
      pickPath({ properties: ["openFile", "showHiddenFiles"], title }),
    pickFolder: ({ defaultPath, title }) =>
      pickPath({
        ...(defaultPath ? { defaultPath } : {}),
        properties: ["openDirectory", "createDirectory"],
        title,
      }),
    show: showView,
    status: (status) => Effect.sync(() => tell("shellStatus", status)),
  })
);

/**
 * The keychain Electron reaches. On Linux without a Secret Service or KWallet it falls back to a
 * fixed password, which keeps nothing secret: no key is kept then.
 */
const keychain = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    safeStorage.getSelectedStorageBackend() !== "basic_text");

const ElectronSecrets = Layer.sync(Secrets, () =>
  Secrets.of({
    available: keychain(),
    decrypt: (sealed) =>
      Effect.try({
        catch: () =>
          new SecretError({ message: "the key kept could not be read" }),
        try: () => safeStorage.decryptString(Buffer.from(sealed, "base64")),
      }),
    encrypt: (plain) =>
      keychain()
        ? Effect.try({
            catch: () =>
              new SecretError({ message: "the key could not be encrypted" }),
            try: () => safeStorage.encryptString(plain).toString("base64"),
          })
        : Effect.fail(
            new SecretError({
              message: "there is no keychain to keep the key in",
            })
          ),
  })
);

/**
 * How this copy updates (ADR 0078): the macOS app replaces its own bundle, wherever it runs from
 * (unsigned, Squirrel will not); an AppImage through electron-updater; a deb by hand. Nothing in
 * development.
 */
const installMode = ((): InstallMode => {
  if (!app.isPackaged) {
    return { _tag: "None" };
  }
  if (process.platform === "darwin") {
    return {
      _tag: "Swap",
      executable: app.getPath("exe"),
      stageDir: path.join(dataDir, "updates"),
    };
  }
  if (process.platform === "linux" && process.env.APPIMAGE) {
    return {
      _tag: "Feed",
      // Downloaded in the background; `update-downloaded` says when it is there.
      check: Effect.promise(() =>
        autoUpdater.checkForUpdates().then(
          () => undefined,
          (error: unknown) =>
            console.error(
              `[desktop] the update could not be checked: ${String(error)}`
            )
        )
      ),
    };
  }
  return { _tag: "Download" };
})();

const serverLaunch = {
  args: serverArgs,
  command: process.execPath,
  webDist: webDir,
};

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    NewDesigns.layer({ home: app.getPath("home"), launch: serverLaunch }).pipe(
      Layer.provideMerge(OpenProject.layer(dataDir))
    ),
    Notices.layer,
    Updater.layer({
      current: app.getVersion(),
      fetch,
      mode: installMode,
      publish: (update) => tell("update", update),
    })
  ).pipe(
    Layer.provideMerge(ProjectStore.layer(dataDir)),
    Layer.provideMerge(
      Agents.layer({
        adaptersDir: path.join(appDir, "adapters"),
        node: process.execPath,
        version: app.getVersion(),
      })
    ),
    Layer.provideMerge(AgentSettings.layer(dataDir)),
    Layer.provideMerge(
      AgentDownloads.layer(path.join(dataDir, "agents"), releasesFor())
    ),
    Layer.provideMerge(ElectronSecrets),
    Layer.provideMerge(RemoteProjects.layer),
    Layer.provideMerge(
      RemoteServers.layer({ configFile: sshConfig, ssh: "ssh" })
    ),
    // Read once, as the app starts.
    Layer.provideMerge(LoginShell.layer),
    Layer.provideMerge(ProjectServer.layer(serverLaunch)),
    Layer.provideMerge(ElectronShell),
    Layer.provideMerge(NodeServices.layer)
  )
);

/** Whether a message comes from the app's own window: only it may call the main process. */
const fromWindow = (sender: WebContents) =>
  window !== null && sender === window.webContents;

/** What the preload script asks before the page loads: synchronous for the page. */
ipcMain.on(INFO_CHANNEL, (event) => {
  if (!fromWindow(event.sender)) {
    event.returnValue = { shown: [] } satisfies BridgeInfo;
    return;
  }
  runtime
    .runPromise(remoteOpen)
    .catch(() => false)
    .then((remote) => {
      event.returnValue = bridgeInfo(remote, states);
    });
});

serveBridge({
  fromWindow,
  handlers: bridgeHandlers({
    home: app.getPath("home"),
    installUpdate: Effect.sync(() => quit(true, true)),
    sshConfig: sshConfig ?? path.join(app.getPath("home"), ".ssh", "config"),
  }),
  ipc: ipcMain,
  remote: remoteOpen,
  run: (effect) => runtime.runPromise(effect),
});

/** A folder named on the command line, after the app's own path in development. */
const folderArgument = (argv: readonly string[]) =>
  argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-"));

const makeWindow = () => {
  const created = new BrowserWindow({
    // The editor's canvas in the theme it opens in, so the window shows no flash before it draws.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121110" : "#ecebe8",
    height: 950,
    // On Linux the window's own icon, for a start with no launcher entry (`pnpm desktop:dev`);
    // macOS takes the bundle's.
    ...(process.platform === "linux"
      ? { icon: path.join(appDir, "icon.png") }
      : {}),
    show: false,
    ...(ownTitleBar
      ? { titleBarStyle: "hidden", trafficLightPosition: TRAFFIC_LIGHTS }
      : {}),
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
  // Full screen draws no buttons: the title card takes their room back.
  if (ownTitleBar) {
    created.on("enter-full-screen", () =>
      tell("windowControls", { fullScreen: true, inset: CONTROLS_INSET })
    );
    created.on("leave-full-screen", () =>
      tell("windowControls", { fullScreen: false, inset: CONTROLS_INSET })
    );
  }
  return created;
};

const start = async () => {
  await app.whenReady();
  protocol.handle(APP_SCHEME, serveWeb);
  window = makeWindow();
  if (installMode._tag === "Feed") {
    autoUpdater.on("update-downloaded", ({ version }) => {
      runtime
        .runPromise(Updater.use((u) => u.downloaded(version)))
        .catch(() => undefined);
    });
  }
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
 * to stop agents at work in it (a second close or Cmd-Q meanwhile has the same answer); a signal
 * does not wait for an answer, and answers no to a question already on screen (`OpenProject`).
 * `quitting` lets the close and the quit through once that is done. With `update`, the app
 * comes back as the release it downloaded (ADR 0078).
 */
let quitting = false;
const quit = (ask: boolean, update = false) => {
  if (quitting) {
    return;
  }
  runtime
    .runPromise(OpenProject.use((o) => o.stop({ ask })))
    .then(async (stopped) => {
      // Not stopped, or another quit got there first.
      if (!stopped || quitting) {
        return;
      }
      quitting = true;
      // The macOS app: a script waits for it to exit, then puts the new bundle in its place.
      if (update) {
        await runtime.runPromise(Updater.use((u) => u.install));
      }
      await runtime.dispose();
      if (update && installMode._tag === "Feed") {
        autoUpdater.quitAndInstall(false, true);
        return;
      }
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
