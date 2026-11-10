// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { confirmDialog, promptDialog } from "./dialogs.tsx";

describe("a dialog asked for while another is open", () => {
  it("takes its place, the one open answered as dismissed", async () => {
    const first = confirmDialog({ title: "Put the files back?" });
    const second = promptDialog({ title: "Name the canvas" });
    // Whoever waited for the first goes on, as if it had been cancelled.
    expect(await first).toBe(false);
    const third = confirmDialog({ title: "Delete the page?" });
    expect(await second).toBeNull();
    const fourth = confirmDialog({ title: "Delete the canvas?" });
    expect(await third).toBe(false);
    // The last one asked for is the one open: nothing answered it.
    const open = Symbol("open");
    expect(await Promise.race([fourth, Promise.resolve(open)])).toBe(open);
  });
});
