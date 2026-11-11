// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { QueuedPrompt, Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageChip } from "../lib/file-chips.ts";
import { useAgents } from "../state/agents.ts";
import { addChip, useAttachments } from "../state/attachments.ts";
import { useDrafts } from "../state/drafts.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useSlashCommands } from "../state/slash-commands.ts";
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
  useDrafts.setState({ byThread: {} });
  useSlashCommands.setState({ commands: [], loaded: false });
  useAgents.setState({ current: null, view: "list" });
});

/** The thread with no turn running, where Send sends at once. */
const idle: Thread = { ...thread, queued: [], status: "idle" };

/** Draws `shown` in place of what is on screen, as opening another chat does. */
const show = (shown: Thread) => {
  act(() => mounted.unmount());
  mounted = createRoot(container);
  act(() => mounted.render(<Composer thread={shown} />));
};

const press = (key: string) =>
  act(() => {
    prompt()?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  });

const sendButton = () =>
  container.querySelector<HTMLButtonElement>("button[aria-label='Send']");

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

describe("the composer's draft", () => {
  it("stays when the chat is left and opened again", () => {
    type("make the header taller and");
    show(thread);
    expect(prompt()?.value).toBe("make the header taller and");
  });

  it("takes a draft asked for with the caret at its end, to type on", () => {
    useAgents.setState({ current: thread.id, view: "thread" });
    act(() => {
      showLeftPanel({ chat: thread.id, draft: "Design a new page for " });
    });
    const field = prompt();
    expect(field?.value).toBe("Design a new page for ");
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe("Design a new page for ".length);
  });
});

describe("Send", () => {
  it("with nothing typed sends nothing and puts the caret in the prompt", () => {
    show(idle);
    act(() => sendButton()?.click());
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("threads.prompt");
    expect(document.activeElement).toBe(prompt());
  });

  it("says under the composer why a prompt didn't go, keeps it, and tries again", async () => {
    show(idle);
    let sends = 0;
    fakeApi.respond("threads.prompt", () => {
      sends += 1;
      return sends === 1
        ? Promise.reject(new RequestError("internal", "The agent is gone"))
        : Promise.resolve(undefined as never);
    });
    type("Make the header taller");
    await act(async () => {
      sendButton()?.click();
      await fakeApi.requested("threads.prompt");
    });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("The agent is gone");
    expect(prompt()?.value).toBe("Make the header taller");
    await act(async () => {
      [...(alert?.querySelectorAll("button") ?? [])]
        .find((b) => b.textContent === "Try again")
        ?.click();
      await fakeApi.requested("threads.prompt", 2);
    });
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(prompt()?.value).toBe("");
  });
});

describe("the commands' list", () => {
  it("closes on Escape, and opens again as the query changes", () => {
    useSlashCommands.setState({
      commands: [{ description: "Build the page", name: "implement" }],
      loaded: true,
    });
    type("/im");
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
    expect(prompt()?.getAttribute("aria-activedescendant")).toBe(
      container.querySelector("[role='option']")?.id
    );
    press("Escape");
    expect(container.querySelector("[role='listbox']")).toBeNull();
    type("/imp");
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
  });
});
