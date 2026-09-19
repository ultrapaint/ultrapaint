import { describe, expect, it } from "@effect/vitest";
import { migrateStored } from "./services/threads/thread-store.ts";
import { projectUpdate, toolContent } from "./services/threads/transcript.ts";

describe("toolContent", () => {
  it("keeps a diff as a diff, so the editor can show the change", () => {
    expect(
      toolContent({
        newText: "after",
        oldText: "before",
        path: "designs/index.tsx",
        type: "diff",
      })
    ).toEqual({
      newText: "after",
      oldText: "before",
      path: "designs/index.tsx",
      type: "diff",
    });
  });

  it("keeps a terminal's id, so its output can be followed while it runs", () => {
    expect(toolContent({ terminalId: "term_1", type: "terminal" })).toEqual({
      terminalId: "term_1",
      type: "terminal",
    });
  });

  it("reads text out of a content block and names anything else", () => {
    expect(
      toolContent({ content: { text: "hello", type: "text" }, type: "content" })
    ).toEqual({ text: "hello", type: "text" });
    expect(toolContent({ type: "audio" })).toEqual({
      text: "[audio]",
      type: "text",
    });
  });
});

describe("projectUpdate", () => {
  const ctx = {
    hasItem: () => false,
    newId: () => "item_1",
    now: 1000,
    turn: null,
  };

  it("keeps the line of a location, which is what the canvas follows", () => {
    const [action] = projectUpdate(
      {
        locations: [{ line: 42, path: "designs/index.tsx" }],
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
});

describe("migrateStored", () => {
  it("reads a thread written before tool content was structured", () => {
    const old = JSON.stringify({
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
    });
    const [item] = JSON.parse(migrateStored(old)).items;
    expect(item.content).toEqual([{ text: "file body", type: "text" }]);
    expect(item.locations).toEqual([{ path: "designs/index.tsx" }]);
  });

  it("leaves a file it cannot read to the decoder", () => {
    expect(migrateStored("not json")).toBe("not json");
  });
});
