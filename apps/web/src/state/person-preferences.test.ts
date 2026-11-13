// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { UserProfile } from "@ultrapaint/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { followPersonPreferences } from "./person-preferences.ts";
import { DEFAULT_PREFERENCES, usePreferences } from "./preferences.ts";
import { useSendKey } from "./send-key.ts";
import { followServer } from "./server-data.ts";
import { useTheme } from "./theme.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const saves = () =>
  fakeApi.calls
    .filter((c) => c.method === "profile.set")
    .map(
      (c) => (c.input as { preferences: Record<string, unknown> }).preferences
    );

describe("the person's preferences in their profile (ADR 0093)", () => {
  let stop: () => void = () => undefined;
  let stopServer: () => void = () => undefined;
  /** As the editor starts: following the preferences, then the server, its connection open. */
  const start = () => {
    stop = followPersonPreferences();
    stopServer = followServer({ report: () => undefined });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fakeApi.reset();
    fakeApi.respond("profile.set", (input) => input);
    usePreferences.getState().setAll(DEFAULT_PREFERENCES);
    useTheme.getState().set("system");
    useSendKey.getState().setSendKey("enter");
  });

  afterEach(() => {
    stopServer();
    stop();
    vi.useRealTimers();
  });

  it("takes what the profile holds as the editor starts, in a page that kept nothing", async () => {
    fakeApi.respond("profile.get", () => ({
      preferences: {
        appearance: { accent: "teal", textSize: "large" },
        sendKey: "modEnter",
        theme: "dark",
      },
    }));
    start();
    await vi.waitFor(() => expect(useTheme.getState().preference).toBe("dark"));
    expect(usePreferences.getState().accent).toBe("teal");
    expect(usePreferences.getState().textSize).toBe("large");
    expect(useSendKey.getState().sendKey).toBe("modEnter");
    // Taking them in is no change to save back.
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves()).toEqual([]);
  });

  it("keeps a change made before the profile answered, and saves each change a moment later", async () => {
    let answer: (profile: UserProfile) => void = () => undefined;
    fakeApi.respond(
      "profile.get",
      () =>
        new Promise<UserProfile>((resolve) => {
          answer = resolve;
        })
    );
    start();
    useTheme.getState().set("light");
    answer({ preferences: { theme: "dark" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(useTheme.getState().preference).toBe("light");
    expect(saves()).toEqual([{ theme: "light" }]);
    usePreferences.getState().set("accent", "orange");
    usePreferences.getState().set("contrast", true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves().at(-1)).toMatchObject({
      appearance: { accent: "orange", contrast: true },
      theme: "light",
    });
    expect(saves()).toHaveLength(2);
  });

  it("drops what it can't read", async () => {
    fakeApi.respond("profile.get", () => ({
      preferences: { appearance: { accent: "plaid" }, theme: 3 },
    }));
    start();
    await vi.advanceTimersByTimeAsync(10);
    expect(useTheme.getState().preference).toBe("system");
    expect(usePreferences.getState().accent).toBe("ultramarine");
  });
});
