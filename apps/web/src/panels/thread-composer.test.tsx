// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { Skill } from "@ultrapaint/contracts/skills";
import type { QueuedPrompt, Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useAttachments } from "../state/attachments.ts";
import { useDrafts } from "../state/drafts.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useQueuedEdits } from "../state/queued-edit.ts";
import { useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
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

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("commands.list", () => []);
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
  useSkills.setState({ loaded: false, skills: [] });
  useAgents.setState({ current: null, view: "list" });
  useSendKey.setState({ followUp: "steer", sendKey: "enter" });
  useQueuedEdits.setState({ byThread: {} });
  localStorage.clear();
});

/** The design skill the tool ships, on as the project's default. */
const designSkill: Skill = {
  enabled: true,
  name: "ultrapaint",
  source: "built-in",
  summary: "Interface design rules",
  text: "# Ultrapaint",
  title: "Ultrapaint",
};

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

/** A key pressed in the prompt, with what is held. */
const pressWith = (key: string, held: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    prompt()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...held,
      })
    );
  });

/** What the composer's last prompt said of where it goes while the agent works. */
const lastFollowUp = () => {
  const input = fakeApi.calls.findLast((c) => c.method === "threads.prompt")
    ?.input as { followUp?: string } | undefined;
  return input?.followUp;
};

describe("a prompt sent while the agent works (ADR 0137)", () => {
  it("goes into the turn on Enter, and waits in the queue on ⌘Enter", async () => {
    type("and the footer shorter");
    await act(async () => {
      pressWith("Enter");
      await fakeApi.requested("threads.prompt");
    });
    expect(lastFollowUp()).toBe("steer");
    type("then the header");
    await act(async () => {
      pressWith("Enter", { metaKey: true });
      await fakeApi.requested("threads.prompt", 2);
    });
    expect(lastFollowUp()).toBe("queue");
  });

  it("queues on Enter, and goes into the turn on ⌘Enter, once Queue is chosen", async () => {
    act(() => useSendKey.getState().setFollowUp("queue"));
    type("and the footer shorter");
    await act(async () => {
      pressWith("Enter");
      await fakeApi.requested("threads.prompt");
    });
    expect(lastFollowUp()).toBe("queue");
    type("then the header");
    await act(async () => {
      pressWith("Enter", { ctrlKey: true });
      await fakeApi.requested("threads.prompt", 2);
    });
    expect(lastFollowUp()).toBe("steer");
  });

  it("is tried again the way it was sent", async () => {
    let sends = 0;
    fakeApi.respond("threads.prompt", () => {
      sends += 1;
      return sends === 1
        ? Promise.reject(new RequestError("internal", "The agent is gone"))
        : Promise.resolve(undefined as never);
    });
    type("then the header");
    await act(async () => {
      pressWith("Enter", { metaKey: true });
      await fakeApi.requested("threads.prompt");
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Try again")
        ?.click();
      await fakeApi.requested("threads.prompt", 2);
    });
    expect(lastFollowUp()).toBe("queue");
  });

  it("says on its button what Enter does", () => {
    type("and the footer shorter");
    expect(
      container.querySelector("button[aria-label='Send now']")
    ).not.toBeNull();
    act(() => useSendKey.getState().setFollowUp("queue"));
    expect(
      container.querySelector("button[aria-label='Queue']")
    ).not.toBeNull();
  });

  it("waits in the queue while the agent is being stopped, and says so", async () => {
    show({ ...thread, status: "cancelling" });
    type("and the footer shorter");
    expect(
      container.querySelector("button[aria-label='Queue']")
    ).not.toBeNull();
    await act(async () => {
      pressWith("Enter");
      await fakeApi.requested("threads.prompt");
    });
    expect(lastFollowUp()).toBe("queue");
  });

  it("goes as any prompt once the agent is done", async () => {
    show(idle);
    type("Make the header taller");
    await act(async () => {
      pressWith("Enter");
      await fakeApi.requested("threads.prompt");
    });
    expect(lastFollowUp()).toBeUndefined();
  });
});

describe("the queue's keys in an empty composer", () => {
  it("edits the last queued prompt on ⌥↑", async () => {
    fakeApi.respond("threads.editQueued", () => queued);
    await act(async () => {
      pressWith("ArrowUp", { altKey: true });
      await fakeApi.requested("threads.editQueued");
    });
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      edit: { action: "start" },
      id: "q1",
      threadId: "t1",
    });
  });

  it("sends the first queued prompt now on ⌘⇧Enter", async () => {
    await act(async () => {
      pressWith("Enter", { metaKey: true, shiftKey: true });
      await fakeApi.requested("threads.sendQueued");
    });
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("threads.prompt");
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

  it("says over the composer why a prompt didn't go, keeps it, and tries again", async () => {
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
    // Right over the composer and its tray, which stay where they were.
    expect(
      container.querySelector("[data-composer-stack]")?.previousElementSibling
    ).toBe(alert);
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

describe("Force stop", () => {
  const forceStop = () =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Force stop"
    );

  it("is offered only once the agent has not confirmed a stop", () => {
    expect(forceStop()).toBeUndefined();
    show({ ...thread, status: "cancelling" });
    expect(forceStop()).toBeUndefined();
    show({ ...thread, status: "unresponsive" });
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      "isn't responding"
    );
    expect(forceStop()).toBeDefined();
  });

  it("asks the server to force stop the turn", async () => {
    fakeApi.respond("threads.forceStop", () => undefined);
    show({ ...thread, status: "unresponsive" });
    await act(async () => {
      forceStop()?.click();
      await fakeApi.requested("threads.forceStop");
    });
    expect(
      fakeApi.calls.find((c) => c.method === "threads.forceStop")?.input
    ).toEqual({ threadId: "t1" });
  });
});

/** The labels of the buttons under `selector`, up to their colon. */
const buttonNames = (selector: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(selector)].map(
    (b) => b.getAttribute("aria-label")?.split(":")[0]
  );

describe("the composer's bar", () => {
  it("has Attach at its start, then the model and Send at its end", () => {
    show(idle);
    expect(buttonNames("[data-composer] button[aria-label]")).toEqual([
      "Attach",
      "Agent and model",
      "Send",
    ]);
  });

  it("hangs a tray under it with the chat's design skills, then its review", () => {
    act(() => useSkills.setState({ loaded: true, skills: [designSkill] }));
    show(idle);
    expect(
      buttonNames("[data-composer-stack] > :last-child button[aria-label]")
    ).toEqual(["Skills", "Review"]);
  });

  it("names every chosen skill, and lists them a line each, the others' summaries a level down", async () => {
    const skill = (name: string, enabled = false): Skill => ({
      enabled,
      file: `.claude/skills/${name}/SKILL.md`,
      name,
      source: "project",
      summary: `What ${name} does`,
      text: `# ${name}`,
      title: name,
    });
    act(() =>
      useSkills.setState({
        loaded: true,
        skills: [designSkill, skill("voice", true), skill("grilling")],
      })
    );
    show(idle);
    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-label^='Skills']"
    );
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Skills: Ultrapaint, voice"
    );
    expect(trigger?.textContent).toBe("SkillsUltrapaint +1");
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });
    const rows = [
      ...document.querySelectorAll("[role='menuitemcheckbox']"),
    ].map((row) => row.textContent);
    expect(rows).toEqual([
      "UltrapaintDefault",
      "voiceDefault",
      expect.stringContaining("No design skill"),
    ]);
    expect(document.body.textContent).toContain("Other skills");
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });
  });

  it("has no tray in a chat that writes the code", () => {
    act(() => useSkills.setState({ loaded: true, skills: [designSkill] }));
    show({ ...idle, purpose: "implement" });
    expect(
      container.querySelector("[data-composer-stack]")?.children
    ).toHaveLength(1);
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
