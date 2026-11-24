// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { QueuedPrompt, Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageChip } from "../lib/file-chips.ts";
import { useAgents } from "../state/agents.ts";
import { addChip, useAttachments } from "../state/attachments.ts";
import { useDrafts } from "../state/drafts.ts";
import { useProject } from "../state/project.ts";
import { useQueuedEdits } from "../state/queued-edit.ts";
import { useSkills } from "../state/skills.ts";
import { useSlashCommands } from "../state/slash-commands.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Composer } from "./thread-composer.tsx";
import { QueuedPrompts } from "./thread-queue.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const queuedPrompt = (id: string, text: string): QueuedPrompt => ({
  at: 1,
  attachments: [],
  id,
  text,
});

const header: QueuedPrompt = {
  at: 1,
  attachments: [
    { dataUrl: "data:image/png;base64,AAAA", kind: "image", name: "ref.png" },
  ],
  id: "q1",
  text: "Make the header taller",
};

/** A thread whose agent works, with prompts waiting. */
const running = (queued: readonly QueuedPrompt[]): Thread => ({
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  queued: [...queued],
  status: "running",
  title: "Landing page",
  updatedAt: 0,
});

let mounted: Root;
let container: HTMLElement;

/** The queue at the chat's end and the composer under it, as the chat draws them. */
const render = (thread: Thread) =>
  act(() =>
    mounted.render(
      <>
        <QueuedPrompts thread={thread} />
        <Composer thread={thread} />
      </>
    )
  );

const prompt = () =>
  container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Prompt']");

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

/** The `n`th queued prompt's row. */
const row = (n: number) =>
  container.querySelectorAll<HTMLElement>(
    "section[aria-label$='queued prompts'] li, section[aria-label$='queued prompt'] li"
  )[n];

const button = (within: Element | undefined, name: string) =>
  [...(within?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent === name
  );

const chipNames = () =>
  (useAttachments.getState().byThread.t1 ?? []).map((c) =>
    c.kind === "image" ? c.name : c.kind
  );

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("commands.list", () => []);
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useAttachments.setState({ byThread: {} });
  useDrafts.setState({ byThread: {} });
  useQueuedEdits.setState({ byThread: {} });
  useSlashCommands.setState({ commands: [], loaded: false });
  useSkills.setState({ loaded: false, skills: [] });
  useAgents.setState({ current: null, view: "list" });
  useProject.setState({ error: null });
});

describe("a queued prompt (ADR 0137)", () => {
  it("shows its words and pictures, with Send now, Edit and Remove under it", () => {
    render(running([header, queuedPrompt("q2", "Then the footer")]));
    const first = row(0);
    expect(first?.getAttribute("aria-label")).toBe(
      "Queued prompt 1 of 2, not sent"
    );
    expect(first?.textContent).toContain("Make the header taller");
    expect(first?.querySelector("img")?.getAttribute("alt")).toBe("ref.png");
    expect(button(first, "Send now")).toBeDefined();
    expect(button(first, "Edit queued prompt")).toBeDefined();
    expect(button(first, "Remove queued prompt")).toBeDefined();
    // No line over the queue: the bubbles say it.
    expect(container.textContent).not.toContain("sent when this turn ends");
  });

  it("is sent now by its id", async () => {
    render(running([header, queuedPrompt("q2", "Then the footer")]));
    await act(async () => {
      button(row(1), "Send now")?.click();
      await fakeApi.requested("threads.sendQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({ id: "q2", threadId: "t1" });
  });

  it("offers no Send now while the agent is being stopped", () => {
    render({ ...running([header]), status: "cancelling" });
    expect(button(row(0), "Send now")).toBeUndefined();
    expect(button(row(0), "Edit queued prompt")).toBeDefined();
  });

  it("is taken off the queue by Remove", async () => {
    render(running([header]));
    await act(async () => {
      button(row(0), "Remove queued prompt")?.click();
      await fakeApi.requested("threads.unqueue");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({ id: "q1", threadId: "t1" });
  });

  it("reads that it waits to be read once sent into the turn, still to be edited or removed", () => {
    render(running([{ ...header, steering: true }]));
    expect(row(0)?.textContent).toContain("Steer · waiting to be read");
    expect(button(row(0), "Send now")).toBeUndefined();
    expect(button(row(0), "Edit queued prompt")).toBeDefined();
    expect(button(row(0), "Remove queued prompt")).toBeDefined();
  });

  it("held by an edit no window has open, can be let go or taken into this composer", async () => {
    fakeApi.respond("threads.editQueued", () => header);
    render(running([{ ...header, editing: true }]));
    expect(row(0)?.textContent).toContain("Being edited");
    expect(button(row(0), "Send now")).toBeUndefined();
    expect(button(row(0), "Edit queued prompt")).toBeDefined();
    await act(async () => {
      button(row(0), "Cancel editing the queued prompt")?.click();
      await fakeApi.requested("threads.editQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      edit: { action: "cancel" },
      id: "q1",
      threadId: "t1",
    });
  });

  it("shows the first two of four, and the rest on Show all", () => {
    render(
      running([
        header,
        queuedPrompt("q2", "two"),
        queuedPrompt("q3", "three"),
        queuedPrompt("q4", "four"),
      ])
    );
    expect(row(2)).toBeUndefined();
    const all = button(container, "Show all 4 queued");
    act(() => all?.click());
    expect(row(3)?.textContent).toContain("four");
  });
});

describe("reordering the queue", () => {
  const three = running([
    header,
    queuedPrompt("q2", "two"),
    queuedPrompt("q3", "three"),
  ]);
  const grip = (n: number) => button(row(n), "Move queued prompt");

  it("moves a prompt down a place on ⌥↓ on its grip, up on ⌥↑", async () => {
    render(three);
    await act(async () => {
      grip(0)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          key: "ArrowDown",
        })
      );
      await fakeApi.requested("threads.moveQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      before: "q3",
      id: "q1",
      threadId: "t1",
    });
    await act(async () => {
      grip(2)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          key: "ArrowUp",
        })
      );
      await fakeApi.requested("threads.moveQueued", 2);
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      before: "q2",
      id: "q3",
      threadId: "t1",
    });
  });

  it("moves a prompt dragged by its grip after the last when dropped on its lower half", async () => {
    render(three);
    const last = row(2);
    if (last) {
      last.getBoundingClientRect = () => ({ height: 40, top: 100 }) as DOMRect;
    }
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(drop, { clientY: 130 });
    const start = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.assign(start, {
      dataTransfer: {
        effectAllowed: "uninitialized",
        setData: () => undefined,
      },
    });
    act(() => {
      grip(0)?.dispatchEvent(start);
    });
    await act(async () => {
      last?.dispatchEvent(drop);
      await fakeApi.requested("threads.moveQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      before: null,
      id: "q1",
      threadId: "t1",
    });
  });

  it("moves a prompt dragged by its grip before the one it is dropped on", async () => {
    render(three);
    const drag = (kind: string, target: Element | null | undefined) => {
      const event = new Event(kind, { bubbles: true, cancelable: true });
      Object.assign(event, {
        dataTransfer: {
          effectAllowed: "uninitialized",
          setData: () => undefined,
        },
      });
      act(() => {
        target?.dispatchEvent(event);
      });
    };
    drag("dragstart", grip(2));
    await act(async () => {
      drag("drop", row(0));
      await fakeApi.requested("threads.moveQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      before: "q1",
      id: "q3",
      threadId: "t1",
    });
  });
});

describe("editing a queued prompt", () => {
  beforeEach(() => {
    fakeApi.respond("threads.editQueued", (input) =>
      (input as { edit: { action: string } }).edit.action === "start"
        ? { ...header, editing: true }
        : header
    );
  });

  /** Edit on the first queued prompt. */
  const edit = () =>
    act(async () => {
      button(row(0), "Edit queued prompt")?.click();
      await fakeApi.requested("threads.editQueued");
      await Promise.resolve();
    });

  it("opens it in the composer, the draft set aside, and Update saves it and brings the draft back", async () => {
    render(running([header]));
    type("and the footer shorter");
    act(() =>
      addChip("t1", imageChip("draft.png", "data:image/png;base64,BBBB"))
    );
    await edit();
    expect(prompt()?.value).toBe("Make the header taller");
    expect(chipNames()).toEqual(["ref.png"]);
    expect(row(0)?.textContent).toContain("Editing in the composer");
    type("Make the header taller, and bold");
    await act(async () => {
      button(container, "Update queued prompt")?.click();
      await fakeApi.requested("threads.editQueued", 2);
    });
    expect(fakeApi.calls.at(-1)?.input).toMatchObject({
      edit: {
        action: "save",
        attachments: [{ kind: "image", name: "ref.png" }],
        text: "Make the header taller, and bold",
      },
      id: "q1",
    });
    // Updated, not sent as a prompt of its own.
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("threads.prompt");
    expect(prompt()?.value).toBe("and the footer shorter");
    expect(chipNames()).toEqual(["draft.png"]);
  });

  it("is not taken for lost when the queue moves on before Update is answered", async () => {
    let answer: (value: unknown) => void = () => undefined;
    render(running([header]));
    await edit();
    fakeApi.respond(
      "threads.editQueued",
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never
    );
    type("Make the header taller, and bold");
    await act(async () => {
      button(container, "Update queued prompt")?.click();
      await fakeApi.requested("threads.editQueued", 2);
    });
    // The saved prompt went to the agent and left the queue before the server answered.
    render(running([]));
    await act(async () => {
      answer(header);
      await Promise.resolve();
    });
    expect(prompt()?.value).toBe("");
    expect(document.body.textContent).not.toContain("no longer queued");
  });

  it("saves the attachments no chip shows as they were", async () => {
    const withFile: QueuedPrompt = {
      ...header,
      attachments: [{ kind: "file", path: "README.md" }],
    };
    fakeApi.respond("threads.editQueued", () => withFile);
    render(running([withFile]));
    await edit();
    await act(async () => {
      button(container, "Update queued prompt")?.click();
      await fakeApi.requested("threads.editQueued", 2);
    });
    expect(fakeApi.calls.at(-1)?.input).toMatchObject({
      edit: {
        action: "save",
        attachments: [{ kind: "file", path: "README.md" }],
      },
    });
  });

  it("lets the edit go on Escape, the draft back", async () => {
    render(running([header]));
    type("and the footer shorter");
    await edit();
    await act(async () => {
      prompt()?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
      await fakeApi.requested("threads.editQueued", 2);
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      edit: { action: "cancel" },
      id: "q1",
      threadId: "t1",
    });
    expect(prompt()?.value).toBe("and the footer shorter");
  });

  it("keeps the edit in an empty composer when its prompt left the queue some other way", async () => {
    render(running([header]));
    await edit();
    type("Make the header taller, and bold");
    render(running([]));
    expect(prompt()?.value).toBe("Make the header taller, and bold");
    expect(useQueuedEdits.getState().byThread.t1).toBeUndefined();
  });

  it("drops the edit, and brings the draft back, when its prompt left the queue over a draft", async () => {
    render(running([header]));
    type("and the footer shorter");
    await edit();
    render(running([]));
    expect(prompt()?.value).toBe("and the footer shorter");
  });
});
