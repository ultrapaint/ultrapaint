// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  SyncPlan,
  TokenComparison,
  TokenDiff,
} from "@ultrapaint/contracts/sync";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { CodeTokensStep } from "./sync-code.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const planAt = (at: number): SyncPlan => ({
  at,
  case: "maintain",
  drift: { tokensUndescribed: [] },
  facts: { app: true, designSystem: true, stylesheets: 1 },
  steps: [],
  summary: "",
});

/** The code against the design, with one token waiting for the code under `name`. */
const comparisonOf = (name: string): TokenComparison => ({
  baseline: true,
  diffs: [
    {
      design: "8px",
      kind: "spacing",
      name,
      outcome: "source-behind",
      source: "4px",
      variable: name,
    },
  ],
  file: "styles.css",
  notes: [],
  source: "code",
  targets: [],
});

/** An answer the test gives when it chooses to. */
const later = <T,>() => {
  let settle: { no: (error: Error) => void; yes: (value: T) => void };
  const promise = new Promise<T>((yes, no) => {
    settle = { no, yes };
  });
  return {
    fail: (error: Error) => act(async () => settle.no(error)),
    give: (value: T) => act(async () => settle.yes(value)),
    promise,
  };
};

let mounted: Root;
let container: HTMLElement;

const render = (plan: SyncPlan) =>
  act(() => mounted.render(<CodeTokensStep plan={plan} />));

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({ error: null });
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useProject.setState({ error: null });
});

describe("Sync › the code's tokens", () => {
  it("says a read failed in place, and reads again with Try again", async () => {
    const first = later<TokenComparison>();
    fakeApi.respond("sync.tokens", () => first.promise);
    render(planAt(1));
    expect(container.querySelector("[role=status]")).not.toBeNull();

    await first.fail(new Error("the stylesheet is gone"));
    expect(container.textContent).toBe("The tokens didn’t loadTry again");

    fakeApi.respond("sync.tokens", () => comparisonOf("space-2"));
    await act(async () => {
      button("Try again")?.click();
      await fakeApi.requested("sync.tokens", 2);
    });
    expect(container.textContent).toContain("space-2");
    expect(button("Try again")).toBeUndefined();
  });

  it("says, before Export, the file each value will be written in or added to", async () => {
    const [spacing] = comparisonOf("space-2").diffs;
    fakeApi.respond("sync.tokens", () => ({
      ...comparisonOf("space-2"),
      diffs: [
        {
          ...(spacing as TokenDiff),
          write: {
            does: "change",
            file: "src/app.css",
            from: "4px",
            name: "space-2",
            to: "8px",
          },
        },
        {
          design: "#f59e0b",
          kind: "color",
          name: "color-accent",
          outcome: "source-behind",
          variable: "color-accent",
          write: {
            does: "add",
            file: "src/tokens.css",
            name: "color-accent",
            to: "#f59e0b",
          },
        },
      ],
    }));
    render(planAt(1));
    await act(() => fakeApi.requested("sync.tokens", 1));
    const rows = [...container.querySelectorAll("li")].map(
      (li) => li.textContent
    );
    expect(rows).toEqual([
      "space-24px→ 8pxin src/app.css",
      "color-accentnone→ #f59e0badded to src/tokens.css",
    ]);
    expect(button("Export 2 tokens to the code")).toBeDefined();
  });

  it("keeps the newer plan's answer when an older read answers after it", async () => {
    const older = later<TokenComparison>();
    fakeApi.respond("sync.tokens", () => older.promise);
    render(planAt(1));
    fakeApi.respond("sync.tokens", () => comparisonOf("space-new"));
    render(planAt(2));
    await act(() => fakeApi.requested("sync.tokens", 2));
    expect(container.textContent).toContain("space-new");

    await older.give(comparisonOf("space-old"));
    expect(container.textContent).toContain("space-new");
    expect(container.textContent).not.toContain("space-old");
  });
});
