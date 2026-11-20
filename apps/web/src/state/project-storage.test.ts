// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { afterEach, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { useProject } from "./project.ts";
import { readProjectItem, writeProjectItem } from "./project-storage.ts";

const initial = useProject.getState();
const inProject = (repoPath: string) =>
  useProject.setState({ info: { ...initial.info, repoPath } });

afterEach(() => {
  setPlatform(null);
  useProject.setState(initial, true);
  localStorage.clear();
});

describe("the project's own storage (ADR 0107)", () => {
  it("keeps what two projects' pages write apart, though they share the origin", () => {
    inProject("/work/shop");
    writeProjectItem("ultrapaint:panel-width:left", "320");
    inProject("/work/docs");
    writeProjectItem("ultrapaint:panel-width:left", "280");
    expect(readProjectItem("ultrapaint:panel-width:left")).toBe("280");
    inProject("/work/shop");
    expect(readProjectItem("ultrapaint:panel-width:left")).toBe("320");
  });

  it("keeps one path on two machines apart in the desktop app, by its project's id there", () => {
    const inDesktop = (id: string) =>
      setPlatform({
        projectId: { current: () => id, subscribe: () => () => undefined },
        serverUrl: "",
      } as unknown as Platform);
    inProject("~/site");
    inDesktop("devbox-site");
    writeProjectItem("ultrapaint:panel-width:left", "320");
    inDesktop("nas-site");
    expect(readProjectItem("ultrapaint:panel-width:left")).toBeNull();
    writeProjectItem("ultrapaint:panel-width:left", "280");
    inDesktop("devbox-site");
    expect(readProjectItem("ultrapaint:panel-width:left")).toBe("320");
  });

  it("reads what every project shared before, until the project keeps its own", () => {
    localStorage.setItem("ultrapaint:threads-seen", '{"t1":5}');
    inProject("/work/shop");
    expect(readProjectItem("ultrapaint:threads-seen")).toBe('{"t1":5}');
    writeProjectItem("ultrapaint:threads-seen", '{"t1":9}');
    expect(readProjectItem("ultrapaint:threads-seen")).toBe('{"t1":9}');
    expect(localStorage.getItem("ultrapaint:threads-seen")).toBe('{"t1":5}');
  });
});
