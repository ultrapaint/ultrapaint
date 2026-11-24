// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { useProject } from "../state/project.ts";
import { TitleRow } from "./title-bar.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const initialProject = useProject.getState();

const INFO: ProjectInfo = {
  configured: true,
  icon: { color: "teal", kind: "icon", name: "boxes" },
  name: "Shop admin",
  repoPath: "/work/shop-admin",
  storage: {
    configPath: "/work/shop-admin/ultrapaint.config.json",
    mode: "file",
  },
};

/** The desktop app's shell, as the project's page sees it: with its folders where they are local. */
const desktop = ({ local }: { local: boolean }) => {
  const opened: string[] = [];
  setPlatform({
    ...(local
      ? {
          folders: {
            open: (folder: string) => {
              opened.push(folder);
              return Promise.resolve();
            },
          },
        }
      : {}),
    projects: {
      current: () => Promise.resolve("shop"),
      list: () => Promise.resolve([]),
    },
    serverUrl: "ws://127.0.0.1:1/ws",
  } as unknown as Platform);
  return opened;
};

const press = (element: Element | null | undefined) =>
  act(() => (element as HTMLElement | null | undefined)?.click());

const draw = () => act(() => root.render(<TitleRow />));

/** The project's button in the title row. */
const projectButton = () =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Shop admin")
  );

/** The project menu's items, opened from the project's button. */
const menuItems = () => {
  press(projectButton());
  return [...document.body.querySelectorAll("[role=menuitem]")].map(
    (i) => i.textContent
  );
};

beforeEach(() => {
  useProject.setState({ info: INFO, loaded: true });
});

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
  useProject.setState(initialProject, true);
  vi.unstubAllGlobals();
});

describe("the title row (ADR 0107)", () => {
  it.each([
    ["a browser", () => setPlatform(null)],
    ["the desktop app", () => desktop({ local: true })],
  ])(
    "is the mark, a vertical rule and the project's button in %s alike",
    (_where, given) => {
      given();
      draw();
      const header = host.querySelector("header");
      const mark = header?.querySelector("svg[aria-label=Ultrapaint]");
      const rule = header?.querySelector("[role=separator]");
      const button = projectButton();
      expect(rule?.getAttribute("aria-orientation")).toBe("vertical");
      // In this order along the row, with no slash written between them (ADR 0126).
      const order = [...(header?.querySelectorAll("*") ?? [])];
      const at = (node?: Element | null) => (node ? order.indexOf(node) : -1);
      expect(at(mark)).toBeGreaterThanOrEqual(0);
      expect(at(rule)).toBeGreaterThan(at(mark));
      expect(at(button)).toBeGreaterThan(at(rule));
      expect(header?.textContent).not.toContain("/");
      expect(button?.textContent).toBe("Shop admin");
    }
  );

  it("draws the project's image as its icon, from its server", () => {
    useProject.setState({
      info: { ...INFO, icon: { kind: "file", path: "public/favicon.svg" } },
    });
    draw();
    const src = new URL(projectButton()?.querySelector("img")?.src ?? "");
    expect(`${src.pathname}${src.search}`).toBe(
      "/api/project-image?path=public%2Ffavicon.svg"
    );
  });

  it("draws the name's initial when the project has no image", () => {
    useProject.setState({
      info: { ...INFO, icon: { color: "pink", initial: "S", kind: "initial" } },
    });
    draw();
    expect(projectButton()?.textContent).toBe("SShop admin");
  });

  it("opens nothing from the mark", () => {
    draw();
    act(() => {
      host
        .querySelector("svg[aria-label=Ultrapaint]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector("[role=menu]")).toBeNull();
    expect(
      host.querySelector("svg[aria-label=Ultrapaint]")?.closest("button")
    ).toBeNull();
  });
});

describe("the project menu (ADR 0107)", () => {
  it("in the desktop app, with the folder on this machine, shows it in the file manager", () => {
    const opened = desktop({ local: true });
    draw();
    const items = menuItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toBe("Project settings");
    expect(items[1]?.startsWith("Show in ")).toBe(true);
    expect(items[2]).toBe("Copy path");
    press(
      [...document.body.querySelectorAll("[role=menuitem]")].find((i) =>
        i.textContent?.startsWith("Show in")
      )
    );
    expect(opened).toEqual(["/work/shop-admin"]);
  });

  it("over SSH has no Show in, the folder being on another machine", () => {
    desktop({ local: false });
    draw();
    expect(menuItems()).toEqual(["Project settings", "Copy path"]);
  });

  it("in a browser offers nothing that opens or closes a project", () => {
    setPlatform(null);
    draw();
    expect(menuItems()).toEqual(["Project settings", "Copy path"]);
  });

  it("heads its items with the project's name and path", () => {
    draw();
    press(projectButton());
    const menu = document.body.querySelector("[role=menu]");
    expect(menu?.textContent).toContain("Shop admin/work/shop-admin");
  });

  it("opens Settings › Name and icon from Project settings", () => {
    draw();
    menuItems();
    press(
      [...document.body.querySelectorAll("[role=menuitem]")].find(
        (i) => i.textContent === "Project settings"
      )
    );
    const { settingsOpen, settingsSection } = useProject.getState();
    expect({ settingsOpen, settingsSection }).toEqual({
      settingsOpen: true,
      settingsSection: "nameAndIcon",
    });
  });

  it("copies the project's path", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
    draw();
    menuItems();
    press(
      [...document.body.querySelectorAll("[role=menuitem]")].find(
        (i) => i.textContent === "Copy path"
      )
    );
    await act(() => Promise.resolve());
    expect(written).toEqual(["/work/shop-admin"]);
  });
});
