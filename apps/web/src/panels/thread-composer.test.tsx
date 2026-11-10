// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { QueuedPrompt, Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addChip, imageChip, useAttachments } from "../state/attachments.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Composer } from "./thread-composer.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const queued: QueuedPrompt = {
  at: 1,
  attachments: [
    { dataUrl: "data:image/png;base64,AAAA", kind: "image", name: "ref.png" },
  ],
  id: "q1",
  text: "Make the header taller",
};

/** A thread whose agent works, with one prompt waiting for the turn to end. */
const thread: Thread = {
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  queued: [queued],
  status: "running",
  title: "Landing page",
  updatedAt: 0,
};

let mounted: Root;
let container: HTMLElement;

const prompt = () =>
  container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Prompt']");

/** Types `text` in the composer, as the browser does: the field's value, then its input event. */
const type = (text: string) => {
  const field = prompt();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  act(() => {
    setValue?.call(field, text);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Edit on the queued prompt: taken off the queue, and put back in the composer. */
const edit = () =>
  act(async () => {
    container.querySelector<HTMLElement>("button[aria-label='Edit']")?.click();
    await fakeApi.requested("threads.unqueue");
    await Promise.resolve();
  });

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("commands.list", () => []);
  fakeApi.respond("threads.unqueue", () => queued);
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<Composer thread={thread} />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useAttachments.setState({ byThread: {} });
});

describe("Edit on a queued prompt", () => {
  it("puts its text over what is typed in the composer, a blank line between", async () => {
    type("and the footer shorter");
    await edit();
    expect(prompt()?.value).toBe(
      "Make the header taller\n\nand the footer shorter"
    );
  });

  it("puts its text alone in a composer with nothing typed, or only spaces", async () => {
    type("  \n");
    await edit();
    expect(prompt()?.value).toBe("Make the header taller");
  });

  it("keeps what the draft had attached beside what the queued prompt carried", async () => {
    act(() =>
      addChip(thread.id, imageChip("draft.png", "data:image/png;base64,BBBB"))
    );
    await edit();
    expect(
      (useAttachments.getState().byThread[thread.id] ?? []).map((c) =>
        c.kind === "image" ? c.name : c.kind
      )
    ).toEqual(["draft.png", "ref.png"]);
  });
});
