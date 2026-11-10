// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import {
  type DesignSystem,
  type DesignSystemState,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignSystem } from "../state/design-system.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { DesignSystemList } from "./design-system-list.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const own: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [{ name: "Semantic", tokens: [{ name: "ink", value: "#111111" }] }],
};

// The server's own words (`design-system-files.ts`, `dtcg.ts`), as it sends them.
const NOT_JSON =
  "design-system.json is not valid: not JSON: SyntaxError: Expected double-quoted property name in JSON at position 18 (line 3 column 1)";
const NOT_A_DESIGN_SYSTEM =
  'design-system.json is not valid: Missing key\n  at ["colors"]';
const TOKENS_NOT_JSON =
  "design.tokens.json is not JSON: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2): the values are design-system.json's and the code's until it reads";
const NOTE =
  "design.tokens.json: `shadow.card`: its value could not be read as CSS, so it is left out.";

const initialProject = useProject.getState();
const initialDesignSystem = useDesignSystem.getState();

let mounted: Root;
let container: HTMLElement;

/** The panel over what the server reads of the design system's files. */
const listOf = async (state: DesignSystemState) => {
  fakeApi.respond("designSystem.get", () => state);
  act(() => mounted.render(<DesignSystemList />));
  await act(() => until(useDesignSystem, (s) => s.loaded));
};

/** What says a file does not read, as it is read. */
const problem = () => container.querySelector('[role="alert"]')?.textContent;
const defaultLook = () =>
  container.querySelector('[aria-label="Default look"]');
/** The foundations and guidelines listed, by name: a row's name leads it, before its count. */
const rows = () =>
  [...container.querySelectorAll("button")]
    .map((b) => b.firstElementChild?.textContent ?? "")
    .filter((name) => name !== "");

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    info: { ...initialProject.info, configured: true, name: "shop" },
    settings: defaultSettings("/repo"),
  });
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useProject.setState(initialProject, true);
  useDesignSystem.setState(initialDesignSystem, true);
});

describe("Foundations › a file of the design system that does not read", () => {
  it("says what is wrong in design-system.json and where to fix it, in the foundations' place", async () => {
    await listOf({
      designSystem: null,
      document: null,
      problem: NOT_A_DESIGN_SYSTEM,
    });
    expect(problem()).toBe(
      "Not a valid design system." +
        "colors is missing: add it." +
        "Fix it in docs/designs/design-system.json: designs use Ultrapaint’s default look until then."
    );
    // Not the state of a project with no design system, whose foundations are the default look's.
    expect(defaultLook()).toBeNull();
    expect(rows()).toEqual([]);
  });

  it("says where a file that is not JSON stops being it, without the parser's name", async () => {
    await listOf({ designSystem: null, document: null, problem: NOT_JSON });
    expect(problem()).toContain(
      "not JSON: Expected double-quoted property name in JSON at position 18 (line 3 column 1)"
    );
    expect(problem()).not.toContain("SyntaxError");
    expect(problem()).not.toContain("is not valid");
  });

  it("lists the foundations again once the file reads", async () => {
    await listOf({ designSystem: null, document: null, problem: NOT_JSON });
    // The server tells the editor of the file saved; a read stands for it here.
    fakeApi.respond("designSystem.get", () => ({
      designSystem: own,
      document: null,
    }));
    await act(() => useDesignSystem.getState().load());
    expect(problem()).toBeUndefined();
    expect(rows()).toContain("Colour");
  });

  it("says design.tokens.json does not read over the foundations, which stay listed", async () => {
    await listOf({
      designSystem: own,
      document: null,
      problem: TOKENS_NOT_JSON,
    });
    expect(problem()).toBe(
      "Not a valid tokens file." +
        "not JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)" +
        "Fix it in docs/designs/design.tokens.json: the values are design-system.json’s and the code’s until then."
    );
    expect(rows()).toContain("Colour");
  });

  it("keeps a reason it does not know as the server wrote it", async () => {
    await listOf({
      designSystem: null,
      document: null,
      problem: "the designs directory cannot be read",
    });
    expect(problem()).toContain("the designs directory cannot be read");
  });
});

describe("Foundations › files that read", () => {
  it("shows the default look and the ways to make its own with no design system", async () => {
    await listOf({ designSystem: null, document: null });
    expect(problem()).toBeUndefined();
    expect(defaultLook()?.textContent).toContain("Ultrapaint’s default look");
    expect(rows()).toContain("Colour");
  });

  it("lists the design system's own foundations, and nothing else, when it has one", async () => {
    await listOf({ designSystem: own, document: null });
    expect(problem()).toBeUndefined();
    expect(defaultLook()).toBeNull();
    expect(rows()).toContain("Colour");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("says what the tokens file holds that was left out, under the list", async () => {
    await listOf({ designSystem: own, document: null, notes: [NOTE] });
    expect(problem()).toBeUndefined();
    expect(
      [...container.querySelectorAll("ul li")].map((li) => li.textContent)
    ).toEqual([
      "design.tokens.json: shadow.card: its value could not be read as CSS, so it is left out.",
    ]);
    expect(container.querySelector("ul li code")?.textContent).toBe(
      "shadow.card"
    );
  });
});
