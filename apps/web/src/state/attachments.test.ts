import "../testing/fake-browser.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addChip,
  type Chip,
  clearChips,
  useAttachments,
} from "./attachments.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page = (pageId: string): Chip => ({
  file: `designs/${pageId}.page.json`,
  kind: "page",
  name: pageId,
  pageId,
});

beforeEach(() => {
  useAttachments.setState({ byThread: {} });
});

describe("clearChips", () => {
  it("keeps a chip attached while the prompt was being sent", () => {
    addChip("t1", page("home"));
    const sent = useAttachments.getState().byThread.t1 ?? [];
    addChip("t1", page("pricing"));
    clearChips("t1", sent);
    expect(useAttachments.getState().byThread.t1).toEqual([page("pricing")]);
  });

  it("forgets the thread once every chip has gone", () => {
    addChip("t1", page("home"));
    clearChips("t1", [page("home")]);
    expect(useAttachments.getState().byThread).toEqual({});
  });
});
