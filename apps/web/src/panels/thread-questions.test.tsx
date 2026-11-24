// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionItem } from "../lib/answers.ts";
import { chordLabel } from "../lib/keys.ts";
import { useSendKey } from "../state/send-key.ts";
import {
  OpenQuestion,
  Permission,
  QuestionRecord,
  SendKeyHint,
} from "./thread-questions.tsx";

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

const PLAN: QuestionItem = {
  answers: null,
  at: 1,
  elicitation: { message: "The agent asks" },
  id: "item_1",
  kind: "question",
  questions: [
    {
      id: "plan",
      options: [
        { id: "free", label: "Free" },
        { id: "pro", label: "Pro" },
      ],
      question: "Which plan?",
    },
  ],
};

const EDIT_HOME: Extract<ThreadItem, { kind: "permission" }> = {
  at: 1,
  decision: null,
  id: "perm_1",
  kind: "permission",
  options: [
    { kind: "allow_once", name: "Allow", optionId: "allow" },
    { kind: "reject_once", name: "Reject", optionId: "reject" },
  ],
  requestId: "perm_1",
  title: "Edit home",
};

const buttons = () =>
  [...container.querySelectorAll("button")].map((b) => b.textContent);

describe("a card no agent waits on any more (ADR 0125)", () => {
  it("a permission open when the server restarted reads Expired, with nothing to pick", () => {
    act(() =>
      mounted.render(
        <Permission
          item={{
            ...EDIT_HOME,
            decision: "expired",
            settled: { at: 2, how: "expired" },
          }}
          threadId="t1"
        />
      )
    );
    expect(container.textContent).toContain("Expired");
    expect(buttons()).toEqual([]);
  });

  it("reads Expired even when one of the agent's options is named expired", () => {
    act(() =>
      mounted.render(
        <Permission
          item={{
            ...EDIT_HOME,
            decision: "expired",
            options: [
              { kind: "allow_once", name: "Allow", optionId: "expired" },
              { kind: "reject_once", name: "Reject", optionId: "reject" },
            ],
            settled: { at: 2, how: "expired" },
          }}
          threadId="t1"
        />
      )
    );
    expect(container.textContent).toContain("Expired");
    expect(container.textContent).not.toContain("Allow");
  });

  it("a permission the agent stopped asking reads No longer asked", () => {
    act(() =>
      mounted.render(
        <Permission
          item={{ ...EDIT_HOME, decision: "cancelled" }}
          threadId="t1"
        />
      )
    );
    expect(container.textContent).toContain("No longer asked");
  });

  it("a pick that could not be delivered says so", () => {
    act(() =>
      mounted.render(
        <Permission
          item={{
            ...EDIT_HOME,
            decision: "allow",
            settled: { at: 2, how: "undelivered" },
          }}
          threadId="t1"
        />
      )
    );
    expect(container.textContent).toContain("Delivery not confirmed");
    expect(container.textContent).toContain("Allow");
  });

  it("answers that could not be delivered say so, and to say them again", () => {
    act(() =>
      mounted.render(
        <QuestionRecord
          item={{ ...PLAN, answers: { plan: "pro" }, outcome: "undelivered" }}
        />
      )
    );
    expect(container.textContent).toContain("Delivery not confirmed");
    expect(container.textContent).toContain("Pro");
    expect(container.textContent).toContain("Say them again in the chat.");
  });

  it("an older copy the agent asked again reads No longer asked", () => {
    act(() =>
      mounted.render(
        <QuestionRecord
          item={{
            ...PLAN,
            outcome: "cancelled",
            settled: { at: 2, how: "repeated" },
          }}
        />
      )
    );
    expect(container.textContent).toContain("No longer asked");
  });

  it("a card the agent let go is one row until opened, its questions without answers (ADR 0129)", () => {
    act(() =>
      mounted.render(
        <QuestionRecord
          item={{
            ...PLAN,
            outcome: "cancelled",
            settled: { at: 2, how: "withdrawn" },
          }}
        />
      )
    );
    expect(container.textContent).toBe("No longer asked1 question");
    const row = container.querySelector("button");
    act(() => row?.click());
    expect(container.textContent).toContain("Which plan?");
    expect(container.textContent).not.toContain("—");
  });

  it("an answered card reads the answer, its question one click away (ADR 0129)", () => {
    act(() =>
      mounted.render(
        <QuestionRecord item={{ ...PLAN, answers: { plan: "pro" } }} />
      )
    );
    expect(container.textContent).toBe("You answered Pro");
    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("Which plan?");
  });

  it("a question a restart let go is answered by a prompt, so it cannot be declined", () => {
    const draft = { busy: false, other: {}, picked: {}, step: 0 };
    const [question] = PLAN.questions;
    if (!question) {
      throw new Error("the card has a question");
    }
    act(() =>
      mounted.render(
        <OpenQuestion
          answering={{ asking: PLAN, draft, question }}
          threadId="t1"
        />
      )
    );
    expect(buttons()).toContain("Decline");
    act(() =>
      mounted.render(
        <OpenQuestion
          answering={{ asking: { ...PLAN, restartedAt: 2 }, draft, question }}
          threadId="t1"
        />
      )
    );
    expect(buttons()).not.toContain("Decline");
  });
});
