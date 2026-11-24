// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import {
  OUTSIDE_AGENTS,
  type OutsideAgent,
} from "@ultrapaint/contracts/outside-agents";
import type { InstalledCommand } from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { McpConnectionGroup } from "./settings-agents.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

/** The desktop app's command, as its shell answers for it. */
const withCommand = (
  installed: InstalledCommand | null,
  install: () => Promise<InstalledCommand>
) =>
  setPlatform({
    command: { install, installed: () => Promise.resolve(installed) },
    serverUrl: "ws://127.0.0.1:1/ws",
  } as Platform);

const render = async () => {
  act(() => mounted.render(<McpConnectionGroup />));
  await act(() => fakeApi.requested("mcp.connection"));
  await act(() => fakeApi.requested("mcp.outsideAgents"));
};

/** The server's answer for the outside agents: each as given, not connected otherwise. */
const outside = (
  agents: Partial<Record<OutsideAgent["id"], Omit<OutsideAgent, "id">>>,
  commandOnPath = true
) =>
  fakeApi.respond("mcp.outsideAgents", () => ({
    agents: OUTSIDE_AGENTS.map(({ id }) => ({
      id,
      status: "not-connected" as const,
      ...agents[id],
    })),
    commandOnPath,
  }));

/** The row of an agent, by its name. */
const rowOf = (name: string) =>
  [...container.querySelectorAll("[data-outside-agent]")].find(
    (r) => r.getAttribute("data-outside-agent") === name
  );

const buttonIn = (row: Element | undefined, name: string) =>
  [...(row?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent === name
  );

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("mcp.connection", () => ({
    enabled: true,
    header: "x-ultrapaint-token",
    token: "mcp_x",
    url: "http://127.0.0.1:1/mcp",
  }));
  outside({});
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  setPlatform(null);
});

describe("Settings › Connections (ADR 0083)", () => {
  it("shows the one-time lines, the same for every project, with no port or token", async () => {
    await render();
    expect(container.textContent).toContain(
      "claude mcp add ultrapaint -s user -- ultrapaint mcp"
    );
    expect(container.textContent).toContain(
      "codex mcp add ultrapaint -- ultrapaint mcp"
    );
    expect(container.textContent).not.toContain("mcp_x");
  });

  it("installs the command where the desktop app has none, and says when its folder is not on the PATH", async () => {
    let resolve: (value: InstalledCommand) => void = () => undefined;
    withCommand(
      null,
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await render();
    await act(() => Promise.resolve());
    act(() => button("Install")?.click());
    await act(async () => {
      resolve({
        onPath: false,
        ours: true,
        path: "/home/u/.local/bin/ultrapaint",
        shipped: false,
      });
      await Promise.resolve();
    });
    expect(container.textContent).toContain("/home/u/.local/bin/ultrapaint");
    expect(container.textContent).toContain(
      "Its folder isn’t on your PATH yet: add it, then start the agent again."
    );
  });

  it("says nothing more where the command is there already", async () => {
    withCommand(
      {
        onPath: true,
        ours: false,
        path: "/home/u/.local/bin/ultrapaint",
        shipped: false,
      },
      () => Promise.reject(new Error("not asked"))
    );
    await render();
    await act(() => Promise.resolve());
    expect(button("Install")).toBeUndefined();
    expect(button("Install again")).toBeUndefined();
  });

  it("says where Homebrew linked the app's command, and offers no second one (ADR 0088)", async () => {
    withCommand(
      {
        onPath: true,
        ours: true,
        path: "/opt/homebrew/bin/ultrapaint",
        shipped: true,
      },
      () => Promise.reject(new Error("not asked"))
    );
    await render();
    await act(() => Promise.resolve());
    expect(container.textContent).toContain("/opt/homebrew/bin/ultrapaint");
    expect(container.textContent).toContain("Installed, linked to this app");
    expect(button("Install")).toBeUndefined();
    expect(button("Install again")).toBeUndefined();
  });

  it("says where the app's own command is, with the way to write it again", async () => {
    let installs = 0;
    const own = {
      onPath: true,
      ours: true,
      path: "/home/u/.local/bin/ultrapaint",
      shipped: false,
    };
    withCommand(own, () => {
      installs += 1;
      return Promise.resolve(own);
    });
    await render();
    await act(() => Promise.resolve());
    expect(container.textContent).toContain("/home/u/.local/bin/ultrapaint");
    await act(async () => {
      button("Install again")?.click();
      await Promise.resolve();
    });
    expect(installs).toBe(1);
  });
});

describe("Settings › Connections: Connect (ADR 0144)", () => {
  it("offers Connect beside each agent's line, Claude Code's and Codex's only, and no Disconnect", async () => {
    await render();
    const rows = [...container.querySelectorAll("[data-outside-agent]")];
    expect(rows.map((r) => r.getAttribute("data-outside-agent"))).toEqual([
      "Claude Code",
      "Codex",
    ]);
    for (const row of rows) {
      expect(buttonIn(row, "Connect")).toBeDefined();
      expect(row.querySelector('button[aria-label^="Copy"]')).not.toBeNull();
    }
    expect(button("Disconnect")).toBeUndefined();
  });

  it("connects an agent with one click, saying so while it runs, then Connected", async () => {
    let answer: (value: {
      agent: OutsideAgent;
      commandOnPath: boolean;
    }) => void = () => undefined;
    fakeApi.respond(
      "mcp.connectAgent",
      () =>
        new Promise((done) => {
          answer = done;
        })
    );
    await render();
    act(() => buttonIn(rowOf("Codex"), "Connect")?.click());
    const connecting = buttonIn(rowOf("Codex"), "Connecting…");
    expect(connecting?.disabled).toBe(true);
    act(() => connecting?.click());
    await act(async () => {
      answer({
        agent: { id: "codex", status: "connected" },
        commandOnPath: true,
      });
      await Promise.resolve();
    });
    expect(rowOf("Codex")?.textContent).toContain("Connected");
    expect(buttonIn(rowOf("Codex"), "Connect")).toBeUndefined();
    expect(buttonIn(rowOf("Claude Code"), "Connect")).toBeDefined();
    expect(
      fakeApi.calls.filter((c) => c.method === "mcp.connectAgent")
    ).toEqual([{ input: { agentId: "codex" }, method: "mcp.connectAgent" }]);
  });

  it("shows an agent that lists Ultrapaint as Connected as the section opens, with no button", async () => {
    outside({ "claude-code": { status: "connected" } });
    await render();
    expect(rowOf("Claude Code")?.textContent).toContain("Connected");
    expect(buttonIn(rowOf("Claude Code"), "Connect")).toBeUndefined();
    expect(buttonIn(rowOf("Codex"), "Connect")).toBeDefined();
    // The command is on the PATH: nothing more to say.
    expect(container.textContent).not.toContain("can’t start Ultrapaint");
  });

  it("asks the agents once each time the section opens", async () => {
    await render();
    await act(() => Promise.resolve());
    act(() => mounted.render(<div />));
    expect(
      fakeApi.calls.filter((c) => c.method === "mcp.outsideAgents")
    ).toHaveLength(1);
    act(() => mounted.render(<McpConnectionGroup />));
    await act(() => fakeApi.requested("mcp.connection", 2));
    await act(() => fakeApi.requested("mcp.outsideAgents", 2));
    await act(() => Promise.resolve());
    expect(
      fakeApi.calls.filter((c) => c.method === "mcp.outsideAgents")
    ).toHaveLength(2);
  });

  it("says why connecting failed, in the command's own words, and offers Connect again", async () => {
    fakeApi.respond("mcp.connectAgent", () =>
      Promise.reject(
        new RequestError(
          "command_failed",
          "MCP server ultrapaint already exists in local config"
        )
      )
    );
    await render();
    await act(async () => {
      buttonIn(rowOf("Claude Code"), "Connect")?.click();
      await Promise.resolve();
    });
    expect(rowOf("Claude Code")?.textContent).toContain(
      "Couldn’t connect Claude Code: MCP server ultrapaint already exists in local config"
    );
    expect(buttonIn(rowOf("Claude Code"), "Connect")).toBeDefined();
  });

  it("says an agent isn't installed, with where to install it from, and offers no Connect", async () => {
    outside({
      codex: {
        install: "https://developers.openai.com/codex/cli",
        status: "not-installed",
      },
    });
    await render();
    const row = rowOf("Codex");
    expect(row?.textContent).toContain("Codex isn’t installed");
    expect(row?.querySelector("a")?.getAttribute("href")).toBe(
      "https://developers.openai.com/codex/cli"
    );
    expect(buttonIn(row, "Connect")).toBeUndefined();
    // Its line stays, to run once it is.
    expect(row?.textContent).toContain(
      "codex mcp add ultrapaint -- ultrapaint mcp"
    );
  });

  it("says an agent connected can't start Ultrapaint until the command is on the PATH", async () => {
    outside({}, false);
    fakeApi.respond("mcp.connectAgent", () => ({
      agent: { id: "claude-code", status: "connected" },
      commandOnPath: false,
    }));
    await render();
    expect(container.textContent).not.toContain("can’t start Ultrapaint");
    await act(async () => {
      buttonIn(rowOf("Claude Code"), "Connect")?.click();
      await Promise.resolve();
    });
    expect(rowOf("Claude Code")?.textContent).toContain(
      "Claude Code can’t start Ultrapaint until the ultrapaint command is on your PATH."
    );
    expect(rowOf("Codex")?.textContent).not.toContain("can’t start");
  });

  it("tells a person whose agent reaches Ultrapaint through a hub to leave its row", async () => {
    await render();
    expect(container.textContent).toContain(
      "If an agent reaches Ultrapaint through a hub, leave its row as it is"
    );
  });

  it("shows nothing where the server runs with no MCP", async () => {
    fakeApi.respond("mcp.connection", () => ({
      enabled: false,
      header: "",
      token: "",
      url: "",
    }));
    act(() => mounted.render(<McpConnectionGroup />));
    await act(() => fakeApi.requested("mcp.connection"));
    await act(() => Promise.resolve());
    expect(container.textContent).toBe("");
    expect(fakeApi.calls.some((c) => c.method === "mcp.outsideAgents")).toBe(
      false
    );
  });
});
