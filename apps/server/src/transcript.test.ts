import { describe, expect, it } from "@effect/vitest";
import { migrateStored } from "./services/threads/thread-store.ts";
import { projectUpdate, toolContent } from "./services/threads/transcript.ts";

const REPO_RE = /^\/repo\/?/;

const ctx = {
  hasItem: () => false,
  newId: () => "item_1",
  now: 1000,
  relative: (file: string) => file.replace("/repo/", ""),
  turn: null,
};

describe("toolContent", () => {
  it("keeps a diff as a diff, so the editor can show the change", () => {
    expect(
      toolContent(
        {
          newText: "after",
          oldText: "before",
          path: "/repo/designs/index.tsx",
          type: "diff",
        },
        ctx
      )
    ).toEqual({
      newText: "after",
      oldText: "before",
      path: "designs/index.tsx",
      type: "diff",
    });
  });

  it("keeps a terminal's id, so its output can be followed while it runs", () => {
    expect(
      toolContent({ terminalId: "term_1", type: "terminal" }, ctx)
    ).toEqual({
      terminalId: "term_1",
      type: "terminal",
    });
  });

  it("reads text out of a content block and names anything else", () => {
    expect(
      toolContent(
        { content: { text: "hello", type: "text" }, type: "content" },
        ctx
      )
    ).toEqual({ text: "hello", type: "text" });
    expect(toolContent({ type: "audio" }, ctx)).toEqual({
      text: "[audio]",
      type: "text",
    });
  });
});

describe("projectUpdate", () => {
  it("keeps the line of a location and makes its path repository-relative", () => {
    const [action] = projectUpdate(
      {
        locations: [{ line: 42, path: "/repo/designs/index.tsx" }],
        sessionUpdate: "tool_call",
        title: "Edit",
        toolCallId: "call_1",
      } as Parameters<typeof projectUpdate>[0],
      ctx
    );
    expect(
      action?.type === "push" &&
        action.item.kind === "tool" &&
        action.item.locations
    ).toEqual([{ line: 42, path: "designs/index.tsx" }]);
  });

  it("leaves out a command's cd into the repository, and keeps one anywhere else", () => {
    const titleOf = (title: string) => {
      const [action] = projectUpdate(
        {
          kind: "execute",
          sessionUpdate: "tool_call",
          title,
          toolCallId: "call_1",
        } as Parameters<typeof projectUpdate>[0],
        { ...ctx, relative: (file) => file.replace(REPO_RE, "") }
      );
      return action?.type === "push" && action.item.kind === "tool"
        ? action.item.title
        : undefined;
    };
    expect(titleOf("cd /repo && pnpm test")).toBe("pnpm test");
    expect(titleOf("cd '/repo/'; git status")).toBe("git status");
    expect(titleOf("cd /repo/apps/web && pnpm test")).toBe(
      "cd /repo/apps/web && pnpm test"
    );
    expect(titleOf("cd /tmp && ls")).toBe("cd /tmp && ls");
    expect(titleOf("cd /repo")).toBe("cd /repo");
  });
});

describe("migrateStored", () => {
  it("reads a thread written before tool content was structured", () => {
    const old = {
      items: [
        {
          at: 1,
          content: ["file body"],
          id: "tool_1",
          kind: "tool",
          locations: ["designs/index.tsx"],
          status: "completed",
          title: "Read",
          toolCallId: "call_1",
        },
      ],
      thread: { id: "thread_1" },
    };
    const [item] = (migrateStored(old) as typeof old).items as unknown as {
      content: unknown;
      locations: unknown;
    }[];
    expect(item?.content).toEqual([{ text: "file body", type: "text" }]);
    expect(item?.locations).toEqual([{ path: "designs/index.tsx" }]);
  });

  it("leaves a current thread exactly as it was, rather than rebuild it", () => {
    const current = {
      items: [
        {
          content: [{ text: "file body", type: "text" }],
          kind: "tool",
          locations: [{ path: "designs/index.tsx" }],
        },
      ],
    };
    expect(migrateStored(current)).toBe(current);
  });

  it("leaves what is not a thread at all to the decoder", () => {
    expect(migrateStored("not a thread")).toBe("not a thread");
  });
});
