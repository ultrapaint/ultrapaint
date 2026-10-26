// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the cases are code with template literals in it.
import { describe, expect, it } from "vitest";
import { type PublicDir, prefixPublicUrls } from "./public-urls.ts";

const files: PublicDir = {
  isDirectory: (relative) =>
    ["media/", "media/images/", "media/sezioni/"].includes(relative),
  isFile: (relative) =>
    ["favicon.svg", "media/images/openday.webp", "media/a b.png"].includes(
      relative
    ),
};

const prefix = (code: string) => prefixPublicUrls(code, "/preview/", files);

describe("the application's public files named from the root", () => {
  it("are found under the preview's base", () => {
    expect(prefix(`<img src="/media/images/openday.webp" />`)).toBe(
      `<img src="/preview/media/images/openday.webp" />`
    );
    expect(prefix(`icon: '/favicon.svg?v=2'`)).toBe(
      `icon: '/preview/favicon.svg?v=2'`
    );
    expect(prefix(`const a = "/media/a%20b.png"`)).toBe(
      `const a = "/preview/media/a%20b.png"`
    );
  });

  it("are found from a template literal inside a public directory", () => {
    expect(prefix("src={`/media/sezioni/${slug}.webp`}")).toBe(
      "src={`/preview/media/sezioni/${slug}.webp`}"
    );
    expect(prefix("`/media/images/hero-${n}.webp`")).toBe(
      "`/preview/media/images/hero-${n}.webp`"
    );
  });

  it("leave routes, other sites and what is already under the base alone", () => {
    expect(prefix(`navigate("/media")`)).toBeNull();
    expect(prefix(`href: "/news/scuola"`)).toBeNull();
    expect(prefix("`/news/${slug}`")).toBeNull();
    expect(prefix("`/${section}/a.webp`")).toBeNull();
    expect(prefix(`"//cdn.example.com/favicon.svg"`)).toBeNull();
    expect(prefix(`"/preview/favicon.svg"`)).toBeNull();
    expect(prefix(`"/media/images/missing.webp"`)).toBeNull();
    expect(prefix(`"/"`)).toBeNull();
  });
});
