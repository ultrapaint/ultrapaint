import { describe, expect, it } from "vitest";
import {
  commandOf,
  parseCommand,
  type TaskRequest,
  taskPurpose,
} from "./tasks.ts";

const requestOf = (text: string) => {
  const parsed = parseCommand(text);
  return parsed?._tag === "Request" ? parsed.request : parsed;
};

describe("parseCommand", () => {
  it("reads each command as its request, what the user adds kept", () => {
    expect(requestOf("/init")).toEqual({ _tag: "Init" });
    expect(requestOf("/init  keep the brand blue ")).toEqual({
      _tag: "Init",
      extra: "keep the brand blue",
    });
    expect(requestOf("/implement /home make it fast")).toEqual({
      _tag: "Implement",
      extra: "make it fast",
      target: "/home",
    });
    expect(requestOf("/implement")).toEqual({ _tag: "Implement", target: "" });
    expect(requestOf("/implement spec:Button")).toEqual({
      _tag: "Implement",
      target: "spec:Button",
    });
    expect(requestOf("/import-figma f1 the icons too")).toEqual({
      _tag: "ImportFigma",
      extra: "the icons too",
      file: "f1",
    });
    expect(requestOf('/redraw "" to wireframes, greyscale')).toEqual({
      _tag: "Redraw",
      canvas: "",
      change: "to wireframes, greyscale",
    });
    expect(requestOf("/components drafts")).toEqual({
      _tag: "Components",
      canvas: "drafts",
    });
    expect(requestOf("/sync code now")).toEqual({
      _tag: "Sync",
      extra: "now",
      source: "code",
    });
  });

  it("reads a page of a canvas as node references write it", () => {
    expect(requestOf("/implement marketing:/pricing")).toEqual({
      _tag: "Implement",
      canvas: "marketing",
      target: "/pricing",
    });
    expect(requestOf("/implement v2/app:orders.page.json")).toEqual({
      _tag: "Implement",
      canvas: "v2/app",
      target: "orders.page.json",
    });
  });

  it('reads --adopt as linking pages, the designs directory\'s canvas as ""', () => {
    expect(requestOf('/implement --adopt "" orders.page.json')).toEqual({
      _tag: "Adopt",
      targets: ["", "orders.page.json"],
    });
    expect(requestOf("/implement --adopt")).toEqual({
      _tag: "Adopt",
      targets: [],
    });
  });

  it("takes Define's mode, and only Define's", () => {
    expect(requestOf("/design-system define propose a calm one")).toEqual({
      _tag: "SetupStep",
      extra: "a calm one",
      mode: "propose",
      step: "define",
    });
    expect(requestOf("/design-system map propose")).toEqual({
      _tag: "SetupStep",
      extra: "propose",
      step: "map",
    });
  });

  it("says why a step that is not one cannot be run", () => {
    expect(parseCommand("/design-system tidy")).toEqual({
      _tag: "Invalid",
      command: "design-system",
      message: "tidy is not a step of the setup",
    });
    expect(parseCommand("/design-system")).toMatchObject({ _tag: "Invalid" });
  });

  it("reads /sync with no source it knows as where the sync stands", () => {
    expect(requestOf("/sync")).toEqual({ _tag: "Sync" });
    expect(requestOf("/sync everything please")).toEqual({ _tag: "Sync" });
  });

  it("leaves a prompt that is no command of the editor's as it is", () => {
    expect(parseCommand("make the header blue")).toBeNull();
    expect(parseCommand("/review the diff")).toBeNull();
    expect(parseCommand("see /implement")).toBeNull();
  });
});

describe("commandOf", () => {
  const requests: readonly TaskRequest[] = [
    { _tag: "Init" },
    { _tag: "Init", extra: "keep the brand blue" },
    { _tag: "Implement", target: "/settings/billing" },
    { _tag: "Implement", canvas: "marketing", target: "/pricing" },
    { _tag: "Implement", extra: "with tests", target: "spec:Button" },
    { _tag: "Adopt", targets: [] },
    { _tag: "Adopt", targets: ["", "marketing", "orders.page.json"] },
    { _tag: "ImportFigma" },
    { _tag: "ImportFigma", file: "f1" },
    { _tag: "Redraw", canvas: "", change: "to wireframes" },
    { _tag: "Redraw", canvas: "copy" },
    { _tag: "Components", canvas: "" },
    { _tag: "SetupStep", step: "define" },
    { _tag: "SetupStep", mode: "adopt", step: "define" },
    { _tag: "SetupStep", extra: "the forms first", step: "migrate" },
    { _tag: "Sync" },
    { _tag: "Sync", source: "design" },
    { _tag: "Sync", extra: "only colours", source: "figma" },
  ];

  it("writes a request as the command read back as it", () => {
    for (const request of requests) {
      expect(parseCommand(commandOf(request))).toEqual({
        _tag: "Request",
        request,
      });
    }
  });

  it("writes the commands the composer shows", () => {
    expect(commandOf({ _tag: "SetupStep", step: "define" })).toBe(
      "/design-system define"
    );
    expect(commandOf({ _tag: "Adopt", targets: [""] })).toBe(
      '/implement --adopt ""'
    );
    expect(commandOf({ _tag: "Implement", canvas: "", target: "/home" })).toBe(
      "/implement /home"
    );
  });
});

describe("taskPurpose", () => {
  it("implements only what writes the application's code (ADR 0030)", () => {
    expect(taskPurpose({ _tag: "Implement", target: "/home" })).toBe(
      "implement"
    );
    expect(taskPurpose({ _tag: "Adopt", targets: [] })).toBe("design");
    expect(taskPurpose({ _tag: "Sync", source: "code" })).toBe("design");
  });
});
