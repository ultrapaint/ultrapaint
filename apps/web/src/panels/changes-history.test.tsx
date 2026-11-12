// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { HistoryPoint } from "@ultrapaint/contracts/snapshots";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistory } from "../state/history.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { Changes } from "./changes.tsx";
import { rowsByDay } from "./changes-history.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 10, 12, 15, 0);
const at = (hours: number, minutes = 0) =>
  new Date(2026, 10, 12, hours, minutes).getTime();

const point = (
  id: string,
  kind: HistoryPoint["kind"],
  time: number,
  more: Partial<HistoryPoint> = {}
): HistoryPoint => ({
  at: time,
  canvases: [],
  files: ["designs/home.page.json"],
  id,
  kind,
  ...more,
});

let mounted: Root;
let container: HTMLElement;
const before = useProject.getState().info;

beforeEach(() => {
  fakeApi.reset();
  useHistory.setState({ failed: false, pending: null, points: null });
  // A folder that is no repository: the panel is its history, with no tabs.
  useProject.setState({
    error: null,
    info: { ...before, configured: true, repoPath: "/repo" },
  });
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useProject.setState({ error: null, info: before });
});

describe("Changes › the history", () => {
  it("shows no git without a repository, and says when the history didn't load", async () => {
    fakeApi.respond("history.get", () =>
      Promise.reject(new Error("no history"))
    );
    act(() => mounted.render(<Changes />));
    await act(() => until(useHistory, (s) => s.failed));
    expect(container.textContent).not.toContain("Git");
    expect(container.textContent).toContain("The history didn’t loadTry again");

    // Try again reads it: Now takes the place of what said it failed.
    fakeApi.respond("history.get", () => ({
      pending: { edits: 2, since: at(14, 30) },
      points: [point("hp_1", "start", at(9))],
    }));
    act(() =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Try again")
        ?.click()
    );
    await act(() => until(useHistory, (s) => s.points !== null));
    expect(container.textContent).toContain("Now2 edits since");
    expect(container.textContent).toContain("History begins");
  });

  it("lists a turn by what was asked, and files from outside with nothing to do on them", async () => {
    fakeApi.respond("history.get", () => ({
      pending: null,
      points: [
        point("hp_3", "turn", at(14), {
          agentId: "claude-code",
          label: "Make four variants",
          model: "Opus 5.5",
        }),
        point("hp_2", "outside", at(12)),
        point("hp_1", "start", at(9)),
      ],
    }));
    act(() => mounted.render(<Changes />));
    await act(() => until(useHistory, (s) => s.points !== null));
    const rows = [...container.querySelectorAll("li")];
    expect(rows[0]?.textContent).toContain("Make four variants");
    expect(rows[0]?.textContent).toContain("Opus 5.5");
    expect(rows[1]?.textContent).toContain("1 file changed on disk");
    expect(rows[1]?.querySelector("button")).toBeNull();
  });
});

describe("the history's rows", () => {
  it("folds the person's points one after another, and keeps a version apart", () => {
    const days = rowsByDay(
      [
        point("e3", "edits", at(14, 50)),
        point("e2", "edits", at(14, 40)),
        point("v1", "edits", at(14, 30), { name: "Kept" }),
        point("e1", "edits", at(14, 20)),
        point("t1", "turn", at(13)),
      ],
      NOW
    );
    expect(days.map((d) => d.day)).toEqual(["Today"]);
    expect(
      days[0]?.rows.map((r) =>
        r.kind === "point" ? r.point.id : r.points.map((p) => p.id).join("+")
      )
    ).toEqual(["e3+e2", "v1", "e1", "t1"]);
  });
});
