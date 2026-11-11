/**
 * A headless Chrome for the evals: it takes the reference's pictures and text, cuts long
 * pictures into tiles a model can read, and holds the editor open so `get_screenshot` has one to
 * ask. One browser for a whole command, closed with its scope; what it runs inside its pages is
 * `in-page.ts`.
 */
import { existsSync } from "node:fs";
import {
  type Audited,
  type AuditOptions,
  auditInBrowser,
  HOVER_MARK,
  type LaidBlock,
  type LaidRule,
  layoutInBrowser,
  markHoverableInBrowser,
  rowPointsInBrowser,
} from "@ultrapaint/design-checks/in-page";
import { Context, Effect, Layer, type Scope } from "effect";
import {
  type BrowserContextOptions,
  chromium,
  devices,
  type Page,
} from "playwright-core";
import { AXE_SOURCE } from "./axe.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  type AxeNode,
  axeInBrowser,
  type Box,
  compareInBrowser,
  cropInBrowser,
  cutInBrowser,
  locateInBrowser,
  outlineInBrowser,
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
      {
        readonly blankBottom: boolean;
        /** Whether its bottom is the shorter frame's bottom: content pinned to the frame's foot. */
        readonly sameBottom: boolean;
        readonly sameTop: boolean;
      },
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
    /**
     * The layout under a selector at the URL, after the steps run on the page (1600×1000): what
     * `measure` checks.
     */
    readonly layout: (
      url: string,
      options: {
        readonly root: string;
        /** Whether to take a picture of the root at 2×, in the same page the layout is read in. */
        readonly shot?: boolean;
        readonly steps: readonly ((page: Page) => Promise<unknown>)[];
        readonly theme: "dark" | "light";
      }
    ) => Effect.Effect<
      {
        readonly block: LaidBlock | null;
        /** The root's box in the window. */
        readonly root: Box;
        readonly rules: readonly LaidRule[];
        /** The root at 2×, a PNG, when asked for. */
        readonly shot?: Uint8Array;
      },
      EvalsError
    >;
    /**
     * The general design checks (`auditInBrowser`) under a selector at the URL, after the steps
     * run on the page (1600×1000): what `measure --checks` adds.
     */
    readonly audit: (
      url: string,
      options: AuditOptions & {
        /** Whether axe-core measures contrast and target sizes too, before anything is changed. */
        readonly axe?: boolean;
        /**
         * Whether the page is checked again with `:hover` forced on whatever the pointer acts on,
         * for what shows only then (fills, actions); only `hoverChecks` run then.
         */
        readonly hover: boolean;
        readonly hoverChecks: AuditOptions["only"];
        readonly steps: readonly ((page: Page) => Promise<unknown>)[];
        readonly theme: "dark" | "light";
      }
    ) => Effect.Effect<
      {
        readonly axe?: readonly AxeNode[];
        readonly hover?: Audited;
        readonly rest: Audited;
      },
      EvalsError
    >;
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

      const trim = (png: Uint8Array, margin: number) =>
        withPage(
          {},
          async (page) =>
            bytesOf(
              await page.evaluate(trimInBrowser, { data: base64(png), margin })
            ),
          "trimming a picture"
        );

      const layout = (
        url: string,
        options: {
          readonly root: string;
          readonly shot?: boolean;
          readonly steps: readonly ((page: Page) => Promise<unknown>)[];
          readonly theme: "dark" | "light";
        }
      ) =>
        withPage(
          {
            colorScheme: options.theme,
            // Twice the pixels for the picture; the layout is read in CSS pixels all the same.
            deviceScaleFactor: options.shot ? 2 : 1,
            viewport: { height: 1000, width: 1600 },
          },
          async (page) => {
            await page.goto(url, { waitUntil: "load" });
            // An app draws after load: its first screen settles in a few seconds.
            await page.waitForTimeout(4000);
            // One step after another, each given time to draw.
            await options.steps.reduce<Promise<unknown>>(
              (done, step) =>
                done
                  .then(() => step(page))
                  .then(() => page.waitForTimeout(800)),
              Promise.resolve()
            );
            const laid = await page.evaluate(layoutInBrowser, options.root);
            if (!options.shot) {
              return laid;
            }
            const { height, width, x, y } = laid.root;
            const shot = await page.screenshot({
              clip: { height, width, x, y },
              type: "png",
            });
            return { ...laid, shot: new Uint8Array(shot) };
          },
          `measuring ${url}`
        );

      const audit = (
        url: string,
        options: AuditOptions & {
          readonly axe?: boolean;
          readonly hover: boolean;
          readonly hoverChecks: AuditOptions["only"];
          readonly steps: readonly ((page: Page) => Promise<unknown>)[];
          readonly theme: "dark" | "light";
        }
      ) =>
        withPage(
          {
            colorScheme: options.theme,
            viewport: { height: 1000, width: 1600 },
          },
          async (page) => {
            await page.goto(url, { waitUntil: "load" });
            // An app draws after load: its first screen settles in a few seconds.
            await page.waitForTimeout(4000);
            await options.steps.reduce<Promise<unknown>>(
              (done, step) =>
                done
                  .then(() => step(page))
                  .then(() => page.waitForTimeout(800)),
              Promise.resolve()
            );
            const {
              axe: wantsAxe,
              hover,
              hoverChecks,
              steps: _,
              theme: __,
              ...checks
            } = options;
            // Before the stress pass lengthens the names: axe measures the page as it was drawn.
            const axe = wantsAxe
              ? await page
                  .addScriptTag({ path: AXE_SOURCE })
                  .then(() => page.evaluate(axeInBrowser, checks.root))
              : undefined;
            const rest = await page.evaluate(auditInBrowser, checks);
            if (!hover) {
              return { ...(axe && { axe }), rest };
            }
            // Chrome's own forced state: every element the pointer acts on drawn as hovered at once.
            await page.evaluate(markHoverableInBrowser, HOVER_MARK);
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("DOM.enable");
            await cdp.send("CSS.enable");
            const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
            const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
              nodeId: root.nodeId,
              selector: `[${HOVER_MARK}]`,
            });
            await Promise.all(
              nodeIds.map((nodeId) =>
                cdp.send("CSS.forcePseudoState", {
                  forcedPseudoClasses: ["hover"],
                  nodeId,
                })
              )
            );
            await page.waitForTimeout(400);
            const hoverOptions = {
              ...checks,
              only: hoverChecks,
              stress: false,
            };
            const found = [await page.evaluate(auditInBrowser, hoverOptions)];
            // An app's own hover state needs a real pointer: one row after another.
            for (const point of await page.evaluate(rowPointsInBrowser, 40)) {
              // biome-ignore lint/performance/noAwaitInLoops: one pointer, resting on one row at a time
              await page.mouse.move(point.x, point.y);
              await page.waitForTimeout(150);
              found.push(await page.evaluate(auditInBrowser, hoverOptions));
            }
            await page.mouse.move(1, 1);
            // One finding however many passes saw it, by the key `auditInBrowser` keeps one by.
            const byKey = new Map(
              found
                .flatMap((f) => f.findings)
                .map((f) => [`${f.check}|${f.label}|${f.detail}`, f] as const)
            );
            const hovered = {
              controlBoxes: Object.assign(
                {},
                ...found.map((f) => f.controlBoxes ?? {})
              ),
              controls: [...new Set(found.flatMap((f) => f.controls))],
              findings: [...byKey.values()],
            };
            return { ...(axe && { axe }), hover: hovered, rest };
          },
          `checking ${url}`
        );

      return Browser.of({
        audit,
        capture,
        compare,
        crop,
        cut,
        hold,
        layout,
        locate,
        trim,
        zoom,
      });
    })
  );

  /** No browser, for tests whose steps never draw: each call fails, saying so. */
  static readonly layerTest = Layer.succeed(
    Browser,
    Browser.of({
      audit: () => noBrowser,
      capture: () => noBrowser,
      compare: () => noBrowser,
      crop: () => noBrowser,
      cut: () => noBrowser,
      hold: () => noBrowser,
      layout: () => noBrowser,
      locate: () => noBrowser,
      trim: () => noBrowser,
      zoom: () => noBrowser,
    })
  );
}

const noBrowser = new EvalsError({ message: "no browser in this test" });
