import { describe, expect, it } from "vitest";
import { publicUrlOf } from "./public-url.ts";

const publicUrl = publicUrlOf({
  base: "/preview/",
  entries: ["media/", "favicon.svg"],
});

describe("a root path to one of the application's public files", () => {
  it("is found under the preview's base", () => {
    expect(publicUrl("/media/images/openday.webp")).toBe(
      "/preview/media/images/openday.webp"
    );
    expect(publicUrl("/favicon.svg?v=2")).toBe("/preview/favicon.svg?v=2");
  });

  it("leaves routes, other sites and relative paths alone", () => {
    expect(publicUrl("/media")).toBe("/media");
    expect(publicUrl("/news/scuola")).toBe("/news/scuola");
    expect(publicUrl("/favicon.svg/x")).toBe("/favicon.svg/x");
    expect(publicUrl("//cdn.example.com/media/a.webp")).toBe(
      "//cdn.example.com/media/a.webp"
    );
    expect(publicUrl("/preview/media/a.webp")).toBe("/preview/media/a.webp");
    expect(publicUrl("media/a.webp")).toBe("media/a.webp");
    expect(publicUrlOf(undefined)("/media/a.webp")).toBe("/media/a.webp");
  });
});
