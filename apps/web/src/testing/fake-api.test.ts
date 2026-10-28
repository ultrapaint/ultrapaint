import { describe, expect, it } from "vitest";
import { connectionModule, fakeApi } from "./fake-api.ts";

const undo = { canRedo: false, canUndo: true };

describe("the fake server", () => {
  it("answers as the contracts say, and refuses what nobody set up", async () => {
    fakeApi.reset();
    fakeApi.respond("edit.state", () => undo);
    expect(await fakeApi.request("edit.state", undefined)).toEqual(undo);
    await expect(fakeApi.request("logs.recent", undefined)).rejects.toThrow(
      "logs.recent: no answer was set up"
    );
    expect(fakeApi.calls.map((c) => c.method)).toEqual([
      "edit.state",
      "logs.recent",
    ]);
  });

  it("is typed by the contracts", () => {
    // Compiled, never run: each line is a type error the compiler is asked to find.
    const wrong = () => {
      // @ts-expect-error the server has no such request
      fakeApi.respond("edit.nothing", () => undo);
      // @ts-expect-error an undo state is not a list of log lines
      fakeApi.respond("logs.recent", () => undo);
      // @ts-expect-error the server sends no such event
      fakeApi.emit("nothing", undo);
      // @ts-expect-error a page list is not an undo state
      fakeApi.emit("edit.state", { canvases: [], pages: [] });
    };
    expect(wrong).toBeTypeOf("function");
  });

  it("resets everything: the calls, the answers, the listeners and the connection", async () => {
    fakeApi.reset();
    fakeApi.respond("edit.state", () => undo);
    const heard: unknown[] = [];
    fakeApi.on("edit.state", (state) => heard.push(state));
    const states: string[] = [];
    connectionModule.useConnection.subscribe((now) => states.push(now.state));
    await fakeApi.request("edit.state", undefined);
    fakeApi.disconnect();

    fakeApi.reset();
    expect(fakeApi.calls).toEqual([]);
    expect(connectionModule.useConnection.getState().state).toBe("open");
    await expect(fakeApi.request("edit.state", undefined)).rejects.toThrow();
    fakeApi.emit("edit.state", undo);
    fakeApi.disconnect();
    expect(heard).toEqual([]);
    expect(states).toEqual(["closed"]);
  });

  it("loses what is sent while the connection is down, and refuses requests", async () => {
    fakeApi.reset();
    const heard: unknown[] = [];
    fakeApi.on("edit.state", (state) => heard.push(state));
    fakeApi.respond("edit.state", () => undo);
    fakeApi.disconnect();
    fakeApi.emit("edit.state", undo);
    await expect(fakeApi.request("edit.state", undefined)).rejects.toThrow(
      "not connected"
    );
    fakeApi.connect();
    fakeApi.emit("edit.state", undo);
    expect(heard).toEqual([undo]);
  });
});
