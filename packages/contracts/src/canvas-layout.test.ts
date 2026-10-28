import { describe, expect, it } from "vitest";
import {
  boxesOf,
  canvasFrames,
  drawnFrame,
  FRAME_GAP,
  familyOf,
  frameBottom,
  frameRight,
  placeFrame,
  placeFrameAt,
  placeView,
  sizeFrame,
  viewIdFor,
  viewsAt,
} from "./canvas-layout.ts";
import type { FrameLayout, FrameView } from "./pages.ts";

const frame = (
  x: number,
  y: number,
  width = 1440,
  height = 900,
  views?: FrameView[]
): FrameLayout => ({
  height,
  preset: "custom",
  ...(views && { views }),
  width,
  x,
  y,
});

const view = (
  id: string,
  x: number,
  y: number,
  width = 390,
  height = 844
): FrameView => ({ height, id, width, x, y });

const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

describe("a frame's extent", () => {
  it.each([
    ["alone", frame(100, 50), 1540, 950],
    [
      "with a view beside it",
      frame(0, 0, 1440, 900, [view("w390", 1520, 0)]),
      1910,
      900,
    ],
    [
      "with a tall view under it",
      frame(0, 0, 1440, 900, [view("w390", 0, 980, 390, 2000)]),
      1440,
      2980,
    ],
  ])("%s", (_, f, right, bottom) => {
    expect(frameRight(f)).toBe(right);
    expect(frameBottom(f)).toBe(bottom);
  });

  it("gives a view's box on the canvas, counted from its frame", () => {
    expect(
      boxesOf(frame(100, 200, 1440, 900, [view("w390", 1520, 0)]))
    ).toEqual([
      { height: 900, width: 1440, x: 100, y: 200 },
      { height: 844, width: 390, x: 1620, y: 200 },
    ]);
  });
});

describe("placeFrame", () => {
  const size = { height: 600, preset: "custom", width: 400 } as const;

  it.each([
    ["an empty canvas", {}, 0],
    ["one frame", { a: frame(0, 0) }, 1440 + FRAME_GAP],
    [
      "a frame with views beside it",
      { a: frame(0, 0, 1440, 900, [view("w390", 1520, 0)]) },
      1520 + 390 + FRAME_GAP,
    ],
    [
      "the rightmost frame further down, behind a frame with views",
      {
        a: frame(0, 0, 1440, 900, [
          view("w390", 1520, 0),
          view("w800", 1990, 0, 800),
        ]),
        b: frame(2000, 2000, 390),
      },
      1990 + 800 + FRAME_GAP,
    ],
  ])("on %s, past every frame and view", (_, frames, x) => {
    expect(placeFrame(frames, size)).toEqual({ ...size, x, y: 0 });
  });

  it("never lands a new frame on a page or any of its views", () => {
    const frames: Record<string, FrameLayout> = {
      a: frame(0, 0, 1440, 900, [
        view("w390", 1520, 0),
        view("w768", 0, 980, 768, 1024),
      ]),
      b: frame(-3000, 400, 800, 600, [view("w2400", 900, -400, 2400, 900)]),
      c: frame(500, 3000, 390, 844, [view("w1920", 470, 0, 1920, 1080)]),
    };
    for (const width of [200, 1440, 8000]) {
      const placed = placeFrame(frames, {
        height: 5000,
        preset: "custom",
        width,
      });
      for (const f of Object.values(frames)) {
        for (const box of boxesOf(f)) {
          expect(overlap(placed, box)).toBe(false);
        }
      }
    }
  });
});

describe("placeFrameAt", () => {
  const home = frame(0, 0, 1440, 900, [view("w390", 1520, 0)]);
  // Where a copy of Home goes beside it: a gap past its view.
  const beside = 1520 + 390 + FRAME_GAP;

  it.each([
    ["nothing", { home }, beside],
    [
      "a page further down",
      { home, low: frame(beside, 900 + FRAME_GAP) },
      beside,
    ],
    [
      "a page there",
      { home, pricing: frame(beside, 0) },
      beside + 1440 + FRAME_GAP,
    ],
    [
      "a page closer than the gap",
      { home, pricing: frame(beside + 1440 + FRAME_GAP - 1, 0, 400) },
      beside + 1440 + FRAME_GAP - 1 + 400 + FRAME_GAP,
    ],
    [
      "another page's view",
      {
        home,
        low: frame(0, 2000, 1440, 900, [view("w390", beside, -1500)]),
      },
      beside + 390 + FRAME_GAP,
    ],
    [
      "a page where the frame's own view would be",
      { home, phone: frame(beside + 1520, 0, 390, 844) },
      beside + 1520 + 390 + FRAME_GAP,
    ],
  ])("beside a page, with %s there", (_, frames, x) => {
    expect(placeFrameAt(frames, { ...home, x: beside })).toEqual({
      ...home,
      x,
      y: 0,
    });
  });

  it("keeps the spot asked for when nothing is in its way", () => {
    const spot = { ...frame(0, 900 + FRAME_GAP), preset: "desktop" as const };
    expect(placeFrameAt({ home }, spot)).toBe(spot);
  });
});

describe("canvasFrames", () => {
  it("keeps saved frames and puts the others in a row past them, in the pages' order", () => {
    const saved = {
      "pricing.page.json": frame(1000, 50, 400, 500, [view("w390", 480, 0)]),
    };
    const frames = canvasFrames(
      ["home.page.json", "pricing.page.json", "draft.page.json"],
      saved
    );
    expect(Object.keys(frames)).toEqual([
      "pricing.page.json",
      "home.page.json",
      "draft.page.json",
    ]);
    expect(frames["pricing.page.json"]).toBe(saved["pricing.page.json"]);
    // Past the saved frame's view, then one past the other.
    const first = 1000 + 480 + 390 + FRAME_GAP;
    expect(frames["home.page.json"]).toEqual({
      height: 900,
      preset: "desktop",
      width: 1440,
      x: first,
      y: 0,
    });
    expect(frames["draft.page.json"]).toMatchObject({
      x: first + 1440 + FRAME_GAP,
    });
  });

  it("leaves out frames the layout keeps for pages that are gone", () => {
    expect(
      canvasFrames(["home.page.json"], { "gone.page.json": frame(0, 0) })
    ).toEqual({
      "home.page.json": {
        height: 900,
        preset: "desktop",
        width: 1440,
        x: 0,
        y: 0,
      },
    });
  });

  it("gives the frame one page is drawn in", () => {
    const saved = { "home.page.json": frame(0, 0) };
    const paths = ["home.page.json", "a.page.json", "b.page.json"];
    expect(drawnFrame(paths, saved, "home.page.json")).toBe(
      saved["home.page.json"]
    );
    expect(drawnFrame(paths, saved, "b.page.json").x).toBe(
      2 * (1440 + FRAME_GAP)
    );
    // A page the list does not have yet goes after the others.
    expect(drawnFrame(paths, saved, "new.page.json").x).toBe(
      3 * (1440 + FRAME_GAP)
    );
  });
});

describe("sizeFrame", () => {
  const mobile: FrameLayout = {
    height: 844,
    preset: "mobile",
    views: [view("w1440", 470, 0, 1440, 900)],
    width: 390,
    x: 10,
    y: 20,
  };

  it.each([
    [
      "a preset",
      { preset: "desktop" },
      { height: 900, preset: "desktop", width: 1440 },
    ],
    [
      "pixels, over the frame's own",
      { height: 2400 },
      { height: 2400, preset: "custom", width: 390 },
    ],
    [
      "pixels over a preset",
      { preset: "tablet", width: 800 },
      { height: 1194, preset: "custom", width: 800 },
    ],
    [
      "nothing but views",
      { views: [] },
      { height: 844, preset: "mobile", width: 390 },
    ],
  ] as const)("to %s, where it is", (_, size, expected) => {
    expect(sizeFrame(mobile, size)).toMatchObject({
      ...expected,
      x: 10,
      y: 20,
    });
  });

  it("keeps its views unless widths are given, and drops them for none", () => {
    expect(sizeFrame(mobile, { height: 1000 }).views).toEqual(mobile.views);
    expect(sizeFrame(mobile, { views: [] })).not.toHaveProperty("views");
    expect(sizeFrame(mobile, { views: [1440.4, 800] }).views).toEqual([
      { height: 900, id: "w1440", width: 1440, x: 390 + FRAME_GAP, y: 0 },
      {
        height: 844,
        id: "w800",
        width: 800,
        x: 390 + FRAME_GAP + 1440 + FRAME_GAP,
        y: 0,
      },
    ]);
  });
});

describe("naming views", () => {
  it.each([
    [390, [], "w390"],
    [390.4, [], "w390"],
    [390, [{ id: "w390" }], "w390-2"],
    [390, [{ id: "w390" }, { id: "w390-2" }], "w390-3"],
    [768, [{ id: "w390" }], "w768"],
  ])("%s beside %j is %s", (width, taken, id) => {
    expect(viewIdFor(width, taken)).toBe(id);
  });

  it("keeps the id and height of a view it had at a width, once", () => {
    const before = [view("phone", 1520, 0, 390, 700)];
    expect(
      viewsAt([390, 390], before, { height: 900, width: 1440 }).map((v) => [
        v.id,
        v.height,
      ])
    ).toEqual([
      ["phone", 700],
      ["w390", 900],
    ]);
  });
});

describe("placeView", () => {
  const size = { height: 844, width: 390 };

  it("goes right of the frame and its views when nothing is there", () => {
    const frames = {
      home: frame(0, 0, 1440, 900, [view("w768", 1520, 0, 768, 1024)]),
    };
    expect(placeView(frames, "home", size)).toEqual({
      x: 1520 + 768 + FRAME_GAP,
      y: 0,
    });
  });

  it("goes below the page when another page is to its right", () => {
    const frames = { home: frame(0, 0), pricing: frame(1520, 0) };
    expect(placeView(frames, "home", size)).toEqual({
      x: 0,
      y: 900 + FRAME_GAP,
    });
  });

  it("goes further down past another page's view in the way", () => {
    const frames = {
      home: frame(100, 100),
      pricing: frame(1620, 100, 1440, 900, [
        view("w390", -1520, 900, 390, 500),
      ]),
    };
    // Pricing's view sits under Home, from 1000 to 1500 on the canvas.
    expect(placeView(frames, "home", size)).toEqual({
      x: 0,
      y: 1500 + FRAME_GAP - 100,
    });
  });
});

describe("familyOf", () => {
  const page = (canvas: string, path: string) => ({ canvas, path });
  const pages = [
    page("", "pricing.page.json"),
    page("", "pricing@bold.page.json"),
    page("", "pricing@open.page.json"),
    page("", "pricing-2.page.json"),
    page("", "settings/pricing.page.json"),
    page("other", "pricing.page.json"),
  ];

  it.each([
    ["a base page", "pricing.page.json"],
    ["a variant", "pricing@bold.page.json"],
    ["a state", "pricing@open.page.json"],
  ])(
    "of %s is its base with its variants and states, in its canvas",
    (_, path) => {
      expect(familyOf(pages, page("", path)).map((p) => p.path)).toEqual([
        "pricing.page.json",
        "pricing@bold.page.json",
        "pricing@open.page.json",
      ]);
    }
  );

  it("of a page in a folder is that folder's", () => {
    expect(familyOf(pages, page("", "settings/pricing.page.json"))).toEqual([
      page("", "settings/pricing.page.json"),
    ]);
  });
});
