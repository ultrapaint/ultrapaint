// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { startPreview } from "./index.ts";

describe("the preview's messages", () => {
  it("answers only the editor that frames it, at the editor's origin", () => {
    const posted: [unknown, string][] = [];
    const editor = {
      postMessage: (message: unknown, origin: string) => {
        posted.push([message, origin]);
      },
    };
    vi.spyOn(window, "parent", "get").mockReturnValue(
      editor as unknown as Window
    );
    document.head.innerHTML =
      "<style>:root { --color-brand: #ff0000; }</style>";
    startPreview();
    // Before the editor has said anything, the parent is told the preview is ready.
    expect(
      posted.map(([m, origin]) => [(m as { type: string }).type, origin])
    ).toEqual([["ed:ready", "*"]]);
    posted.length = 0;

    const ask = (source: unknown, origin: string) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { requestId: 7, type: "ed:getTokens" },
          origin,
          source: source as Window,
        })
      );
    ask(window, "http://elsewhere.test");
    ask({ postMessage: () => undefined }, "http://elsewhere.test");
    expect(posted).toEqual([]);

    ask(editor, "http://editor.test");
    expect(posted).toEqual([
      [
        {
          frame: "",
          requestId: 7,
          tokens: { "--color-brand": "#ff0000" },
          type: "ed:tokens",
        },
        "http://editor.test",
      ],
    ]);
  });
});
