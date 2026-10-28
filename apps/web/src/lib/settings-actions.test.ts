import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type {
  PersistInput,
  Settings,
  SettingsValidation,
} from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { detect, save, saveToFile, setUpDesigns } from "./settings-actions.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const REPO = "/work/shop";

const running: Settings = {
  componentPackages: [],
  designsDir: "designs",
  hostCss: [],
  libraryDirs: [],
  repoPath: REPO,
  theme: "light",
};

const openInfo = (storage: ProjectInfo["storage"]): ProjectInfo => ({
  configured: true,
  designsDir: "designs",
  host: { state: "running" },
  name: "shop",
  repoPath: REPO,
  setup: "saved",
  storage,
});

/** Components in `src/ui`, a stylesheet of the app, the pages in `docs/designs`. */
const found: SetupSuggestions = {
  anchors: [],
  cssEntries: ["src/app.css"],
  designsDirs: ["docs/designs"],
  framework: "react-vite",
  libraries: [{ dir: "src", inApp: true, name: "shop", sourceDir: "src/ui" }],
  repoName: "shop",
  tailwind: "v4",
};

/** What the server holds: the settings it saved and the project's info. */
let server: { info: ProjectInfo; settings: Settings | null };

const ok: SettingsValidation = { ok: true, problems: [] };

/**
 * The server's side of a save: the settings are saved and in force, and the editor is told of
 * the project's info, which names the same repository as before.
 */
const saving = (next: Settings) => {
  server = { ...server, settings: next };
  fakeApi.emit("project", server.info);
  return ok;
};

beforeEach(async () => {
  fakeApi.reset();
  server = { info: openInfo({ mode: "managed" }), settings: running };
  useProject.setState({ info: server.info, settings: running });
  fakeApi.respond("project.info", () => server.info);
  fakeApi.respond("settings.get", () => server.settings);
  fakeApi.respond("pages.list", () => ({ canvases: [], pages: [] }));
  fakeApi.respond("logs.recent", () => []);
  fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: false }));
  fakeApi.respond("setup.detect", () => found);
  fakeApi.respond("setup.createDesigns", () => ({ created: [] }));
  fakeApi.respond("settings.set", (next: Settings) => saving(next));
  const stop = followServer({ report: () => undefined });
  // What the editor reads as the connection opens is not what a test asks about.
  await new Promise((settled) => setTimeout(settled));
  fakeApi.calls.length = 0;
  return stop;
});

describe("detecting", () => {
  it("keeps what was typed in the draft while the repository was read", async () => {
    let answer: (found: SetupSuggestions) => void = () => undefined;
    fakeApi.respond(
      "setup.detect",
      () =>
        new Promise<SetupSuggestions>((resolve) => {
          answer = resolve;
        })
    );
    let draft: Settings = running;
    const detecting = detect(REPO);
    // The settings page's form, typed in while the server reads the repository.
    draft = { ...draft, storybookUrl: "http://localhost:6006", theme: "dark" };
    answer(found);
    draft = (await detecting).onto(draft);
    expect(draft.storybookUrl).toBe("http://localhost:6006");
    expect(draft.theme).toBe("dark");
    expect(draft.designsDir).toBe("docs/designs");
    expect(draft.libraryDirs).toEqual(["src/ui"]);
    expect(fakeApi.calls[0]?.input).toEqual({ repoPath: REPO });
  });
});

describe("saving the settings", () => {
  it("leaves the store holding what the server saved, when Sync applies detection", async () => {
    const detection = await detect(REPO, { keepDesignsDir: true });
    const next = detection.onto(running);
    expect(next.designsDir).toBe("designs");
    expect(next.libraryDirs).toEqual(["src/ui"]);
    expect(await save(next)).toEqual([]);
    expect(useProject.getState().settings).toEqual(server.settings);
    expect(useProject.getState().settings?.libraryDirs).toEqual(["src/ui"]);
  });

  it("leaves the store holding what the server saved, when a switch changes one field", async () => {
    expect(await save({ ...running, codeTokens: "auto" })).toEqual([]);
    expect(useProject.getState().settings).toEqual(server.settings);
    expect(useProject.getState().settings?.codeTokens).toBe("auto");
  });

  it("gives what is wrong, and changes nothing, when the server refuses", async () => {
    fakeApi.respond("settings.set", () => ({
      ok: false,
      problems: ["Designs directory does not exist: nowhere"],
    }));
    expect(await save({ ...running, designsDir: "nowhere" })).toEqual([
      "Designs directory does not exist: nowhere",
    ]);
    expect(useProject.getState().settings).toEqual(running);
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["settings.set"]);
  });

  it("creates the designs directory, then saves where detection put the pages", async () => {
    server = {
      info: {
        configured: false,
        host: { state: "stopped" },
        storage: { mode: "ephemeral" },
      },
      settings: null,
    };
    useProject.setState({ info: server.info, settings: null });
    fakeApi.respond("settings.set", (next: Settings) => {
      server = { info: openInfo({ mode: "ephemeral" }), settings: next };
      fakeApi.emit("project", server.info);
      return ok;
    });
    const detection = await detect(REPO);
    expect(await setUpDesigns(detection.onto(running))).toEqual([]);
    expect(fakeApi.calls.map((c) => c.method).slice(0, 3)).toEqual([
      "setup.detect",
      "setup.createDesigns",
      "settings.set",
    ]);
    expect(fakeApi.calls[1]?.input).toEqual({
      designsDir: "docs/designs",
      repoPath: REPO,
      resolveFrom: undefined,
    });
    expect(useProject.getState().settings).toEqual(server.settings);
    expect(useProject.getState().info.configured).toBe(true);
  });

  it("reads the project again once a session is saved to a file", async () => {
    const configPath = `${REPO}/ultrapaint.config.json`;
    fakeApi.respond("settings.persist", (input: PersistInput) => {
      server = {
        info: openInfo({ configPath, mode: "file" }),
        settings: input.settings,
      };
      return { configPath, validation: ok };
    });
    const result = await saveToFile({ configPath, settings: running });
    expect(result.validation.ok).toBe(true);
    expect(useProject.getState().info.storage).toEqual({
      configPath,
      mode: "file",
    });
    expect(useProject.getState().settings).toEqual(server.settings);
  });
});
