// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { TEXT_ATTACHMENT_LIMIT } from "@ultrapaint/contracts/threads";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachFiles,
  attachmentsOf,
  useAttachments,
} from "../state/attachments.ts";
import {
  admit,
  dragsFiles,
  fitWithin,
  MAX_PICTURES,
  MAX_TEXT_BYTES,
  pastedImages,
  pastedName,
  readFiles,
  sizeLabel,
} from "./attach-files.ts";
import { imageChip, textChip } from "./file-chips.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const PNG_DATA = /^data:image\/png;base64,/;

const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

const text = (name: string, body: string, type = "") =>
  new File([body], name, { type });

/** A clipboard or a drag holding `files`, as the event gives it. */
const transfer = (files: readonly File[], types: readonly string[] = []) =>
  ({ files: files as unknown as FileList, types }) as unknown as DataTransfer;

beforeEach(() => {
  useAttachments.setState({ byThread: {} });
});

describe("a paste", () => {
  it("carries the images among what was copied, and nothing for text alone", () => {
    const notes = text("notes.txt", "hi", "text/plain");
    expect(pastedImages(transfer([notes, png("shot.png")]))).toHaveLength(1);
    expect(pastedImages(transfer([]))).toEqual([]);
    expect(pastedImages(null)).toEqual([]);
  });

  it("names the clipboard's picture, and keeps a file's own name", () => {
    expect(pastedName(png("image.png"))).toBe("Pasted image");
    expect(pastedName(png("hero.png"))).toBe("hero.png");
  });
});

describe("a drag", () => {
  it("is taken when it carries files, and left alone when it carries a layer or text", () => {
    expect(dragsFiles(transfer([], ["Files"]))).toBe(true);
    expect(dragsFiles(transfer([], ["application/ultrapaint-layer"]))).toBe(
      false
    );
    expect(dragsFiles(transfer([], ["text/plain"]))).toBe(false);
    expect(dragsFiles(null)).toBe(false);
  });
});

describe("files read for a prompt", () => {
  it("make a picture an image chip and a text file a chip of its text, whatever its type says", async () => {
    const { chips, refused } = await readFiles(
      [png("hero.png"), text("brief.md", "# Brief"), text("data.csv", "a,b")],
      "files"
    );
    expect(refused).toEqual([]);
    expect(chips.map((c) => [c.kind, c.name])).toEqual([
      ["image", "hero.png"],
      ["text", "brief.md"],
      ["text", "data.csv"],
    ]);
    expect(chips[0]?.kind === "image" && chips[0].dataUrl).toMatch(PNG_DATA);
    expect(chips[1]).toMatchObject({ size: 7, text: "# Brief" });
  });

  it("refuse a binary file, and text in another encoding, saying what to do instead", async () => {
    const pdf = new File([new Uint8Array([37, 80, 68, 70, 0, 1, 2])], "a.pdf", {
      type: "application/pdf",
    });
    const latin1 = new File([new Uint8Array([0xe9, 0x74, 0xe9])], "old.txt");
    const { chips, refused } = await readFiles([pdf, latin1], "files");
    expect(chips).toEqual([]);
    expect(refused).toEqual([
      "a.pdf can’t be attached: an agent reads pictures and text files. Put it in the project’s folder and name it in the prompt.",
      "old.txt isn’t UTF-8 text. Save it as UTF-8 and attach it again.",
    ]);
  });

  it("refuse a text file over the limit, naming its size and the limit", async () => {
    const big = text("log.txt", "x".repeat(TEXT_ATTACHMENT_LIMIT + 1));
    const { chips, refused } = await readFiles([big], "files");
    expect(chips).toEqual([]);
    expect(refused).toEqual([
      "log.txt is 101 KB, over the 100 KB a text file can be. Put it in the project’s folder and name it in the prompt.",
    ]);
  });

  it("hold a text file of exactly the limit", async () => {
    const full = text("full.txt", "x".repeat(TEXT_ATTACHMENT_LIMIT));
    const { chips } = await readFiles([full], "files");
    expect(chips).toHaveLength(1);
  });

  it("send a Figma file to its import", async () => {
    const fig = new File([new Uint8Array([0, 1])], "Home.fig");
    const { refused } = await readFiles([fig], "files");
    expect(refused).toEqual([
      "Home.fig is a Figma file: bring it in with Import a .fig file… in the + menu.",
    ]);
  });

  it("are pictures alone on the look page", async () => {
    const { chips, refused } = await readFiles(
      [png("ref.png"), text("brief.md", "warm")],
      "pictures"
    );
    expect(chips.map((c) => c.name)).toEqual(["ref.png"]);
    expect(refused).toEqual([
      "brief.md isn’t a picture. Describe the look, name a site or add a picture.",
    ]);
  });
});

describe("a prompt's limits", () => {
  const pictures = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      imageChip(`${i}.png`, "data:image/png;base64,AAAA")
    );

  it("take pictures up to the limit, counting those already attached", () => {
    const { chips, refused } = admit(pictures(MAX_PICTURES - 1), pictures(3));
    expect(chips).toHaveLength(1);
    expect(refused).toEqual([
      `A prompt takes up to ${MAX_PICTURES} pictures, so 2 weren’t attached. Send these first, then attach the rest.`,
    ]);
  });

  it("take text files up to the text a prompt carries in all", () => {
    const half = textChip("a.txt", "x".repeat(MAX_TEXT_BYTES / 2));
    const again = textChip("b.txt", "x".repeat(MAX_TEXT_BYTES / 2));
    const over = textChip("c.txt", "x");
    const { chips, refused } = admit([half], [again, over]);
    expect(chips).toEqual([again]);
    expect(refused).toEqual([
      "A prompt takes up to 200 KB of text files, so one wasn’t attached. Put it in the project’s folder and name it in the prompt.",
    ]);
  });
});

describe("files attached to a chat", () => {
  it("go with its next prompt, in their order: the picture as itself, the file as its text", async () => {
    await attachFiles("t1", [png("image.png"), text("brief.md", "# Brief")]);
    const chips = useAttachments.getState().byThread.t1 ?? [];
    expect(chips.map((c) => c.name)).toEqual(["Pasted image", "brief.md"]);
    expect(attachmentsOf(chips)).toEqual([
      expect.objectContaining({ kind: "image", name: "Pasted image" }),
      { kind: "text", name: "brief.md", text: "# Brief" },
    ]);
  });
});

describe("sizeLabel", () => {
  it("reads as a person says a size", () => {
    expect(sizeLabel(840)).toBe("840 B");
    expect(sizeLabel(12_400)).toBe("13 KB");
    expect(sizeLabel(3_400_000)).toBe("3.4 MB");
    expect(sizeLabel(52_000_000)).toBe("52 MB");
  });
});

describe("fitWithin", () => {
  it("scales the longest side down to the limit, never up", () => {
    expect(fitWithin(4000, 1000, 2000)).toEqual({ height: 500, width: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ height: 600, width: 800 });
  });
});
