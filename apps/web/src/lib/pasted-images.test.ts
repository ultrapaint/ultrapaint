// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAttachments } from "../state/attachments.ts";
import {
  attachImages,
  fitWithin,
  pastedImages,
  pastedName,
} from "./pasted-images.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const PNG_DATA = /^data:image\/png;base64,/;

const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

/** A clipboard holding `files`, as a paste event gives it. */
const clipboard = (files: readonly File[]) =>
  ({ files: files as unknown as FileList }) as DataTransfer;

beforeEach(() => {
  useAttachments.setState({ byThread: {} });
});

describe("a paste", () => {
  it("carries the images among what was copied, and nothing for text alone", () => {
    const text = new File(["hi"], "notes.txt", { type: "text/plain" });
    expect(pastedImages(clipboard([text, png("shot.png")]))).toHaveLength(1);
    expect(pastedImages(clipboard([]))).toEqual([]);
    expect(pastedImages(null)).toEqual([]);
  });

  it("names the clipboard's picture, and keeps a file's own name", () => {
    expect(pastedName(png("image.png"))).toBe("Pasted image");
    expect(pastedName(png("hero.png"))).toBe("hero.png");
  });

  it("attaches each image to the thread's next prompt, in the order pasted", async () => {
    await attachImages("t1", [png("a.png"), png("image.png")]);
    const chips = useAttachments.getState().byThread.t1 ?? [];
    expect(chips.map((c) => c.name)).toEqual(["a.png", "Pasted image"]);
    expect(chips[0]).toMatchObject({ kind: "image" });
    expect(chips[0]?.kind === "image" && chips[0].dataUrl).toMatch(PNG_DATA);
  });
});

describe("fitWithin", () => {
  it("scales the longest side down to the limit, never up", () => {
    expect(fitWithin(4000, 1000, 2000)).toEqual({ height: 500, width: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ height: 600, width: 800 });
  });
});
