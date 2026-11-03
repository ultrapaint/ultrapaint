/**
 * A headless Chrome for the evals: it takes the reference's pictures and text, cuts long
 * pictures into tiles a model can read, and holds the editor open so `get_screenshot` has one to
 * ask. One browser for a whole command, closed with its scope; what it runs inside its pages is
 * `in-page.ts`.
 */
import { existsSync } from "node:fs";
import { Context, Effect, Layer, type Scope } from "effect";
import {
  type BrowserContextOptions,
  chromium,
  devices,
  type Page,
} from "playwright-core";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  type Box,
  compareInBrowser,
  cropInBrowser,
  cutInBrowser,
  locateInBrowser,
  outlineInBrowser,
  padInBrowser,
  scrollThroughInBrowser,
  type TileOptions,
  trimInBrowser,
  zoomInBrowser,
} from "./in-page.ts";
import type { Viewport } from "./reference.ts";

const BROWSERS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * A tile's height in CSS pixels. A model reads a picture at about 1,568 pixels on its long side,
 * so a 1440 × 1600 tile keeps text legible where a whole landing page would be a smear.
 */
export const TILE_HEIGHT = 1600;
/** Past this many tiles a page is cut: the judge has seen enough of it. */
const MAX_TILES = 8;
const OUTLINE_LIMIT = 40_000;

export interface Capture {
  /** What the window shows before scrolling, as a JPEG. */
  readonly fold: Uint8Array;
  /** The page's text and controls in reading order; desktop only. */
  readonly outline?: string;
  /** The whole page, top to bottom, in JPEG tiles. */
  readonly tiles: readonly Uint8Array[];
}

const failed = (what: string) => (cause: unknown) =>
  new EvalsError({
    message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const bytesOf = (data: string) => new Uint8Array(Buffer.from(data, "base64"));

export class Browser extends Context.Service<
  Browser,
  {
    /** A site at a viewport: what is seen first, the whole page in tiles, and its text. */
    readonly capture: (
      url: string,
      viewport: Viewport,
      options: { readonly hide: readonly string[]; readonly waitMs: number }
    ) => Effect.Effect<Capture, EvalsError>;
    /**
     * How a picture of a page compares with the one taken in a shorter frame: whether its
     * content ended, and whether it stayed put rather than stretching with the frame.
     */
    readonly compare: (
      png: Uint8Array,
      previous: Uint8Array | null,
      width: number
    ) => Effect.Effect<
      { readonly blankBottom: boolean; readonly sameTop: boolean },
      EvalsError
    >;
    /**
     * Where a part of a page is in the pictures of the whole page: which picture, the box in it,
     * and how far off the best match is (mean grey difference, 0 to 255); none when it is not.
     */
    readonly locate: (
      part: Uint8Array,
      pictures: readonly Uint8Array[]
    ) => Effect.Effect<
      {
        readonly box: Box;
        readonly index: number;
        readonly score: number;
      } | null,
      EvalsError
    >;
    /** A picture with a margin of its own background around it, as a PNG. */
    readonly pad: (
      png: Uint8Array,
      margin: number
    ) => Effect.Effect<Uint8Array, EvalsError>;
    /** A picture cut to what it shows, with a margin, as a PNG. */
    readonly trim: (
      png: Uint8Array,
      margin: number
    ) => Effect.Effect<Uint8Array, EvalsError>;
    /** A part of a picture, as a JPEG. */
    readonly crop: (
      bytes: Uint8Array,
      mime: string,
      box: Box
    ) => Effect.Effect<Uint8Array, EvalsError>;
    /** A picture as the fold and the tiles of a capture, the empty end of a tall frame cut. */
    readonly cut: (
      png: Uint8Array,
      viewport: Viewport,
      whole: boolean
    ) => Effect.Effect<readonly Uint8Array[], EvalsError>;
    /** Keeps a page open at the URL until the scope closes: the editor, for get_screenshot. */
    readonly hold: (
      url: string
    ) => Effect.Effect<void, EvalsError, Scope.Scope>;
    /** A picture whole, as a JPEG at most 1,600 wide, and its parts enlarged to read. */
    readonly zoom: (
      bytes: Uint8Array,
      mime: string
    ) => Effect.Effect<
      {
        readonly parts: readonly Uint8Array[];
        readonly size: { readonly height: number; readonly width: number };
        readonly whole: Uint8Array;
      },
      EvalsError
    >;
  }
>()("ultrapaint/evals/Browser") {
  static readonly layer = Layer.effect(
    Browser,
    Effect.gen(function* () {
      const config = yield* EvalsConfig;
      const executablePath =
        config.browser ?? BROWSERS.find((p) => existsSync(p));
      if (!executablePath) {
        return yield* new EvalsError({
          message: "no Chrome found: set LAB_BROWSER to a Chrome or Chromium",
        });
      }
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          catch: failed("Chrome did not start"),
          try: () =>
            chromium.launch({
              args: ["--disable-gpu", "--hide-scrollbars"],
              executablePath,
              headless: true,
            }),
        }),
        (b) => Effect.promise(() => b.close())
      );

      /** A page of its own for the length of one effect. */
      const withPage = <A>(
        options: BrowserContextOptions,
        use: (page: Page) => Promise<A>,
        what: string
      ) =>
        Effect.acquireUseRelease(
          Effect.tryPromise({
            catch: failed(what),
            try: () => browser.newContext(options),
          }),
          (context) =>
            Effect.tryPromise({
              catch: failed(what),
              try: async () => use(await context.newPage()),
            }),
          (context) => Effect.promise(() => context.close())
        );

      const cutPicture = (png: Uint8Array, options: TileOptions) =>
        withPage(
          {},
          async (page) =>
            (
              await page.evaluate(cutInBrowser, {
                data: base64(png),
                options,
              })
            ).map(bytesOf),
          "cutting a picture into tiles"
        );

      const compare = (
        png: Uint8Array,
        previous: Uint8Array | null,
        width: number
      ) =>
        withPage(
          {},
          (page) =>
            page.evaluate(compareInBrowser, {
              data: base64(png),
              previous: previous === null ? null : base64(previous),
              width,
            }),
          "comparing pictures"
        );

      const cut = (png: Uint8Array, viewport: Viewport, whole: boolean) =>
        cutPicture(png, {
          maxTiles: whole ? MAX_TILES : 1,
          tileHeight: whole ? TILE_HEIGHT : viewport.height,
          trim: whole,
          width: viewport.width,
        });

      const capture = Effect.fn("Browser.capture")(function* (
        url: string,
        viewport: Viewport,
        options: { readonly hide: readonly string[]; readonly waitMs: number }
      ) {
        const phone = viewport.width < 600;
        const shots = yield* withPage(
          {
            deviceScaleFactor: 1,
            reducedMotion: "reduce",
            viewport: { height: viewport.height, width: viewport.width },
            ...(phone && {
              hasTouch: true,
              isMobile: true,
              userAgent: devices["iPhone 13"]?.userAgent,
            }),
          },
          async (page) => {
            await page
              .goto(url, { timeout: 45_000, waitUntil: "networkidle" })
              .catch(() => page.waitForLoadState("load"));
            await page.waitForTimeout(options.waitMs);
            if (options.hide.length > 0) {
              await page.addStyleTag({
                content: `${options.hide.join(", ")} { display: none !important; }`,
              });
            }
            const fold = await page.screenshot({ type: "png" });
            await page.evaluate(scrollThroughInBrowser);
            const full = await page.screenshot({ fullPage: true, type: "png" });
            const outline = phone
              ? undefined
              : await page.evaluate(outlineInBrowser, OUTLINE_LIMIT);
            return { fold, full, outline };
          },
          `capturing ${url} at ${viewport.width}px`
        );
        const [fold] = yield* cut(shots.fold, viewport, false);
        const tiles = yield* cut(shots.full, viewport, true);
        return {
          fold: fold ?? new Uint8Array(),
          tiles,
          ...(shots.outline !== undefined && { outline: shots.outline }),
        } satisfies Capture;
      });

      const hold = (url: string) =>
        Effect.gen(function* () {
          const context = yield* Effect.acquireRelease(
            Effect.tryPromise({
              catch: failed("opening the editor"),
              try: () =>
                browser.newContext({ viewport: { height: 900, width: 1440 } }),
            }),
            (c) => Effect.promise(() => c.close())
          );
          yield* Effect.tryPromise({
            catch: failed(`opening ${url}`),
            try: async () => {
              const page = await context.newPage();
              // What the editor says: why a picture could not be drawn.
              if (config.editorLog) {
                page.on("console", (m) => {
                  if (m.type() === "error" || m.type() === "warning") {
                    process.stderr.write(`[editor ${m.type()}] ${m.text()}\n`);
                  }
                });
                page.on("pageerror", (e) =>
                  process.stderr.write(`[editor pageerror] ${e.message}\n`)
                );
              }
              await page.goto(url, { waitUntil: "load" });
            },
          });
        });

      const zoom = (bytes: Uint8Array, mime: string) =>
        withPage(
          {},
          async (page) => {
            const zoomed = await page.evaluate(zoomInBrowser, {
              data: base64(bytes),
              mime,
            });
            return {
              parts: zoomed.parts.map(bytesOf),
              size: zoomed.size,
              whole: bytesOf(zoomed.whole),
            };
          },
          "reading a picture"
        );

      const crop = (bytes: Uint8Array, mime: string, box: Box) =>
        withPage(
          {},
          async (page) =>
            bytesOf(
              await page.evaluate(cropInBrowser, {
                box,
                data: base64(bytes),
                mime,
                pad: 0.015,
              })
            ),
          "cutting a part of a picture"
        );

      const locate = (part: Uint8Array, pictures: readonly Uint8Array[]) =>
        withPage(
          {},
          (page) =>
            page.evaluate(locateInBrowser, {
              part: base64(part),
              pictures: pictures.map(base64),
            }),
          "finding a part in a page"
        );

      const pad = (png: Uint8Array, margin: number) =>
        withPage(
          {},
          async (page) =>
            bytesOf(
              await page.evaluate(padInBrowser, { data: base64(png), margin })
            ),
          "padding a picture"
        );

      const trim = (png: Uint8Array, margin: number) =>
        withPage(
          {},
          async (page) =>
            bytesOf(
              await page.evaluate(trimInBrowser, { data: base64(png), margin })
            ),
          "trimming a picture"
        );

      return Browser.of({
        capture,
        compare,
        crop,
        cut,
        hold,
        locate,
        pad,
        trim,
        zoom,
      });
    })
  );
}
