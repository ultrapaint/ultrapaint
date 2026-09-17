import os from "node:os";
import path from "node:path";
import type { LogLine, ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import { EventBus } from "./events.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { EditService } from "./services/edit.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { RepoPaths } from "./services/repo.ts";
import { ScreensService } from "./services/screens.ts";
import { SettingsService } from "./services/settings.ts";
import { ThreadService } from "./services/threads.ts";

/** Everything that exists once a target repository is configured. */
export interface ProjectServices {
  catalogue: CatalogueService;
  edit: EditService;
  git: GitService;
  host: HostManager;
  paths: RepoPaths;
  screens: ScreensService;
  settings: Settings;
}

export class ProjectRuntime {
  private services: ProjectServices | null = null;
  private readonly settingsService: SettingsService;
  private readonly events: EventBus;
  private readonly log: AppContext["log"];
  private readonly threads: ThreadService;

  constructor(
    settingsService: SettingsService,
    events: EventBus,
    log: AppContext["log"],
    threads: ThreadService
  ) {
    this.settingsService = settingsService;
    this.events = events;
    this.log = log;
    this.threads = threads;
  }

  get current(): ProjectServices | null {
    return this.services;
  }

  async boot() {
    const settings = this.settingsService.get();
    if (!settings) {
      return;
    }
    await this.open(settings);
  }

  async info(): Promise<ProjectInfo> {
    const s = this.services;
    if (!s) {
      return { configured: false, host: { state: "stopped" } };
    }
    return {
      branch: await s.git.branch().catch(() => ""),
      configured: true,
      designsDir: s.settings.designsDir,
      host: s.host.current,
      name: path.basename(s.paths.root),
      repoPath: s.paths.root,
    };
  }

  private async emitInfo() {
    this.events.emit("project", await this.info());
  }

  async open(settings: Settings) {
    await this.close();
    const paths = new RepoPaths(settings);
    const git = new GitService(paths);
    const host = new HostManager(
      paths,
      (level, text) => this.log("host", level, text),
      () => {
        this.emitInfo();
      }
    );
    const screens = new ScreensService(paths, {
      onCanvas: (flow, layout) => this.events.emit("canvas", { flow, layout }),
      onFileChanged: (file, hash) =>
        this.events.emit("file.changed", { file, hash }),
      onScreens: (list) => this.events.emit("screens", { screens: list }),
    });
    const edit = new EditService(
      paths,
      settings.formatCommand,
      (state) => this.events.emit("edit.state", state),
      (file, hash) => this.events.emit("file.changed", { file, hash })
    );
    const catalogue = new CatalogueService(
      paths,
      settings,
      this.settingsService.home,
      (level, text) => this.log("server", level, text)
    );
    this.services = { catalogue, edit, git, host, paths, screens, settings };
    screens.watch();
    this.threads.attach({ git, paths });
    await this.emitInfo();
    host.start(settings).then(() => this.emitInfo());
  }

  async close() {
    const s = this.services;
    if (!s) {
      return;
    }
    this.services = null;
    await s.host.stop();
    await s.screens.close();
    this.threads.detach();
  }
}

export interface AppContext {
  events: EventBus;
  home: string;
  log: (
    source: LogLine["source"],
    level: LogLine["level"],
    text: string
  ) => void;
  logs: LogLine[];
  project: ProjectRuntime;
  settings: SettingsService;
  shutdown: () => Promise<void>;
  threads: ThreadService;
  version: string;
}

export const createContext = (options: {
  home?: string;
}): Promise<AppContext> => {
  const home =
    options.home ??
    process.env.ULTRAPAINT_HOME ??
    path.join(os.homedir(), ".ultrapaint");
  const events = new EventBus();
  const logs: LogLine[] = [];
  const log: AppContext["log"] = (source, level, text) => {
    const line: LogLine = { at: Date.now(), level, source, text };
    logs.push(line);
    if (logs.length > 500) {
      logs.shift();
    }
    events.emit("log", line);
    if (level !== "info" || source === "server") {
      console.log(`[${source}] ${text}`);
    }
  };
  const settings = new SettingsService(home);
  const threads = new ThreadService(home, events, (level, text) =>
    log("agent", level, text)
  );
  const project = new ProjectRuntime(settings, events, log, threads);
  return Promise.resolve({
    events,
    home,
    log,
    logs,
    project,
    settings,
    shutdown: async () => {
      await threads.shutdown();
      await project.close();
    },
    threads,
    version: "0.1.0",
  });
};
