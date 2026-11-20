/**
 * The desktop app (ADR 0031): a window around the same server and the same web build the
 * `ultrapaint` command serves. The app keeps a list of projects, starts the server of each one
 * open in a tab (ADR 0107), loads their editors, and fills the editor's `Platform` with what a
 * browser cannot do. The window holds the tab strip over a project view per open project and Home.
 * Nothing of the editor lives here; what the app decides lives in its services, and this file
 * connects them to Electron.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import type { StateName } from "@ultrapaint/contracts/shell-bridge";
import { userFolderLocationFile } from "@ultrapaint/contracts/user-folder";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  type WebContents,
  WebContentsView,
} from "electron";
import { autoUpdater } from "electron-updater";
import { AgentDownloads } from "./agent-downloads.ts";
import { releasesFor } from "./agent-releases.ts";
import { AgentSettings } from "./agent-settings.ts";
import { Agents } from "./agents.ts";
import {
  APP_EDITOR_URL,
  APP_SCHEME,
  onOrigin,
  originOf,
} from "./app-editor.ts";
import { type BridgeInfo, INFO_CHANNEL } from "./bridge.ts";
import {
  type BridgeStates,
  bridgeInfo,
  type StateValue,
  serveBridge,
  stateMessage,
} from "./bridge-server.ts";
import { Caller } from "./caller.ts";
import { CommandLine, commandApp } from "./command-line.ts";
import { UpdateCheckError } from "./errors.ts";
import { Folders } from "./folders.ts";
import { bridgeHandlers, callerRemote } from "./handlers.ts";
import { LoginShell } from "./login-shell.ts";
import { NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProjects } from "./open-projects.ts";
import { ProjectServer } from "./project-server.ts";
import { ProjectStore } from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { SecretError, Secrets } from "./secrets.ts";
import { type Alert, Shell, type View } from "./shell.ts";
import { RemoteServers } from "./ssh-server.ts";
import { tabKey } from "./tab-keys.ts";
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
 * On a Mac the window draws no title bar: the tab strip is it (ADR 0107), its buttons inside the
 * strip's left end, centred on its height. Elsewhere the system draws the frame over the strip.
 */
const ownTitleBar = process.platform === "darwin";
/** The tab strip's height, in CSS pixels: the views below begin there. */
const STRIP_HEIGHT = 44;
const TRAFFIC_LIGHTS = { x: 14, y: 16 };
/** Where the strip's tabs may begin past the buttons: their width (52px) and a gap. */
const CONTROLS_INSET = TRAFFIC_LIGHTS.x + 52 + 16;

/** A view of the window: the tab strip, Home, or an open project's. */
type AppView =
  | { readonly kind: "strip" }
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly id: string };

/** The views over the window's own: the strip on top, Home and the project views below it. */
let strip: WebContentsView | null = null;
let home: WebContentsView | null = null;
const projectViews = new Map<string, WebContentsView>();
/** The project whose view is on screen; null for Home. */
let onScreen: string | null = null;
/** Whether the strip covers the window, for a menu or a dialog of its own. */
let covered = false;

/**
 * What every view is told as it changes: an update of the app, the open tabs, and the notice of
 * another project's agent.
 */
const shared: BridgeStates = { projectNotice: null, tabs: [], update: null };
/** What a view of no project is told of one: nothing. */
const NO_PROJECT: BridgeStates = {
  editorServer: null,
  opening: null,
  projectId: null,
  shellStatus: null,
};
/** What each project view is told of its own: its id, its server, its opening, its status. */
const projectStates = new Map<string, BridgeStates>();
/** The window's buttons, which the strip leaves room for: on a Mac only. */
let windowControls = ownTitleBar
  ? { fullScreen: false, inset: CONTROLS_INSET }
  : undefined;

/** The states a view's page reads as it loads. */
const statesOf = (from: AppView): BridgeStates => ({
  ...shared,
  ...NO_PROJECT,
  ...(from.kind === "project"
    ? { ...projectStates.get(from.id), projectId: from.id }
    : {}),
  ...(from.kind === "strip" && windowControls ? { windowControls } : {}),
});

const sendTo = <K extends StateName>(
  view: WebContentsView | null | undefined,
  name: K,
  value: StateValue<K>
) => {
  if (view && !view.webContents.isDestroyed()) {
    const { channel, value: encoded } = stateMessage(name, value);
    view.webContents.send(channel, encoded);
  }
};

/** Tells every view a state they share. */
const tellAll = <K extends StateName>(name: K, value: StateValue<K>) => {
  shared[name] = value;
  for (const view of [strip, home, ...projectViews.values()]) {
    sendTo(view, name, value);
  }
};

/** Tells a project view a state of its own, kept for it loading later. */
const tellProject = <K extends StateName>(
  id: string,
  name: K,
  value: StateValue<K>
) => {
  const states = projectStates.get(id) ?? {};
  states[name] = value;
  projectStates.set(id, states);
  sendTo(projectViews.get(id), name, value);
};

/** The view a message comes from: only the app's own views may call the main process. */
const viewOf = (sender: WebContents): AppView | undefined => {
  if (strip?.webContents === sender) {
    return { kind: "strip" };
  }
  if (home?.webContents === sender) {
    return { kind: "home" };
  }
  for (const [id, view] of projectViews) {
    if (view.webContents === sender) {
      return { id, kind: "project" };
    }
  }
  return undefined;
};

/**
 * The origin the app gave each view: the app's own for the strip, Home and a project's splash,
 * its server's for a project's editor (moved with it, over SSH). A view shows nothing else, and
 * calls the bridge only from it.
 */
const assigned = new WeakMap<WebContents, string>();

/** The view a message comes from, while what it shows is on the origin the app gave it. */
const trustedViewOf = (sender: WebContents): AppView | undefined =>
  onOrigin(sender.getURL(), assigned.get(sender)) ? viewOf(sender) : undefined;

/** Who calls, as the handlers ask: a project view, or one of none. */
const callerOf = (from: AppView) =>
  Caller.layer(from.kind === "project" ? from.id : null);

/**
 * The editor's build, served to the window under the app's own scheme for the pages that have no
 * server behind them: the welcome page. Its absolute paths (`/assets/…`) resolve as they do
 * when a server serves it.
 */
const webDir = path.join(appDir, "web");
protocol.registerSchemesAsPrivileged([
  {
    privileges: { secure: true, standard: true, supportFetchAPI: true },
    scheme: APP_SCHEME,
  },
]);

/**
 * What the app's own projectViews may connect to: themselves and a server on this machine, which a
 * project over SSH is forwarded to; nothing else (ADR 0100). The start page sets a stricter one
 * of its own.
 */
const CONNECT_POLICY = [
  "connect-src 'self'",
  // No IPv6 literal: a policy cannot name one, and the app's servers listen on 127.0.0.1.
  ...["127.0.0.1", "localhost"].flatMap((host) => [
    `http://${host}:*`,
    `ws://${host}:*`,
  ]),
].join(" ");

/**
 * A file of the editor's build, and nothing outside it. An address that names no file (no
 * extension) is the editor's own page, `index.html`, whose router reads it, as the server serves
 * it (ADR 0100); a missing file stays missing.
 */
const serveWeb = async (request: Request) => {
  const { pathname } = new URL(request.url);
  const file = path.join(webDir, decodeURIComponent(pathname));
  if (!(file === webDir || file.startsWith(webDir + path.sep))) {
    return new Response(null, { status: 404 });
  }
  const isFile = existsSync(file) && statSync(file).isFile();
  if (!isFile && path.extname(file) !== "") {
    return new Response(null, { status: 404 });
  }
  const page = isFile ? file : path.join(webDir, "index.html");
  const response = await net.fetch(pathToFileURL(page).href);
  if (!page.endsWith(".html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CONNECT_POLICY);
  return new Response(response.body, { headers, status: response.status });
};

/** Lays the views out: the strip over the top (or the whole window, covered), the views below. */
const layout = () => {
  if (!window) {
    return;
  }
  const { height, width } = window.getContentBounds();
  const below = {
    height: Math.max(0, height - STRIP_HEIGHT),
    width,
    x: 0,
    y: STRIP_HEIGHT,
  };
  home?.setBounds(below);
  for (const view of projectViews.values()) {
    view.setBounds(below);
  }
  strip?.setBounds({
    height: covered ? height : STRIP_HEIGHT,
    width,
    x: 0,
    y: 0,
  });
};

/** Puts a project view on screen, or Home with `null`, and gives it the keys. */
const showOnScreen = (id: string | null) => {
  onScreen = id;
  home?.setVisible(id === null);
  for (const [viewId, view] of projectViews) {
    view.setVisible(viewId === id);
  }
  if (!covered) {
    (id === null ? home : projectViews.get(id))?.webContents.focus();
  }
};

/** The editor's canvas in the theme it opens in, so that a page shows no flash before it draws. */
const canvasColor = () =>
  nativeTheme.shouldUseDarkColors ? "#121110" : "#ecebe8";

/**
 * Keeps a view on the app's own pages and its servers: a link elsewhere opens in the user's
 * browser. ⌘1–9 show a tab, wherever the focus is.
 */
const guard = (contents: WebContents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  // Nowhere but the origin the app gave it, whether a page goes or a server redirects it.
  const stayHome = (event: { preventDefault: () => void }, url: string) => {
    if (!onOrigin(url, assigned.get(contents))) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", stayHome);
  contents.on("will-redirect", stayHome);
  contents.on("before-input-event", (event, input) => {
    const n = tabKey(input, process.platform === "darwin");
    if (n !== null) {
      event.preventDefault();
      runtime
        .runPromise(OpenProjects.use((o) => o.showAt(n)))
        // Showing a tab fails only once the runtime is let go, as the app quits.
        .catch(() => undefined);
    }
  });
};

/** A view of one of the app's projectViews, with the bridge, over the window. */
const makeView = (background = canvasColor()) => {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      preload: path.join(appDir, "preload.cjs"),
      sandbox: true,
    },
  });
  view.setBackgroundColor(background);
  guard(view.webContents);
  return view;
};

/** The app's own page at `file`, under its scheme. */
const appPage = (file: string) => `${APP_SCHEME}://app/${file}`;

/** Each view's latest load: one that fails once another began was superseded. */
const latestLoad = new WeakMap<WebContentsView, number>();

/**
 * Loads a page in a view, the origin it may show from then on. A load superseded by another, or
 * of a view let go, is no failure; any other of a project view that fails (its server stopped
 * answering, a redirect turned away) says why on the project's splash, with Try again.
 */
const loadIn = (view: WebContentsView, url: string, project?: string) => {
  // What it loads is the origin it is given, before any of it commits.
  const origin = originOf(url);
  if (origin !== null) {
    assigned.set(view.webContents, origin);
  }
  const load = (latestLoad.get(view) ?? 0) + 1;
  latestLoad.set(view, load);
  view.webContents
    .loadURL(url)
    .catch((error: unknown) => {
      const superseded =
        latestLoad.get(view) !== load ||
        view.webContents.isDestroyed() ||
        (project !== undefined && projectViews.get(project) !== view);
      return superseded || project === undefined
        ? undefined
        : runtime.runPromise(
            OpenProjects.use((o) =>
              o.loadFailed(
                project,
                `The editor at ${url} did not load: ${error instanceof Error ? error.message : String(error)}`
              )
            )
          );
    })
    // Saying so fails only once the runtime is let go, as the app quits.
    .catch(() => undefined);
};

/** Loads a project view, making it, below the strip, when it has none. */
const loadProjectView = (id: string, view: View) => {
  if (!window) {
    return;
  }
  let target = projectViews.get(id);
  if (!target) {
    target = makeView();
    projectViews.set(id, target);
    window.contentView.addChildView(target);
    target.setVisible(onScreen === id);
    // The strip stays over every project view.
    if (strip) {
      window.contentView.addChildView(strip);
    }
    layout();
  }
  if (view._tag === "Opening") {
    // The app's own page, under the splash of the project opening: drawn from its `opening`.
    loadIn(target, appPage("welcome.html"));
    return;
  }
  // Told before the view loads: the app's own editor reads it as it starts (ADR 0100).
  tellProject(id, "editorServer", view.server ?? null);
  const next = new URL(view.url);
  const was = target.webContents.getURL();
  // The address it was at, in either editor: the server's (http) or the app's own.
  if (
    view.keepLocation &&
    (was.startsWith("http") || was.startsWith(APP_EDITOR_URL))
  ) {
    const current = new URL(was);
    next.pathname = current.pathname;
    next.search = current.search;
    next.hash = current.hash;
  }
  loadIn(target, next.href, id);
};

/** Lets go of a project view; what it was told is kept for its next load. */
const dropProjectView = (id: string) => {
  const target = projectViews.get(id);
  if (!target) {
    return;
  }
  projectViews.delete(id);
  window?.contentView.removeChildView(target);
  target.webContents.close();
};

/** The strip covers the window while a menu or a dialog of its own is open, and goes back. */
const coverWindow = (cover: boolean) => {
  covered = cover;
  layout();
  if (cover) {
    strip?.webContents.focus();
  } else {
    showOnScreen(onScreen);
  }
};

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

/** Brings the window forward, as a click on one of the system's notifications does. */
const bringForward = () => {
  if (window?.isMinimized()) {
    window.restore();
  }
  window?.show();
  window?.focus();
};

/**
 * The system's word of another project's agent: its notification, which shows that project's tab
 * when clicked, and the system's own sound with it or alone.
 */
const alertPerson = (alert: Alert) => {
  if (alert.notification && Notification.isSupported()) {
    const shown = new Notification({
      body: alert.body,
      silent: !alert.sound,
      title: alert.title,
    });
    shown.on("click", () => {
      bringForward();
      runtime
        .runPromise(OpenProjects.use((o) => o.show(alert.project)))
        // Showing a tab fails only once the runtime is let go, as the app quits.
        .catch(() => undefined);
    });
    shown.show();
    return;
  }
  if (alert.sound) {
    shell.beep();
  }
};

const ElectronShell = Layer.succeed(
  Shell,
  Shell.of({
    alert: (alert) => Effect.sync(() => alertPerson(alert)),
    confirm: ({ action, cancel, detail, message }) =>
      // Interrupted (a signal answered it), the box closes as if cancelled.
      Effect.promise(async (signal) => {
        const options = {
          buttons: [action, cancel ?? "Cancel"],
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
    drop: (id) => Effect.sync(() => dropProjectView(id)),
    focused: Effect.sync(() => window?.isFocused() === true),
    load: (id, view) => Effect.sync(() => loadProjectView(id, view)),
    notice: (notice) => Effect.sync(() => tellAll("projectNotice", notice)),
    opening: (id, opening) =>
      Effect.sync(() => tellProject(id, "opening", opening)),
    // Electron answers with why it couldn't, or nothing.
    openPath: (folder) =>
      Effect.promise(() => shell.openPath(folder)).pipe(
        Effect.map((why) => Option.fromNullishOr(why || undefined))
      ),
    pickFile: (title) =>
      pickPath({ properties: ["openFile", "showHiddenFiles"], title }),
    pickFolder: ({ defaultPath, title }) =>
      pickPath({
        ...(defaultPath ? { defaultPath } : {}),
        properties: ["openDirectory", "createDirectory"],
        title,
      }),
    show: (id) => Effect.sync(() => showOnScreen(id)),
    status: (id, status) =>
      Effect.sync(() => tellProject(id, "shellStatus", status)),
    tabs: (tabs) => Effect.sync(() => tellAll("tabs", tabs)),
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
      // Asked only once GitHub lists a newer release: the check waits for its download, as the
      // macOS app's does, and `update-downloaded` says it is there. A feed that has none yet (its
      // files not uploaded) or a download that fails is a check that failed.
      check: Effect.tryPromise({
        catch: (error) =>
          new UpdateCheckError({
            message: `the AppImage feed: ${String(error)}`,
          }),
        try: () => autoUpdater.checkForUpdates(),
      }).pipe(
        Effect.filterOrFail(
          (result) => result?.isUpdateAvailable === true,
          () =>
            new UpdateCheckError({
              message: "the AppImage feed lists no newer release yet",
            })
        ),
        Effect.flatMap((result) =>
          Effect.tryPromise({
            catch: (error) =>
              new UpdateCheckError({
                message: `the AppImage download: ${String(error)}`,
              }),
            try: async () => {
              await result?.downloadPromise;
            },
          })
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
      Layer.provideMerge(
        OpenProjects.layer(dataDir, {
          url: APP_EDITOR_URL,
          version: app.getVersion(),
        })
      )
    ),
    Notices.layer,
    Updater.layer({
      current: app.getVersion(),
      fetch,
      mode: installMode,
      publish: (update) => tellAll("update", update),
    })
  ).pipe(
    Layer.provideMerge(ProjectStore.layer(dataDir)),
    Layer.provideMerge(
      Folders.layer({
        dataDir,
        home: app.getPath("home"),
        location: userFolderLocationFile({
          env: process.env,
          home: app.getPath("home"),
          platform: process.platform,
        }),
      })
    ),
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
    Layer.provideMerge(
      CommandLine.layer({
        app: commandApp({
          appDir,
          // An AppImage says where it is and where it mounted itself.
          appImage:
            process.env.APPIMAGE && process.env.APPDIR
              ? Option.some({
                  dir: process.env.APPDIR,
                  file: process.env.APPIMAGE,
                })
              : Option.none(),
          executable: process.execPath,
        }),
        home: app.getPath("home"),
        platform: process.platform,
      })
    ),
    // Read once, as the app starts.
    Layer.provideMerge(LoginShell.layer),
    Layer.provideMerge(ProjectServer.layer(serverLaunch)),
    Layer.provideMerge(ElectronShell),
    Layer.provideMerge(NodeServices.layer)
  )
);

/** What the preload script asks before the page loads: synchronous for the page. */
ipcMain.on(INFO_CHANNEL, (event) => {
  // The page loading, as its frame says: the address it is committing to.
  const address = event.senderFrame?.url ?? event.sender.getURL();
  const from = onOrigin(address, assigned.get(event.sender))
    ? viewOf(event.sender)
    : undefined;
  if (!from) {
    event.returnValue = { shown: [] } satisfies BridgeInfo;
    return;
  }
  runtime
    .runPromise(callerRemote.pipe(Effect.provide(callerOf(from))))
    .catch(() => false)
    .then((remote) => {
      event.returnValue = bridgeInfo(remote, statesOf(from));
    });
});

serveBridge({
  handlers: bridgeHandlers({
    coverWindow: (cover) => Effect.sync(() => coverWindow(cover)),
    home: app.getPath("home"),
    installUpdate: Effect.sync(() => quit(true, true)),
    sshConfig: sshConfig ?? path.join(app.getPath("home"), ".ssh", "config"),
  }),
  ipc: ipcMain,
  remote: callerRemote,
  run: (effect, from) =>
    runtime.runPromise(effect.pipe(Effect.provide(callerOf(from)))),
  viewOf: trustedViewOf,
});

/** A folder named on the command line, after the app's own path in development. */
const folderArgument = (argv: readonly string[]) =>
  argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-"));

/**
 * The window, its own page left empty: the strip, Home and the projects' projectViews are views over it,
 * so that a switch between tabs loads nothing (ADR 0107).
 */
const makeWindow = () => {
  const created = new BrowserWindow({
    // The editor's canvas in the theme it opens in, so the window shows no flash before it draws.
    backgroundColor: canvasColor(),
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
    webPreferences: { contextIsolation: true, sandbox: true },
    width: 1500,
  });
  guard(created.webContents);
  created.on("closed", () => {
    window = null;
  });
  created.on("resize", layout);
  // Full screen draws no buttons: the strip takes their room back.
  if (ownTitleBar) {
    const fullScreen = (full: boolean) => {
      windowControls = { fullScreen: full, inset: CONTROLS_INSET };
      sendTo(strip, "windowControls", windowControls);
    };
    created.on("enter-full-screen", () => fullScreen(true));
    created.on("leave-full-screen", () => fullScreen(false));
  }
  return created;
};

/** The strip and Home, over the window: the strip's page draws on a transparent view. */
const makeViews = (over: BrowserWindow) => {
  home = makeView();
  over.contentView.addChildView(home);
  loadIn(home, appPage("welcome.html"));
  strip = makeView("#00000000");
  over.contentView.addChildView(strip);
  // Kept hidden for automated checks, which drive it through the DevTools protocol.
  if (!process.env.ULTRAPAINT_DESKTOP_HIDDEN) {
    strip.webContents.once("did-finish-load", () => over.show());
  }
  loadIn(strip, appPage("tabs.html"));
  showOnScreen(null);
  layout();
};

const start = async () => {
  await app.whenReady();
  protocol.handle(APP_SCHEME, serveWeb);
  window = makeWindow();
  makeViews(window);
  if (installMode._tag === "Feed") {
    autoUpdater.on("update-downloaded", ({ version }) => {
      runtime
        .runPromise(Updater.use((u) => u.downloaded(version)))
        .catch(() => undefined);
    });
  }
  const folder = folderArgument(process.argv);
  await runtime.runPromise(
    OpenProjects.use((o) => o.start(folder ? path.resolve(folder) : undefined))
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
            OpenProjects.use((o) =>
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
 * Closing the window quits (D13). The servers the app started stop first, once the user agreed
 * to stop agents at work in them (a second close or Cmd-Q meanwhile has the same answer); a
 * signal does not wait for an answer, and answers no to a question already on screen
 * (`OpenProjects`).
 * `quitting` lets the close and the quit through once that is done. With `update`, the app
 * comes back as the release it downloaded (ADR 0078).
 */
let quitting = false;
const quit = (ask: boolean, update = false) => {
  if (quitting) {
    return;
  }
  runtime
    .runPromise(OpenProjects.use((o) => o.stop({ ask })))
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
