// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  DesignDocument,
  DesignFinding,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPrompt } from "../lib/start-thread.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useDocuments } from "../state/documents.ts";
import { showLeftPanel } from "../state/panels.ts";
import { setIgnored, usePersonalIgnores } from "../state/problems.ts";
import { useProject } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import { fakeApi } from "../testing/fake-api.ts";
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
const CONTRAST: DesignFinding = {
  message:
    "textColor (#9a9a9a) on backgroundColor (#ffffff) has contrast ratio 2.80:1, below WCAG AA minimum of 4.5:1.",
  path: "components.button-secondary",
  severity: "warning",
};
/** The ids of the two warnings, as Problems names them. */
const problemIds = () => [
  `DESIGN.md:colors:${MISSING_PRIMARY.message}`,
  `DESIGN.md:components.button-secondary:${CONTRAST.message}`,
];
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
const initialProject = useProject.getState();
const initialIgnores = usePersonalIgnores.getState();

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
  fakeApi.reset();
  useProject.setState({ settings: defaultSettings("/repo") });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useDesignSystem.setState(initialDesignSystem, true);
  useSync.setState(initialSync, true);
  useDesignSystemSetup.setState(initialSetup, true);
  useProject.setState(initialProject, true);
  usePersonalIgnores.setState(initialIgnores, true);
  container.remove();
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

describe("Problems › a problem's menu (ADR 0106)", () => {
  /** Opens the first row's menu and picks `item`. */
  const pick = async (item: string) => {
    const more = container.querySelector<HTMLButtonElement>(
      "li button[aria-label='More']"
    );
    await act(async () => {
      more?.click();
      await Promise.resolve();
    });
    const entry = [...document.querySelectorAll("[role='menuitem']")].find(
      (row) => row.textContent === item
    ) as HTMLElement | undefined;
    await act(async () => {
      entry?.click();
      await Promise.resolve();
    });
  };

  const rows = () =>
    [...container.querySelectorAll("li")].map((li) =>
      li.getAttribute("aria-label")
    );

  it("shows a problem in its file, at the line of its place", async () => {
    fakeApi.respond("files.open", () => undefined);
    panelWith([MISSING_PRIMARY]);
    await pick("Show in file");
    expect(fakeApi.calls.find((c) => c.method === "files.open")?.input).toEqual(
      { at: "colors", path: "DESIGN.md" }
    );
  });

  it("leaves a warning as it is for the person, kept by project", async () => {
    panelWith([MISSING_PRIMARY, BROKEN]);
    await pick("Ignore for me");
    expect(rows()).toEqual(["card points to a missing token"]);
    expect(usePersonalIgnores.getState().byProject["/repo"]).toHaveLength(1);
    // Under this project's own name in the profile: another project's are left as they are.
    expect(
      fakeApi.calls.find((c) => c.method === "profile.set")?.input
    ).toEqual({
      preferences: {
        "ignoredProblems:/repo": [
          `DESIGN.md:colors:${MISSING_PRIMARY.message}`,
        ],
      },
    });
  });

  it("keeps both of two warnings left for the project in a row", async () => {
    let saved: readonly string[] = [];
    fakeApi.respond("settings.set", (input) => {
      saved = input.ignoredProblems ?? [];
      return { ok: true, problems: [] };
    });
    fakeApi.respond("project.info", () => ({
      ...initialProject.info,
      configured: true,
      settings: { ...defaultSettings("/repo"), ignoredProblems: saved },
    }));
    panelWith([MISSING_PRIMARY, CONTRAST]);
    const present = new Set(problemIds());
    await act(() =>
      Promise.all([
        setIgnored(problemIds()[0] ?? "", "project", true, present),
        setIgnored(problemIds()[1] ?? "", "project", true, present),
      ])
    );
    expect(saved).toEqual(problemIds());
  });

  it("leaves a warning as it is for the project, in its settings", async () => {
    fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
    fakeApi.respond("project.info", () => ({
      ...initialProject.info,
      configured: true,
    }));
    panelWith([MISSING_PRIMARY]);
    await pick("Ignore for the project");
    const saved = fakeApi.calls.find((c) => c.method === "settings.set")
      ?.input as { ignoredProblems?: readonly string[] } | undefined;
    expect(saved?.ignoredProblems).toEqual([
      `DESIGN.md:colors:${MISSING_PRIMARY.message}`,
    ]);
  });

  it("leaves another project, opened while an ignore waits, as it is", async () => {
    let answer: () => void = () => undefined;
    fakeApi.respond(
      "settings.set",
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ ok: true, problems: [] });
        })
    );
    // The project the server has open by then: the other one.
    fakeApi.respond("project.info", () => ({
      ...initialProject.info,
      configured: true,
      settings: defaultSettings("/other"),
    }));
    panelWith([MISSING_PRIMARY, CONTRAST]);
    const present = new Set(problemIds());
    // A save under way, then an ignore queued behind it, then another project opens.
    const first = setIgnored(problemIds()[0] ?? "", "project", true, present);
    await fakeApi.requested("settings.set");
    const second = setIgnored(problemIds()[1] ?? "", "project", true, present);
    useProject.setState({ settings: defaultSettings("/other") });
    await act(async () => {
      await Promise.resolve();
      answer();
      await first;
      await second;
    });
    expect(
      fakeApi.calls.filter((c) => c.method === "settings.set")
    ).toHaveLength(1);
  });

  it("offers no ignoring for an error, only where it is", async () => {
    panelWith([BROKEN]);
    const more = container.querySelector<HTMLButtonElement>(
      "li button[aria-label='More']"
    );
    await act(async () => {
      more?.click();
      await Promise.resolve();
    });
    expect(
      [...document.querySelectorAll("[role='menuitem']")].map(
        (row) => row.textContent
      )
    ).toEqual(["Show in file"]);
  });
});

describe("an instance of a variant member its look takes out (ADR 0161)", () => {
  const initialComponents = useComponents.getState();
  const initialDocuments = useDocuments.getState();
  afterEach(() => {
    useComponents.setState(initialComponents, true);
    useDocuments.setState(initialDocuments, true);
  });

  const badge = (id: string, variant: string): DesignNode =>
    ({
      component: "Badge",
      from: "@ultrapaint/system",
      id,
      props: { variant },
      text: id,
      type: "instance",
    }) as DesignNode;

  const withOutlineTakenOut = () => {
    useComponents.setState({
      components: [
        {
          base: {},
          members: { variant: { remove: ["outline"] } },
          name: "Badge",
          origin: "system",
          states: {},
          variants: {},
          version: 1,
        },
      ],
    });
    useDocuments.setState({
      docs: {
        "home.page.json": {
          doc: "home.page.json",
          hash: "h",
          root: {
            children: [
              badge("new", "outline"),
              badge("beta", "outline"),
              badge("live", "default"),
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    useProject.setState({
      info: { configured: true, storage: { mode: "managed" } },
      pages: [
        {
          canvas: "main",
          file: "designs/home.page.json",
          id: "home.page.json",
          name: "Home",
          path: "home.page.json",
          route: "/",
        },
      ],
    });
    panelWith([]);
  };

  it("lists them, still drawn, with where they are", () => {
    withOutlineTakenOut();
    const group = container.querySelector('section[aria-label="Components"]');
    expect(group?.querySelector("li")?.getAttribute("aria-label")).toBe(
      "2 Badge instances still use outline, taken out of its variant"
    );
    expect(group?.textContent).toContain("They draw as before, on Home.");
  });

  it("moves them to a member the look offers, in one undo step", async () => {
    withOutlineTakenOut();
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    act(() => button("Move to…")[0]?.click());
    await act(async () => {
      await Promise.resolve();
    });
    const options = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(options.map((o) => o.textContent)).toEqual([
      "default",
      "secondary",
      "destructive",
    ]);
    act(() => options.find((o) => o.textContent === "secondary")?.click());
    await act(() => fakeApi.requested("documents.apply"));
    expect(
      fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input
    ).toEqual({
      edits: [
        {
          doc: "home.page.json",
          ops: [
            { id: "new", op: "setProps", props: { variant: "secondary" } },
            { id: "beta", op: "setProps", props: { variant: "secondary" } },
          ],
        },
      ],
      label: "Move Badge's outline to secondary",
    });
  });
});
