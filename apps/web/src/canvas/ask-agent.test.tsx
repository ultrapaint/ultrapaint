// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAsk, useAsk } from "../lib/ask-variations.ts";
import { useEditor } from "../state/editor.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { AskAgent } from "./ask-agent.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const TITLE = { frame: HOME, nodeId: "title" };

let mounted: Root | null = null;

/** The popover open on the heading, as the selection's ✦ opens it. */
const show = (targets = [TITLE]) => {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  const r = mounted;
  act(() =>
    r.render(
      <AskAgent
        onHover={() => undefined}
        onOpenChange={() => undefined}
        open
        subject="Title"
        targets={targets}
      />
    )
  );
};

const field = () => document.querySelector("textarea") as HTMLTextAreaElement;

const type = (text: string) => {
  const el = field();
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const enter = () =>
  act(() => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });

const control = () =>
  document
    .querySelector('[aria-label^="Variations:"]')
    ?.getAttribute("aria-label");

/** Sets the Variations control, as choosing in its menu does. */
const choose = async (label: string) => {
  act(() =>
    (
      document.querySelector('[aria-label^="Variations:"]') as HTMLElement
    ).click()
  );
  await act(async () => {
    await Promise.resolve();
  });
  const item = [...document.querySelectorAll('[role="menuitemradio"]')].find(
    (el) => el.textContent === label
  ) as HTMLElement | undefined;
  act(() => item?.click());
};

/** What was sent, prompt by prompt. */
const prompts = () =>
  fakeApi.calls
    .filter((c) => c.method === "threads.prompt")
    .map((c) => (c.input as { text: string }).text);

const initialAsk = useAsk.getState();

beforeEach(() => {
  fakeApi.reset();
  localStorage.clear();
  useAsk.setState({ ...initialAsk, request: null, takes: 1 }, true);
  useEditor.setState({ canvas: "" });
  fakeApi.respond(
    "threads.create",
    () => ({ id: "thread_1", title: "" }) as never
  );
  fakeApi.respond("threads.prompt", () => undefined as never);
});

afterEach(() => {
  const r = mounted;
  mounted = null;
  act(() => r?.unmount());
  document.body.innerHTML = "";
});

describe("Ask an agent's Variations (ADR 0098)", () => {
  it("leaves One change asking for the change typed, as it always did", async () => {
    show();
    expect(control()).toBe("Variations: One change");
    enter();
    expect(prompts()).toEqual([]);
    type("Make it calmer");
    enter();
    await act(() => fakeApi.requested("threads.prompt"));
    expect(prompts()).toEqual(["Make it calmer"]);
  });

  it("asks for that many takes in a new chat, the field saying what should vary, empty leaving it to the agent", async () => {
    show();
    await choose("3");
    expect(control()).toBe("Variations: 3");
    enter();
    await act(() => fakeApi.requested("threads.prompt"));
    expect(prompts()).toEqual([`/variations ${HOME}#title 3`]);
    expect(
      fakeApi.calls.find((c) => c.method === "threads.create")?.input
    ).toEqual({ title: "Variations of Title" });
  });

  it("says what should vary when it is typed", async () => {
    show();
    await choose("2");
    type("the tone of the words");
    enter();
    await act(() => fakeApi.requested("threads.prompt"));
    expect(prompts()).toEqual([
      `/variations ${HOME}#title 2 the tone of the words`,
    ]);
  });

  it("remembers the count chosen last", async () => {
    show();
    await choose("4");
    act(() => mounted?.unmount());
    mounted = null;
    document.body.innerHTML = "";
    show();
    expect(control()).toBe("Variations: 4");
    expect(localStorage.getItem("ultrapaint:variations-count")).toBe("4");
  });

  it("opens from Make variations… at the count chosen last, three the first time", () => {
    act(() => requestAsk());
    show();
    expect(control()).toBe("Variations: 3");
  });

  it("is One change only for several elements", () => {
    show([TITLE, { frame: HOME, nodeId: "hero" }]);
    expect(control()).toBeUndefined();
  });
});
