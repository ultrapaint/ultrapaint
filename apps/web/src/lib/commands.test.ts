import "../testing/fake-browser.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveBoard, openBoard } from "../state/board.ts";
import { useEditor } from "../state/editor.ts";
import {
  type Command,
  commandList,
  commands,
  searchCommands,
} from "./commands.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const command = (title: string, more: Partial<Command> = {}): Command => ({
  group: "View",
  id: title,
  run: () => undefined,
  title,
  ...more,
});

const list = [
  command("Show the grid", { keywords: "snap" }),
  command("Zoom to fit"),
  command("Zoom in"),
  command("New chat with an agent", { group: "Agents" }),
  command("Pricing", { detail: "/pricing", group: "Go to" }),
  command("Grid lines"),
];

const titles = (found: readonly Command[]) => found.map((c) => c.title);

describe("searchCommands", () => {
  it("finds them all, in order, for nothing typed", () => {
    expect(titles(searchCommands(list, "  "))).toEqual(titles(list));
  });

  it("finds every word anywhere in a command's words", () => {
    expect(titles(searchCommands(list, "snap"))).toEqual(["Show the grid"]);
    expect(titles(searchCommands(list, "agent chat"))).toEqual([
      "New chat with an agent",
    ]);
    expect(titles(searchCommands(list, "/pricing"))).toEqual(["Pricing"]);
  });

  it("puts the titles that start with what was typed first", () => {
    expect(titles(searchCommands(list, "grid"))).toEqual([
      "Grid lines",
      "Show the grid",
    ]);
    expect(titles(searchCommands(list, "zoom"))).toEqual([
      "Zoom to fit",
      "Zoom in",
    ]);
  });

  it("finds a command by its group", () => {
    expect(titles(searchCommands(list, "go to"))).toEqual(["Pricing"]);
  });
});

describe("the rail's places", () => {
  const ids = () => commandList().map((c) => c.id);

  it("are the palette's panels: Design system and the Library, no Assets", () => {
    expect(ids()).toEqual(
      expect.arrayContaining([
        "panel:chat",
        "panel:layers",
        "panel:designSystem",
        "panel:library",
        "panel:changes",
      ])
    );
    expect(ids()).not.toContain("panel:assets");
  });

  it("offer the Insert menu's elements as commands", () => {
    expect(ids()).toEqual(
      expect.arrayContaining([
        "insert:row",
        "insert:column",
        "insert:paragraph",
        "insert:image",
      ])
    );
  });

  afterEach(() => {
    leaveBoard("none");
  });

  it("leave a board view its own tools", () => {
    const tool = (id: string) => commandList().find((c) => c.id === id);
    openBoard({ item: "color", view: "system" }, "none");
    tool("tool:group")?.run?.();
    expect(useEditor.getState().mode).toBe("select");
    tool("tool:pan")?.run?.();
    expect(useEditor.getState().mode).toBe("pan");
  });
});

describe("on a board view (ADR 0045)", () => {
  const offered = () => commands().map((c) => c.id);

  afterEach(() => {
    leaveBoard("none");
  });

  it("offers nothing that is about pages: their code, comments and grid, Layers with no tree", () => {
    useEditor.setState({ workspace: "design" });
    expect(offered()).toEqual(
      expect.arrayContaining(["right:code", "grid", "panel:layers"])
    );
    openBoard({ item: "color", view: "system" }, "none");
    for (const id of [
      "right:code",
      "right:comments",
      "toggleComments",
      "grid",
      "panel:layers",
      "tool:text",
      "zoomSelection",
    ]) {
      expect(offered(), id).not.toContain(id);
    }
    expect(offered()).toEqual(
      expect.arrayContaining(["zoomFit", "panel:library", "tool:pan"])
    );
  });
});
