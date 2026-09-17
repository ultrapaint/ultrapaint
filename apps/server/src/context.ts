import os from "node:os";
import path from "node:path";
import type { LogLine, ProjectInfo, Settings } from "@ultrapaint/contracts";
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
  settings: Settings;
  paths: RepoPaths;
  host: HostManager;
  screens: ScreensService;
  edit: EditService;
  git: GitService;
  catalogue: CatalogueService;
}

export class ProjectRuntime {
  private services: ProjectServices | null = null;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly events: EventBus,
    private readonly log: AppContext["log"],
    private readonly threads: ThreadService,
  ) {}

  get current(): ProjectServices | null {
    return this.services;
  }

  async boot() {
    const settings = this.settingsService.get();
    if (!settings) return;
    await this.open(settings);
  }

  async info(): Promise<ProjectInfo> {
    const s = this.services;
    if (!s) return { configured: false, host: { state: "stopped" } };
    return {
      configured: true,
      name: path.basename(s.paths.root),
      repoPath: s.paths.root,
      branch: await s.git.branch().catch(() => ""),
      designsDir: s.settings.designsDir,
      host: s.host.current,
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
      () => void this.emitInfo(),
    );
    const screens = new ScreensService(paths, {
      onScreens: (list) => this.events.emit("screens", { screens: list }),
      onFileChanged: (file, hash) => this.events.emit("file.changed", { file, hash }),
      onCanvas: (flow, layout) => this.events.emit("canvas", { flow, layout }),
    });
    const edit = new EditService(
      paths,
      settings.formatCommand,
      (state) => this.events.emit("edit.state", state),
      (file, hash) => this.events.emit("file.changed", { file, hash }),
    );
    const catalogue = new CatalogueService(
      paths,
      settings,
      this.settingsService.home,
      (level, text) => this.log("server", level, text),
    );
    this.services = { settings, paths, host, screens, edit, git, catalogue };
    screens.watch();
    this.threads.attach({ paths, git });
    await this.emitInfo();
    void host.start(settings).then(() => this.emitInfo());
  }

  async close() {
    const s = this.services;
    if (!s) return;
    this.services = null;
    await s.host.stop();
    await s.screens.close();
    this.threads.detach();
  }
}

export interface AppContext {
  version: string;
  home: string;
  events: EventBus;
  settings: SettingsService;
  project: ProjectRuntime;
  threads: ThreadService;
  logs: LogLine[];
  log: (source: LogLine["source"], level: LogLine["level"], text: string) => void;
  shutdown: () => Promise<void>;
}

export const createContext = async (options: { home?: string }): Promise<AppContext> => {
  const home =
    options.home ?? process.env.ULTRAPAINT_HOME ?? path.join(os.homedir(), ".ultrapaint");
  const events = new EventBus();
  const logs: LogLine[] = [];
  const log: AppContext["log"] = (source, level, text) => {
    const line: LogLine = { source, level, text, at: Date.now() };
    logs.push(line);
    if (logs.length > 500) logs.shift();
    events.emit("log", line);
    if (level !== "info" || source === "server") console.log(`[${source}] ${text}`);
  };
  const settings = new SettingsService(home);
  const threads = new ThreadService(home, events, (level, text) => log("agent", level, text));
  const project = new ProjectRuntime(settings, events, log, threads);
  return {
    version: "0.1.0",
    home,
    events,
    settings,
    project,
    threads,
    logs,
    log,
    shutdown: async () => {
      await threads.shutdown();
      await project.close();
    },
  };
};
