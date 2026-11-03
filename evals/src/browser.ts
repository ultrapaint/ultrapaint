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
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
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
  new EvalsError({
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

/**
 * Runs in the page: a picture (a shot from a gallery, often 3200 wide) as a whole a model can take
 * in, and its parts enlarged, about 1,600 of its pixels each with an overlap, where its small text
 * can be read.
 */
const zoomInBrowser = async (input: {
  readonly data: string;
  readonly mime: string;
}) => {
  const image = new Image();
  image.src = `data:${input.mime};base64,${input.data}`;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const jpeg = (x: number, y: number, w: number, h: number, scale: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88).split(",")[1] ?? "";
  };
  const whole = jpeg(0, 0, width, height, Math.min(1, 1600 / width));
  const columns = Math.max(1, Math.ceil(width / 1700));
  const rows = Math.max(1, Math.ceil(height / 1300));
  const parts: string[] = [];
  if (columns * rows > 1) {
    const overlap = 0.08;
    const w = Math.round((width / columns) * (1 + overlap));
    const h = Math.round((height / rows) * (1 + overlap));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = Math.min(width - w, Math.round((column * width) / columns));
        const y = Math.min(height - h, Math.round((row * height) / rows));
        parts.push(jpeg(Math.max(0, x), Math.max(0, y), w, h, 1));
      }
    }
  }
  return { parts, size: { height, width }, whole };
};

/** A rectangle of a picture, each side a fraction of its width or height. */
export interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** Runs in the page: a part of a picture, a little wider than asked so its edges are not lost. */
const cropInBrowser = async (input: {
  readonly box: Box;
  readonly data: string;
  readonly mime: string;
  readonly pad: number;
}) => {
  const image = new Image();
  image.src = `data:${input.mime};base64,${input.data}`;
  await image.decode();
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const { box, pad } = input;
  const x0 = Math.max(0, Math.floor((box.x - pad) * w));
  const y0 = Math.max(0, Math.floor((box.y - pad) * h));
  const x1 = Math.min(w, Math.ceil((box.x + box.width + pad) * w));
  const y1 = Math.min(h, Math.ceil((box.y + box.height + pad) * h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, x1 - x0);
  canvas.height = Math.max(1, y1 - y0);
  canvas
    .getContext("2d")
    ?.drawImage(
      image,
      x0,
      y0,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";
};

/**
 * Runs in the page: where a part of a page (a node's own picture) is in the pictures of the
 * whole page. The part is drawn sharper (twice the scale) or at the same, so both are tried; it
 * is found coarsely on pictures shrunk four times, then exactly around the best place.
 */
const locateInBrowser = async (input: {
  readonly part: string;
  readonly pictures: readonly string[];
}) => {
  const load = async (data: string) => {
    const image = new Image();
    image.src = `data:image/*;base64,${data}`;
    await image.decode();
    return image;
  };
  /** A picture as grey levels, drawn at a scale. */
  const grey = (image: HTMLImageElement, scale: number) => {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return { data: new Float32Array(0), height, width };
    }
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 1) {
      data[i] =
        0.3 * (rgba[i * 4] ?? 0) +
        0.59 * (rgba[i * 4 + 1] ?? 0) +
        0.11 * (rgba[i * 4 + 2] ?? 0);
    }
    return { data, height, width };
  };
  type Grey = ReturnType<typeof grey>;
  /**
   * The pixels a match is scored on: those with ink (far from the part's most common grey, its
   * background), so a mostly blank part ("Tags" on a white row) is not found on any blank row;
   * a little of the background too, so its shape still counts. At most `cap` of them.
   */
  const samplesOf = (picture: Grey, cap: number, inked: boolean) => {
    const counts = new Map<number, number>();
    for (const v of picture.data) {
      const key = Math.round(v / 8);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const background =
      ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0) * 8;
    const ink: [number, number, number][] = [];
    const plain: [number, number, number][] = [];
    for (let j = 0; j < picture.height; j += 1) {
      for (let i = 0; i < picture.width; i += 1) {
        const v = picture.data[j * picture.width + i] ?? 0;
        (Math.abs(v - background) > 30 ? ink : plain).push([i, j, v]);
      }
    }
    const thin = (list: [number, number, number][], n: number) =>
      list.length <= n
        ? list
        : list.filter((_, k) => k % Math.ceil(list.length / n) === 0);
    const chosen =
      !inked || ink.length < 8
        ? thin([...ink, ...plain], cap)
        : [
            ...thin(ink, Math.round(cap * 0.8)),
            ...thin(plain, Math.round(cap * 0.2)),
          ];
    // Shuffled (the same way every time): a running mean of the first ones is then a fair
    // guess of the whole, which is what stopping early relies on.
    return chosen
      .map((sample, k) => ({ key: (k * 7919) % 104_729, sample }))
      .sort((x, y) => x.key - y.key)
      .map((entry) => entry.sample);
  };
  /** The mean difference of the samples placed at x, y; stops once worse than `limit`. */
  const difference = (
    hay: Grey,
    samples: readonly [number, number, number][],
    x: number,
    y: number,
    limit: number
  ) => {
    let sum = 0;
    for (const [k, [i, j, v]] of samples.entries()) {
      sum += Math.abs((hay.data[(y + j) * hay.width + x + i] ?? 0) - v);
      if (k > 32 && k % 32 === 0 && sum / (k + 1) > limit) {
        return Number.POSITIVE_INFINITY;
      }
    }
    return sum / Math.max(1, samples.length);
  };
  const part = await load(input.part);
  const pictures = await Promise.all(input.pictures.map(load));
  const coarse = 4;
  /** The best places found coarsely, each far enough from the others to be another place. */
  interface Candidate {
    index: number;
    scale: number;
    score: number;
    x: number;
    y: number;
  }
  const candidates: Candidate[] = [];
  const keep = (c: Candidate) => {
    const near = candidates.findIndex(
      (o) =>
        o.index === c.index &&
        o.scale === c.scale &&
        Math.abs(o.x - c.x) < coarse * 3 &&
        Math.abs(o.y - c.y) < coarse * 3
    );
    if (near !== -1) {
      if ((candidates[near]?.score ?? 0) > c.score) {
        candidates[near] = c;
      }
      return;
    }
    candidates.push(c);
    candidates.sort((a, b) => a.score - b.score);
    candidates.length = Math.min(candidates.length, 15);
  };
  const worst = () =>
    candidates.length < 15
      ? Number.POSITIVE_INFINITY
      : (candidates.at(-1)?.score ?? Number.POSITIVE_INFINITY);
  /** Every place on one shrunk picture, the good ones kept. */
  const scan = (
    hay: Grey,
    small: Grey,
    samples: readonly [number, number, number][],
    index: number,
    scale: number
  ) => {
    for (let y = 0; y + small.height <= hay.height; y += 1) {
      for (let x = 0; x + small.width <= hay.width; x += 1) {
        const score = difference(hay, samples, x, y, worst());
        if (score < worst()) {
          keep({ index, scale, score, x: x * coarse, y: y * coarse });
        }
      }
    }
  };
  /** The exact place around a coarse one, by the whole picture. */
  const align = (
    hay: Grey,
    full: Grey,
    samples: readonly [number, number, number][],
    c: Candidate
  ) => {
    const reach = coarse * 2;
    let aligned = { score: Number.POSITIVE_INFINITY, x: c.x, y: c.y };
    const yEnd = Math.min(hay.height - full.height, c.y + reach);
    const xEnd = Math.min(hay.width - full.width, c.x + reach);
    for (let y = Math.max(0, c.y - reach); y <= yEnd; y += 1) {
      for (let x = Math.max(0, c.x - reach); x <= xEnd; x += 1) {
        const score = difference(hay, samples, x, y, aligned.score);
        if (score < aligned.score) {
          aligned = { score, x, y };
        }
      }
    }
    return aligned;
  };
  for (const scale of [0.5, 1]) {
    const small = grey(part, scale / coarse);
    const samples = samplesOf(small, 600, false);
    for (const [index, picture] of pictures.entries()) {
      const hay = grey(picture, 1 / coarse);
      if (small.width <= hay.width && small.height <= hay.height) {
        scan(hay, small, samples, index, scale);
      }
    }
  }
  // Each place aligned exactly by its whole picture, then judged by its ink.
  let found:
    | (Candidate & {
        readonly hayHeight: number;
        readonly hayWidth: number;
        readonly height: number;
        readonly width: number;
      })
    | null = null;
  for (const c of candidates) {
    const picture = pictures[c.index];
    if (!picture) {
      continue;
    }
    const hay = grey(picture, 1);
    const full = grey(part, c.scale);
    const aligned = align(hay, full, samplesOf(full, 3000, false), c);
    const ink = difference(
      hay,
      samplesOf(full, 3000, true),
      aligned.x,
      aligned.y,
      Number.POSITIVE_INFINITY
    );
    if (found === null || ink < found.score) {
      found = {
        ...c,
        hayHeight: hay.height,
        hayWidth: hay.width,
        height: full.height,
        score: ink,
        width: full.width,
        x: aligned.x,
        y: aligned.y,
      };
    }
  }
  if (found === null) {
    return null;
  }
  return {
    box: {
      height: found.height / found.hayHeight,
      width: found.width / found.hayWidth,
      x: found.x / found.hayWidth,
      y: found.y / found.hayHeight,
    },
    index: found.index,
    score: found.score,
  };
};

/**
 * Runs in the page: a picture cut to what it shows, with a margin: a component's row drawn across
 * a wide frame is mostly empty, and compared with a tight crop it would look tiny.
 */
const trimInBrowser = async (input: {
  readonly data: string;
  readonly margin: number;
}) => {
  const image = new Image();
  image.src = `data:image/png;base64,${input.data}`;
  await image.decode();
  const { naturalHeight: h, naturalWidth: w } = image;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return input.data;
  }
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, w, h).data;
  // The background is the top-left corner's colour.
  const [r0, g0, b0] = [pixels[0] ?? 255, pixels[1] ?? 255, pixels[2] ?? 255];
  let top = h;
  let left = w;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const differs =
        Math.abs((pixels[i] ?? 0) - r0) +
          Math.abs((pixels[i + 1] ?? 0) - g0) +
          Math.abs((pixels[i + 2] ?? 0) - b0) >
        24;
      if (differs) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (right < 0) {
    return input.data;
  }
  const m = input.margin;
  const x0 = Math.max(0, left - m);
  const y0 = Math.max(0, top - m);
  const cut = document.createElement("canvas");
  cut.width = Math.min(w, right + m + 1) - x0;
  cut.height = Math.min(h, bottom + m + 1) - y0;
  cut
    .getContext("2d")
    ?.drawImage(
      canvas,
      x0,
      y0,
      cut.width,
      cut.height,
      0,
      0,
      cut.width,
      cut.height
    );
  return cut.toDataURL("image/png").split(",")[1] ?? "";
};

/** Runs in the page: a picture with a margin of its own background (its corner's colour) around it. */
const padInBrowser = async (input: {
  readonly data: string;
  readonly margin: number;
}) => {
  const image = new Image();
  image.src = `data:image/png;base64,${input.data}`;
  await image.decode();
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const probeContext = probe.getContext("2d");
  probeContext?.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = probeContext?.getImageData(0, 0, 1, 1).data ?? [
    255, 255, 255,
  ];
  const m = input.margin;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth + m * 2;
  canvas.height = image.naturalHeight + m * 2;
  const context = canvas.getContext("2d");
  if (!context) {
    return input.data;
  }
  context.fillStyle = `rgb(${r} ${g} ${b})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, m, m);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
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
