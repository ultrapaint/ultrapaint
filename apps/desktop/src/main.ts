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
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell,
} from "electron";
import { AgentDownloads } from "./agent-downloads.ts";
import { releaseFor } from "./agent-releases.ts";
import { AgentSettings } from "./agent-settings.ts";
import { AGENTS, type AgentId, Agents, isAgentId } from "./agents.ts";
import {
  Channel,
  type ListedProject,
  type MappedUrl,
  type NewDesignUpdate,
  type PickFolderOptions,
  type ShellInfo,
  type ShellStatus,
  type WindowControlsInfo,
} from "./ipc.ts";
import { LoginShell } from "./login-shell.ts";
import { NewDesignRequest, NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectServer } from "./project-server.ts";
import { ProjectStore, projectDetail, remoteInputOf } from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { SecretError, Secrets } from "./secrets.ts";
import { Shell, type View } from "./shell.ts";
import { readSshHosts } from "./ssh-hosts.ts";
import { RemoteServers } from "./ssh-server.ts";

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
 * top-left of the floating cards (8px from the window's edges, 44px tall), centred on its
 * height. Elsewhere the system draws the frame.
 */
const ownTitleBar = process.platform === "darwin";
const TRAFFIC_LIGHTS = { x: 22, y: 24 };
/** Where the editor's content may begin past the buttons: their width (52px) and a gap. */
const CONTROLS_INSET = TRAFFIC_LIGHTS.x + 52 + 12;

const windowControls = (): WindowControlsInfo | null =>
  ownTitleBar
    ? { fullScreen: window?.isFullScreen() ?? false, inset: CONTROLS_INSET }
    : null;

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
    if (view.problem) {
      welcome.searchParams.set("problem", view.problem);
    }
    await window.loadURL(welcome.href);
  }).pipe(
    // A page that did not finish loading (the user switched again meanwhile) is not an error.
    Effect.catchDefect(() => Effect.void)
  );

/** What the app last told the window it is doing, for a page that loads meanwhile. */
let shellStatus: ShellStatus | null = null;

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
    status: (status) =>
      Effect.sync(() => {
        shellStatus = status;
        window?.webContents.send(Channel.shellStatus, status);
      }),
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
    Notices.layer
  ).pipe(
    Layer.provideMerge(ProjectStore.layer(dataDir)),
    Layer.provideMerge(
      Agents.layer({
        adaptersDir: path.join(appDir, "adapters"),
        node: process.execPath,
      })
    ),
    Layer.provideMerge(AgentSettings.layer(dataDir)),
    Layer.provideMerge(
      AgentDownloads.layer(path.join(dataDir, "agents"), {
        "claude-code": releaseFor("claude-code"),
        codex: releaseFor("codex"),
      })
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

/** Whether a message comes from the app's own window. */
const fromWindow = (event: IpcMainEvent) =>
  window !== null && event.sender === window.webContents;

/**
 * What the preload script asks before the page loads, and the preview's URL as the editor
 * renders it: both synchronous for the page, which waits while a port is forwarded.
 */
ipcMain.on(Channel.shellInfo, (event) => {
  const info: ShellInfo = {
    remote: false,
    status: null,
    windowControls: windowControls(),
  };
  if (!fromWindow(event)) {
    event.returnValue = info;
    return;
  }
  runtime
    .runPromise(OpenProject.use((o) => o.current))
    .then((current) => {
      event.returnValue = {
        remote: Option.isSome(current) && current.value.kind === "ssh",
        status: shellStatus,
        windowControls: windowControls(),
      } satisfies ShellInfo;
    })
    .catch(() => {
      event.returnValue = info;
    });
});

ipcMain.on(Channel.previewUrl, (event, url: unknown) => {
  const asItIs: MappedUrl = { forwarded: false, url: String(url) };
  if (!fromWindow(event)) {
    event.returnValue = asItIs;
    return;
  }
  runtime
    .runPromise(OpenProject.use((o) => o.mapPreviewUrl(String(url))))
    .then((mapped) => {
      event.returnValue = mapped;
    })
    .catch(() => {
      event.returnValue = asItIs;
    });
});

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

// What this machine lacks is no matter to a project whose server runs on another one.
handle(Channel.notices, () =>
  runtime.runPromise(
    Effect.flatMap(
      OpenProject.use((o) => o.current),
      (current) =>
        Option.isSome(current) && current.value.kind === "ssh"
          ? Effect.succeed([])
          : Notices.use((n) => n.list)
    )
  )
);

handle(Channel.agentsList, () =>
  runtime.runPromise(Agents.use((a) => a.status))
);

/** A change to an agent's settings, applied by starting the project's server again. */
const changeAgent = (id: unknown, executable: string | undefined) => {
  const agent = String(id);
  return runtime.runPromise(
    Effect.gen(function* () {
      if (!isAgentId(agent)) {
        return;
      }
      yield* AgentSettings.use((s) =>
        s.update(agent, (setting) => ({ ...setting, path: executable }))
      );
      yield* OpenProject.use((o) => o.restart);
    })
  );
};

handle(Channel.agentsChoosePath, async (id) => {
  if (!window) {
    return;
  }
  const picked = await dialog.showOpenDialog(window, {
    properties: ["openFile", "showHiddenFiles"],
    title: `Where is ${AGENTS[String(id) as AgentId]?.name ?? "the agent"}?`,
  });
  const [file] = picked.filePaths;
  if (!picked.canceled && file) {
    await changeAgent(id, file);
  }
});

handle(Channel.agentsClearPath, (id) => changeAgent(id, undefined));

/** Runs a change to an agent, then starts the project's server again to take it up. */
const applyToAgent = <E>(
  id: unknown,
  change: (agent: AgentId) => Effect.Effect<unknown, E, Agents>
) => {
  const agent = String(id);
  return runtime.runPromise(
    isAgentId(agent)
      ? Effect.andThen(
          change(agent),
          OpenProject.use((o) => o.restart)
        )
      : Effect.void
  );
};

handle(Channel.agentsDownload, (id) =>
  applyToAgent(id, (agent) => Agents.use((a) => a.download(agent)))
);

handle(Channel.agentsSetApiKey, (id, key) =>
  applyToAgent(id, (agent) =>
    Agents.use((a) =>
      a.setApiKey(
        agent,
        typeof key === "string" && key.trim() ? key : undefined
      )
    )
  )
);

// Codex keeps its sign-in itself: nothing to start again.
handle(Channel.agentsSignIn, (id) => {
  const agent = String(id);
  return runtime.runPromise(
    isAgentId(agent) ? Agents.use((a) => a.signIn(agent)) : Effect.void
  );
});

handle(Channel.projectsList, () =>
  runtime.runPromise(
    Effect.map(
      ProjectStore.use((store) => store.list),
      (projects) =>
        projects.map(
          (p): ListedProject => ({
            detail: projectDetail(p),
            id: p.id,
            name: p.name,
          })
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

const RemoteRequest = Schema.Struct({
  command: Schema.optional(Schema.String),
  host: Schema.String,
  path: Schema.String,
});
const decodeRemoteRequest = Schema.decodeUnknownEffect(RemoteRequest);

/**
 * Adds a folder on another machine and opens it. What is wrong with the fields comes back to
 * the dialog; a project that does not open shows why on the welcome page, as any project does.
 */
handle(Channel.projectsAddRemote, (request) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fields = yield* decodeRemoteRequest(request);
      const checked = remoteInputOf(fields);
      if ("problem" in checked) {
        return { problem: checked.problem };
      }
      yield* Effect.ignore(OpenProject.use((o) => o.addRemote(checked.input)));
      return {};
    })
  )
);

handle(Channel.sshHosts, () =>
  runtime.runPromise(
    readSshHosts(
      sshConfig ?? path.join(app.getPath("home"), ".ssh", "config"),
      app.getPath("home")
    )
  )
);

const decodeNewDesign = Schema.decodeUnknownEffect(NewDesignRequest);

handle(Channel.newDesignFolder, (name) =>
  runtime.runPromise(NewDesigns.use((n) => n.folderFor(String(name ?? ""))))
);

/** Writes a new design, its steps sent to the window as they go, then opens it. */
handle(Channel.newDesignCreate, (request) =>
  runtime.runPromise(
    Effect.flatMap(decodeNewDesign(request), (decoded) =>
      NewDesigns.use((n) =>
        n.create(decoded, (update: NewDesignUpdate) =>
          Effect.sync(() =>
            window?.webContents.send(Channel.newDesignProgress, update)
          )
        )
      )
    )
  )
);

handle(Channel.newDesignOpen, (folder, name, template) =>
  runtime.runPromise(
    NewDesigns.use((n) =>
      n.open(
        String(folder),
        String(name),
        template === "starter" ? "starter" : "blank"
      )
    )
  )
);

/** A folder named on the command line, after the app's own path in development. */
const folderArgument = (argv: readonly string[]) =>
  argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-"));

const makeWindow = () => {
  const created = new BrowserWindow({
    backgroundColor: "#1a1a1d",
    height: 950,
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
  created.on("enter-full-screen", () =>
    created.webContents.send(Channel.fullScreen, true)
  );
  created.on("leave-full-screen", () =>
    created.webContents.send(Channel.fullScreen, false)
  );
  return created;
};

const start = async () => {
  await app.whenReady();
  protocol.handle(APP_SCHEME, serveWeb);
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
