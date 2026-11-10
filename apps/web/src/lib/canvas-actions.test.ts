// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { Canvas } from "@ultrapaint/contracts/pages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { reorderCanvases } from "./canvas-actions.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const canvas = (id: string): Canvas => ({
  home: "/",
  id,
  name: id,
  variants: [],
});

const order = () => useProject.getState().canvases.map((c) => c.id);

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [canvas("a"), canvas("b"), canvas("c")],
    error: null,
    info: { configured: true, storage: { mode: "managed" } },
  });
});

describe("reorderCanvases", () => {
  it("shows the list in the order asked for at once, and saves it", async () => {
    fakeApi.respond("canvases.reorder", () => undefined);
    reorderCanvases(["c", "a", "b"]);
    expect(order()).toEqual(["c", "a", "b"]);
    await fakeApi.requested("canvases.reorder");
    expect(fakeApi.calls).toEqual([
      { input: { order: ["c", "a", "b"] }, method: "canvases.reorder" },
    ]);
  });

  it("puts the list back in the order the server has when it is refused", async () => {
    fakeApi.respond("canvases.reorder", () =>
      Promise.reject(new RequestError("internal", "the disk is full"))
    );
    reorderCanvases(["c", "a", "b"]);
    expect(order()).toEqual(["c", "a", "b"]);
    await until(useProject, (s) => s.error !== null);
    expect(useProject.getState().error).toBe("the disk is full");
    expect(order()).toEqual(["a", "b", "c"]);
    // Nothing is read again for it: the connection may be what failed.
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["canvases.reorder"]);
  });

  it("leaves a list the server told again meanwhile as it is", async () => {
    let refuse: (error: Error) => void = () => undefined;
    fakeApi.respond(
      "canvases.reorder",
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        })
    );
    reorderCanvases(["c", "a", "b"]);
    const told = [canvas("b"), canvas("a"), canvas("c"), canvas("d")];
    useProject.setState({ canvases: told });
    refuse(new RequestError("internal", "the disk is full"));
    await until(useProject, (s) => s.error !== null);
    expect(useProject.getState().canvases).toBe(told);
  });
});
