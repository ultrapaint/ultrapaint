import "../testing/fake-browser.ts";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { exportTokens, statusLabel, tokensWaiting } from "./implementation.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const item = (over: Partial<ImplementationItem> = {}): ImplementationItem => ({
  changedFiles: [],
  codeChanged: false,
  designChanged: false,
  files: ["src/home.tsx"],
  kind: "page",
  name: "Home",
  ready: false,
  status: "implemented",
  target: "home.page.json",
  ...over,
});

describe("where a design stands with its code", () => {
  beforeEach(() => fakeApi.reset());

  it("says tokens wait for the code only once the design is implemented (ADR 0028)", () => {
    expect(statusLabel(item())).toBe("Implemented");
    expect(statusLabel(item({ tokens: ["color-brand"] }))).toBe(
      "Implemented · tokens wait for the code"
    );
    expect(
      statusLabel(
        item({ designChanged: true, status: "changed", tokens: ["x"] })
      )
    ).toBe("Design changed · tokens wait for the code");
    // A draft is not drawn by the code yet: its tokens say nothing of it.
    expect(
      tokensWaiting(item({ files: [], status: "draft", tokens: ["x"] }))
    ).toBe(false);
  });

  it("exports the tokens named, and only that way", async () => {
    fakeApi.respond("sync.apply", () => ({
      files: ["src/app.css"],
      written: 1,
    }));
    await exportTokens(["color-brand"]);
    expect(fakeApi.calls).toEqual([
      {
        input: {
          decisions: [],
          only: "export",
          source: "code",
          tokens: ["color-brand"],
        },
        method: "sync.apply",
      },
    ]);
  });
});
