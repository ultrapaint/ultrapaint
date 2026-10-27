import { describe, expect, it } from "vitest";
import { underPreview } from "./requests.ts";

const PAGE = "http://127.0.0.1:4601/?canvas=home";
const under = (url: string) => underPreview(url, "/preview/", PAGE);

describe("underPreview", () => {
  it("moves what names the editor's origin under the base", () => {
    expect(under("/api/products?page=2")).toBe(
      "http://127.0.0.1:4601/preview/api/products?page=2"
    );
    expect(under("http://127.0.0.1:4601/modifica/foto")).toBe(
      "http://127.0.0.1:4601/preview/modifica/foto"
    );
    expect(under("ws://127.0.0.1:4601/live")).toBe(
      "ws://127.0.0.1:4601/preview/live"
    );
  });

  it("leaves the preview's own, other sites, and what is not fetched from a host", () => {
    expect(under("/preview/src/data.json")).toBeNull();
    expect(under("/preview")).toBeNull();
    expect(under("https://api.example.com/products")).toBeNull();
    expect(under("data:text/plain,hi")).toBeNull();
    expect(under("blob:http://127.0.0.1:4601/5f2c")).toBeNull();
  });

  it("moves nothing before the preview starts", () => {
    expect(underPreview("/api", "", PAGE)).toBeNull();
  });
});
