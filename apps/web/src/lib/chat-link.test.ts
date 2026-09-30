import type { Thread } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import type { Chip } from "../state/attachments.ts";
import { chatLinkOf } from "./chat-link.ts";

const FILE = "designs/home.json";
const selection = { frame: "home", nodeId: "n1" };

const thread = (id: string, nodeId?: string) =>
  ({
    id,
    title: id,
    ...(nodeId ? { scope: { file: FILE, nodeId } } : {}),
  }) as unknown as Thread;

const chip: Chip = {
  component: false,
  file: FILE,
  frame: "home",
  kind: "node",
  name: "Card",
  nodeId: "n1",
};

describe("chatLinkOf", () => {
  it("is attached when the open thread's composer holds the element", () => {
    const link = chatLinkOf([thread("a")], { a: [chip] }, "a", selection, FILE);
    expect(link).toMatchObject({ attached: true, thread: { id: "a" } });
  });

  it("is only started on when a thread's scope is the element", () => {
    const link = chatLinkOf(
      [thread("a"), thread("b", "n1")],
      { a: [] },
      "a",
      selection,
      FILE
    );
    expect(link).toMatchObject({ attached: false, thread: { id: "b" } });
  });

  it("prefers the attachment over the scope", () => {
    const link = chatLinkOf(
      [thread("a"), thread("b", "n1")],
      { a: [chip] },
      "a",
      selection,
      FILE
    );
    expect(link).toMatchObject({ attached: true, thread: { id: "a" } });
  });

  it("is nothing when the element is in no chat", () => {
    expect(
      chatLinkOf([thread("a", "n2")], { a: [] }, "a", selection, FILE)
    ).toBeNull();
  });
});
