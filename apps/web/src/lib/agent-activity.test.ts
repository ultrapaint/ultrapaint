import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { AGENT_COLOR, agentActivity } from "./agent-activity.ts";

const thread = (id: string, status: Thread["status"]): Thread => ({
  agentId: "claude-code",
  createdAt: 0,
  id,
  status,
  title: "Claude",
  updatedAt: 0,
});

const toolCall = (
  status: "in_progress" | "completed",
  locations: { line?: number; path: string }[],
  toolKind?: string,
  title = "Edit file"
): ThreadItem => ({
  at: 0,
  content: [],
  id: `tool_${status}_${locations[0]?.path ?? title}`,
  kind: "tool",
  locations,
  status,
  title,
  toolCallId: "call_1",
  ...(toolKind ? { toolKind } : {}),
});

const turnEnd: ThreadItem = {
  at: 0,
  changedFiles: [],
  id: "end",
  kind: "turn_end",
  stopReason: "end_turn",
};

const page: Page = {
  canvas: "docs/designs",
  file: "docs/designs/index.tsx",
  id: "index",
  name: "Home",
  path: "index.tsx",
  route: "/",
};

describe("agentActivity", () => {
  it("reports the page an agent is editing, by the file it named", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      {
        t1: [toolCall("in_progress", [{ line: 12, path: page.file }], "edit")],
      },
      [page]
    );
    expect(activity?.action).toBe("editing");
    expect(activity?.pageIds).toEqual(["index"]);
    expect(activity?.places).toEqual([{ line: 12, path: page.file }]);
  });

  it("says thinking when no tool call is open", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("completed", [{ path: page.file }], "edit")] },
      [page]
    );
    expect(activity?.action).toBe("thinking");
    expect(activity?.pageIds).toEqual([]);
  });

  it("leaves out a thread whose turn is over, even mid-tool-call", () => {
    expect(
      agentActivity([thread("t1", "idle")], { t1: [] }, [page])
    ).toHaveLength(0);
    // A tool call left open before the turn ended is not what the agent is doing now.
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("in_progress", [{ path: page.file }], "edit"), turnEnd] },
      [page]
    );
    expect(activity?.action).toBe("thinking");
  });

  it("finds the page in a shell command, which names no location", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      {
        t1: [
          toolCall(
            "in_progress",
            [],
            "execute",
            `sed -i '' 's|Index|Home|' ${page.file}`
          ),
        ],
      },
      [page]
    );
    expect(activity?.pageIds).toEqual(["index"]);
  });

  it("does not light up a page because its name appears in a sentence", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("in_progress", [], "execute", "echo Home index")] },
      [page]
    );
    expect(activity?.pageIds).toEqual([]);
  });

  it("counts asking the editor over MCP as reading", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      {
        t1: [
          toolCall("in_progress", [], "other", "mcp__ultrapaint__list_pages"),
        ],
      },
      [page]
    );
    expect(activity?.action).toBe("reading");
  });

  it("counts Codex asking the editor as reading too, though it calls it execute", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      {
        t1: [
          toolCall(
            "in_progress",
            [],
            "execute",
            "mcp.ultrapaint.get_component"
          ),
        ],
      },
      [page]
    );
    expect(activity?.action).toBe("reading");
  });

  it("falls back to the page the agent said it was working on", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("in_progress", [], "execute", "pnpm typecheck")] },
      [page],
      { t1: "index" }
    );
    expect(activity?.pageIds).toEqual(["index"]);
  });

  it("falls back to that page even when another canvas has the same route", () => {
    const other: Page = {
      ...page,
      canvas: "site",
      file: "docs/designs/site/index.tsx",
      id: "site/index",
    };
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("in_progress", [], "execute", "pnpm typecheck")] },
      [page, other],
      { t1: "site/index" }
    );
    expect(activity?.pageIds).toEqual(["site/index"]);
  });

  it("draws every agent in the agents' colour", () => {
    const activity = agentActivity(
      [thread("t1", "running"), thread("t2", "running")],
      {},
      []
    );
    expect(activity.map((a) => a.color)).toEqual([AGENT_COLOR, AGENT_COLOR]);
  });

  it("keeps a file that is not a page, so the strip can still name it", () => {
    const [activity] = agentActivity(
      [thread("t1", "running")],
      { t1: [toolCall("in_progress", [{ path: "src/button.tsx" }], "read")] },
      [page]
    );
    expect(activity?.action).toBe("reading");
    expect(activity?.pageIds).toEqual([]);
    expect(activity?.places[0]?.path).toBe("src/button.tsx");
  });
});
