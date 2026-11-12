import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Browser } from "./browser.ts";
import { EvalsError } from "./errors.ts";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import {
  motionOf,
  type Page,
  pagesOf,
  spread,
  spreadTiles,
  studyRead,
} from "./study-read.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const none = () => Effect.fail(new EvalsError({ message: "not in this test" }));
/** A browser that cuts any picture into `tiles` tiles of one byte each. */
const cutting = (tiles: number) =>
  Layer.succeed(
    Browser,
    Browser.of({
      audit: none,
      capture: none,
      compare: none,
      crop: none,
      cut: (_png, _viewport, whole) =>
        Effect.succeed(
          [...new Array(whole ? tiles : 1).keys()].map(
            () => new Uint8Array([1])
          )
        ),
      hold: none,
      layout: none,
      locate: none,
      trim: none,
      zoom: none,
    })
  );

const sources = {
  "corpus/landing/index.json": [
    { key: "shop", status: "ok" },
    { key: "bare", status: "ok" },
    { key: "gone", status: "failed" },
  ],
  "corpus/landing/shop/desktop.jpg": "jpg",
  "corpus/landing/shop/mobile.jpg": "jpg",
  "corpus/landing/shop/motion.json": { animations: [] },
  "corpus/screenrove/README.md": "# packs",
  "corpus/screenrove/tool/catalog.json": {
    marketing: [{ image: "tool-home.jpg", width: 2880 }],
    product: [{ image: "tool-issues.jpg", width: 2560 }],
  },
  "corpus/untitled-ui/0042.jpg": "jpg",
  "corpus/untitled-ui/index.json": [
    { file: "corpus/untitled-ui/0042.jpg" },
    { file: "corpus/untitled-ui/0099.jpg" },
  ],
};

describe("study read", () => {
  it.effect(
    "finds a captured site's page, a pack's screens and pages, and the shots on disk, at their CSS widths",
    () =>
      Effect.gen(function* () {
        yield* writeData(sources);
        const pages = yield* pagesOf(["landing", "screenrove", "untitled-ui"]);
        const by = Object.fromEntries(pages.map((p) => [p.id, p]));
        assert.sameMembers(Object.keys(by), [
          "landing__shop",
          "screenrove__tool-home",
          "screenrove__tool-issues",
          "untitled-ui__0042",
        ]);
        assert.strictEqual(by.landing__shop?.kind, "public-page");
        assert.isDefined(by.landing__shop?.mobile);
        assert.isDefined(by.landing__shop?.motion);
        assert.strictEqual(by["screenrove__tool-issues"]?.kind, "app-screen");
        assert.strictEqual(by["screenrove__tool-issues"]?.width, 1280);
        assert.strictEqual(by["screenrove__tool-home"]?.kind, "public-page");
        assert.strictEqual(by["untitled-ui__0042"]?.kind, "app-screen");
      }).pipe(Effect.provide(TestData))
  );

  it("takes a sample in turn from each source", () => {
    const page = (source: string, n: number): Page => ({
      desktop: "",
      id: `${source}__${n}`,
      kind: "public-page",
      scale: "",
      source,
      width: 1440,
    });
    const pages = [
      page("a", 1),
      page("a", 2),
      page("a", 3),
      page("b", 1),
      page("c", 1),
      page("c", 2),
    ];
    assert.deepStrictEqual(
      spread(pages, 4).map((p) => p.id),
      ["a__1", "b__1", "c__1", "a__2"]
    );
    assert.strictEqual(spread(pages, undefined).length, 6);
  });

  it("keeps the first and last tiles of a long page and those evenly between, four at most", () => {
    assert.deepStrictEqual(spreadTiles(2), [0, 1]);
    assert.deepStrictEqual(spreadTiles(4), [0, 1, 2, 3]);
    assert.deepStrictEqual(spreadTiles(5), [0, 1, 3, 4]);
    assert.deepStrictEqual(spreadTiles(8), [0, 2, 5, 7]);
  });

  it("says what a capture recorded of the motion, the commonest first", () => {
    assert.strictEqual(
      motionOf({
        animations: [
          { kind: "CSSTransition", props: ["opacity"], when: "scroll" },
          { kind: "CSSTransition", props: ["opacity"], when: "scroll" },
          { kind: "CSSAnimation", props: ["transform"], when: "load" },
        ],
        page: {
          hover: [1, 2],
          libraries: { framerMotion: false, lenis: true },
        },
      }),
      "2× CSSTransition on scroll (opacity); 1× CSSAnimation on load (transform). Hover styles: 2. Scroll and motion libraries: lenis."
    );
  });

  it.effect(
    "reads each page once, with its tiles spread down the page and its phone screen, and keeps the questions' version",
    () =>
      Effect.gen(function* () {
        const asked: Asked[] = [];
        const reader = (question: Asked) => {
          asked.push(question);
          return { capture: "ok", moves: [] };
        };
        yield* Effect.gen(function* () {
          yield* writeData(sources);
          const options = {
            concurrency: 1,
            effort: "high",
            limit: undefined,
            model: "opus",
            sample: undefined,
            sources: ["landing"],
          };
          yield* studyRead(options);
          yield* studyRead(options);
          const note = JSON.parse(
            yield* readData("studies/opus-questions-5/notes/landing__shop.json")
          );
          assert.strictEqual(note.questions, 5);
          assert.strictEqual(note.capture, "ok");
          assert.deepStrictEqual(note.pictures, [
            "studies/opus-questions-5/pictures/landing__shop/page-1.jpg",
            "studies/opus-questions-5/pictures/landing__shop/page-2.jpg",
            "studies/opus-questions-5/pictures/landing__shop/page-3.jpg",
            "studies/opus-questions-5/pictures/landing__shop/page-4.jpg",
            "studies/opus-questions-5/pictures/landing__shop/mobile-1.jpg",
          ]);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(TestData, cutting(6), Models.layerTest(reader))
          )
        );
        assert.strictEqual(asked.length, 1);
        assert.include(asked[0]?.prompt ?? "", "the phone's first screen");
        assert.include(asked[0]?.prompt ?? "", "skipped on purpose");
      })
  );
});
