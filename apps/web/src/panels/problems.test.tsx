// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  DesignDocument,
  DesignFinding,
} from "@ultrapaint/contracts/design-system";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPrompt } from "../lib/start-thread.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useSync } from "../state/sync.ts";
import { Problems } from "./problems.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../lib/start-thread.ts", () => ({ startPrompt: vi.fn() }));
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MISSING_PRIMARY: DesignFinding = {
  message:
    "No 'primary' color defined. The agent will auto-generate key colors, reducing your control over the palette.",
  path: "colors",
  severity: "warning",
};
const BROKEN: DesignFinding = {
  message:
    "Reference {colors.brand-500} does not resolve to any defined token.",
  path: "components.card.backgroundColor",
  severity: "error",
};

const documentWith = (findings: readonly DesignFinding[]): DesignDocument => ({
  body: "",
  findings,
  held: [],
  legacy: false,
  path: "DESIGN.md",
  sections: [],
  text: "",
});

const initialDesignSystem = useDesignSystem.getState();
const initialSync = useSync.getState();
const initialSetup = useDesignSystemSetup.getState();

let mounted: Root;
let container: HTMLElement;

const panelWith = (findings: readonly DesignFinding[]) => {
  useDesignSystem.setState({ document: documentWith(findings), loaded: true });
  act(() => mounted.render(<Problems />));
};

const button = (name: string) =>
  [...container.querySelectorAll("button")].filter(
    (b) => b.textContent === name
  );

beforeEach(() => {
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useDesignSystem.setState(initialDesignSystem, true);
  useSync.setState(initialSync, true);
  useDesignSystemSetup.setState(initialSetup, true);
  vi.clearAllMocks();
});

describe("Problems (ADR 0106)", () => {
  it("lists each problem under the file it is read from, in its own words", () => {
    panelWith([MISSING_PRIMARY, BROKEN]);
    const group = container.querySelector('section[aria-label="DESIGN.md"]');
    expect(group?.querySelector("h3")?.textContent).toBe("DESIGN.md");
    expect(
      [...(group?.querySelectorAll("li") ?? [])].map((li) =>
        li.getAttribute("aria-label")
      )
    ).toEqual(["No primary colour", "card points to a missing token"]);
    expect(container.querySelector("h2")?.parentElement?.textContent).toBe(
      "Problems2"
    );
  });

  it("drafts a chat to fix one problem with what its file says", () => {
    panelWith([MISSING_PRIMARY]);
    act(() => button("Fix with agent")[0]?.click());
    expect(startPrompt).toHaveBeenCalledWith(
      `Fix this in the design system: DESIGN.md, \`colors\`: ${MISSING_PRIMARY.message} Ask me where the choice is mine.`
    );
  });

  it("drafts one chat for them all, offered only when there is more than one", () => {
    panelWith([MISSING_PRIMARY]);
    expect(button("Fix all with agent")).toEqual([]);
    panelWith([MISSING_PRIMARY, BROKEN]);
    act(() => button("Fix all with agent")[0]?.click());
    expect(vi.mocked(startPrompt).mock.calls[0]?.[0]).toContain(
      "Fix these in the design system:"
    );
  });

  it("sends a step the sync waits on to the Sync", () => {
    useSync.setState({
      plan: {
        at: 1,
        case: "maintain",
        drift: { tokensUndescribed: [] },
        facts: { app: true, designSystem: true, stylesheets: 1 },
        steps: [
          {
            detail: "DESIGN.md changed 3 values the code doesn’t have.",
            kind: "design-md",
            state: "attention",
            title: "Take DESIGN.md’s tokens into the design system",
          },
        ],
        summary: "",
      },
    });
    panelWith([]);
    act(() => button("Review")[0]?.click());
    expect(useDesignSystemSetup.getState().shown).toBe(true);
    expect(showLeftPanel).toHaveBeenCalledWith("designSystem");
  });

  it("says there are none once the last one is fixed with the panel open", () => {
    panelWith([MISSING_PRIMARY]);
    act(() => useDesignSystem.setState({ document: documentWith([]) }));
    expect(container.textContent).toContain("No problems");
    expect(button("Fix with agent")).toEqual([]);
  });
});
