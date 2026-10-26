/**
 * A headless Chrome for the evals: it takes the reference's pictures and text, cuts long
 * pictures into tiles a model can read, and holds the editor open so `get_screenshot` has one to
 * ask. One browser for a whole command, closed with its scope.
 */
import { existsSync } from "node:fs";
import { Context, Effect, Layer, type Scope } from "effect";
import {
  type BrowserContextOptions,
  chromium,
  devices,
  type Page,
} from "playwright-core";
import { LabError } from "./errors.ts";
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

interface TileOptions {
  readonly maxTiles: number;
  readonly tileHeight: number;
  /** Cut the run of identical rows a tall frame leaves under the content. */
  readonly trim: boolean;
  /** The picture's width in CSS pixels: a picture drawn at 2× comes out at 1×. */
  readonly width: number;
}

const failed = (what: string) => (cause: unknown) =>
  new LabError({
    message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/**
 * Runs in the page: decodes a picture, trims its empty end, and cuts it into JPEG tiles.
 * Plain DOM code, since Playwright sends its source to the browser.
 */
const cutInBrowser = async (input: {
  readonly data: string;
  readonly options: TileOptions;
}) => {
  const { data, options } = input;
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const { width } = options;
  const scale = width / image.naturalWidth;
  const fullHeight = Math.round(image.naturalHeight * scale);
  const whole = document.createElement("canvas");
  whole.width = width;
  whole.height = fullHeight;
  const context = whole.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }
  context.drawImage(image, 0, 0, width, fullHeight);
  let height = fullHeight;
  if (options.trim && fullHeight > 1) {
    const rowOf = (at: number) => context.getImageData(0, at, width, 1).data;
    const last = rowOf(fullHeight - 1);
    const same = (row: Uint8ClampedArray) => {
      for (let i = 0; i < row.length; i += 16) {
        if (Math.abs((row[i] ?? 0) - (last[i] ?? 0)) > 6) {
          return false;
        }
      }
      return true;
    };
    let y = fullHeight - 1;
    while (y > 0 && same(rowOf(y))) {
      y -= 1;
    }
    // A margin of the background under the content, as a window would show it.
    height = Math.min(fullHeight, y + 48);
  }
  const tiles: string[] = [];
  for (
    let top = 0;
    top < height && tiles.length < options.maxTiles;
    top += options.tileHeight
  ) {
    const tileHeight = Math.min(options.tileHeight, height - top);
    const tile = document.createElement("canvas");
    tile.width = width;
    tile.height = tileHeight;
    tile
      .getContext("2d")
      ?.drawImage(whole, 0, top, width, tileHeight, 0, 0, width, tileHeight);
    tiles.push(tile.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "");
  }
  return tiles;
};

/**
 * Runs in the page: its text, headings, landmarks and controls in reading order, so the brief
 * can copy the content exactly rather than reading it off a picture.
 */
const outlineInBrowser = (limit: number) => {
  const lines: string[] = [];
  let line = "";
  const flush = (prefix = "") => {
    const text = line.replace(/\s+/g, " ").trim();
    if (text) {
      lines.push(prefix + text);
    }
    line = "";
  };
  const LANDMARKS: Record<string, string> = {
    ASIDE: "aside",
    FOOTER: "footer",
    FORM: "form",
    HEADER: "header",
    MAIN: "main",
    NAV: "navigation",
  };
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === "contents") {
      return true;
    }
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const textOf = (el: Element) =>
    ((el as HTMLElement).innerText ?? el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
  /** A control or a picture, as one bracketed line part; null for anything else. */
  const leafOf = (node: Element, tag: string): string | null => {
    const label = node.getAttribute("aria-label");
    if (tag === "SVG") {
      return label ? ` [icon: ${label}] ` : "";
    }
    if (tag === "IMG") {
      return ` [image: ${(node as HTMLImageElement).alt || "undescribed"}] `;
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const field = node as HTMLInputElement;
      const name =
        label || field.placeholder || field.name || field.type || "field";
      return ` [field: ${name}${field.value ? ` = ${field.value}` : ""}] `;
    }
    const role = node.getAttribute("role");
    if (tag === "BUTTON" || role === "button" || role === "tab") {
      return ` [${role ?? "button"}: ${textOf(node) || label || "unlabelled"}] `;
    }
    return null;
  };
  const walkChildren = (node: Element) => {
    for (const child of node.childNodes) {
      walk(child);
    }
  };
  /** A heading, a landmark or a table: lines of their own. */
  const walkStructure = (node: Element, tag: string) => {
    if (tag === "TABLE") {
      flush();
      for (const row of [...node.querySelectorAll("tr")].slice(0, 25)) {
        lines.push(
          `| ${[...row.children].map((cell) => textOf(cell)).join(" | ")} |`
        );
      }
      return true;
    }
    const level = ["H1", "H2", "H3", "H4", "H5", "H6"].indexOf(tag) + 1;
    if (level > 0) {
      flush();
      walkChildren(node);
      flush(`${"#".repeat(level)} `);
      return true;
    }
    const landmark = LANDMARKS[tag];
    if (landmark) {
      flush();
      lines.push(`<${landmark}>`);
      walkChildren(node);
      flush();
      lines.push(`</${landmark}>`);
      return true;
    }
    return false;
  };
  /** Anything else: a short inline link as one part, a block as lines of its own. */
  const walkFlow = (node: Element, tag: string) => {
    const block = !getComputedStyle(node).display.startsWith("inline");
    if (tag === "A" && !block && textOf(node).length < 80) {
      line += ` [link: ${textOf(node) || node.getAttribute("aria-label") || "unlabelled"}] `;
      return;
    }
    if (block) {
      flush();
    }
    walkChildren(node);
    if (block) {
      flush(tag === "LI" ? "- " : "");
    }
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      line += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element && shown(node))) {
      return;
    }
    const tag = node.tagName.toUpperCase();
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(tag)) {
      return;
    }
    const leaf = leafOf(node, tag);
    if (leaf !== null) {
      line += leaf;
      return;
    }
    if (walkStructure(node, tag)) {
      return;
    }
    walkFlow(node, tag);
  };
  walk(document.body);
  flush();
  return lines.join("\n").slice(0, limit);
};

/** Scrolls to the end and back, so lazy pictures load and reveal-on-scroll sections show. */
const scrollThroughInBrowser = async () => {
  const step = window.innerHeight;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    // biome-ignore lint/performance/noAwaitInLoops: one screen at a time, for what loads on sight
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));
};

/**
 * Runs in the page: whether a picture ends on blank rows (the content ended above the frame's
 * bottom), and whether its top matches another picture's (the content stays put as the frame
 * grows, rather than stretching with it).
 */
const compareInBrowser = async (input: {
  readonly data: string;
  readonly previous: string | null;
  readonly width: number;
}) => {
  const draw = async (data: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const height = Math.round(
      (image.naturalHeight * input.width) / image.naturalWidth
    );
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(image, 0, 0, input.width, height);
    return { context, height };
  };
  const current = await draw(input.data);
  if (!current.context) {
    return { blankBottom: false, sameTop: false };
  }
  const rows = current.context.getImageData(
    0,
    Math.max(0, current.height - 64),
    input.width,
    Math.min(64, current.height)
  ).data;
  let blankBottom = true;
  for (let i = 0; i < rows.length; i += 16) {
    if (Math.abs((rows[i] ?? 0) - (rows[rows.length - 4 + (i % 4)] ?? 0)) > 6) {
      blankBottom = false;
      break;
    }
  }
  if (input.previous === null) {
    return { blankBottom, sameTop: true };
  }
  const previous = await draw(input.previous);
  const top = Math.floor(previous.height / 2);
  const a = previous.context?.getImageData(0, 0, input.width, top).data;
  const b = current.context.getImageData(0, 0, input.width, top).data;
  let differing = 0;
  let sampled = 0;
  for (let i = 0; a && i < a.length; i += 32) {
    sampled += 1;
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 12) {
      differing += 1;
    }
  }
  return { blankBottom, sameTop: sampled > 0 && differing / sampled < 0.01 };
};

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
    ) => Effect.Effect<Capture, LabError>;
    /** A picture as the fold and the tiles of a capture, the empty end of a tall frame cut. */
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
      LabError
    >;
    readonly cut: (
      png: Uint8Array,
      viewport: Viewport,
      whole: boolean
    ) => Effect.Effect<readonly Uint8Array[], LabError>;
    /** Keeps a page open at the URL until the scope closes: the editor, for get_screenshot. */
    readonly hold: (url: string) => Effect.Effect<void, LabError, Scope.Scope>;
  }
>()("ultrapaint/lab/Browser") {
  static readonly layer = Layer.effect(
    Browser,
    Effect.gen(function* () {
      const executablePath =
        process.env.LAB_BROWSER ?? BROWSERS.find((p) => existsSync(p));
      if (!executablePath) {
        return yield* new LabError({
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
              await page.goto(url, { waitUntil: "load" });
            },
          });
        });

      return Browser.of({ capture, compare, cut, hold });
    })
  );
}
