// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chordLabel } from "../lib/keys.ts";
import { useSendKey } from "../state/send-key.ts";
import { SendKeyHint } from "./thread-questions.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useSendKey.getState().setSendKey("enter");
});

describe("the key a Send tooltip names", () => {
  it("is the send key in force: Enter, or ⌘/Ctrl+Enter once that is chosen", () => {
    act(() => mounted.render(<SendKeyHint />));
    expect(container.textContent).toBe(chordLabel("enter"));
    act(() => useSendKey.getState().setSendKey("modEnter"));
    expect(container.textContent).toBe(chordLabel("mod+enter"));
  });
});
