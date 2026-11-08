/**
 * What runs inside Chrome's page: Playwright sends each function's source to the page and runs it
 * there, so each is plain DOM code that reaches nothing outside itself (no imports, no names of
 * this module), takes JSON and gives JSON back. Pictures cross as base64.
 */

export interface TileOptions {
  readonly maxTiles: number;
  readonly tileHeight: number;
  /** Cut the run of identical rows a tall frame leaves under the content. */
  readonly trim: boolean;
  /** The picture's width in CSS pixels: a picture drawn at 2× comes out at 1×. */
  readonly width: number;
}

/**
 * Runs in the page: decodes a picture, trims its empty end, and cuts it into JPEG tiles.
 * Plain DOM code, since Playwright sends its source to the browser.
 */
export const cutInBrowser = async (input: {
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
export const outlineInBrowser = (limit: number) => {
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
    (
      (el instanceof HTMLElement ? el.innerText : undefined) ??
      el.textContent ??
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  /** A form field, by its label or what it asks for, and its value; null for anything else. */
  const fieldOf = (node: Element, label: string | null): string | null => {
    if (
      !(
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement
      )
    ) {
      return null;
    }
    const placeholder =
      node instanceof HTMLSelectElement ? undefined : node.placeholder;
    const name = label || placeholder || node.name || node.type || "field";
    return ` [field: ${name}${node.value ? ` = ${node.value}` : ""}] `;
  };
  /** A control or a picture, as one bracketed line part; null for anything else. */
  const leafOf = (node: Element, tag: string): string | null => {
    const label = node.getAttribute("aria-label");
    if (tag === "SVG") {
      return label ? ` [icon: ${label}] ` : "";
    }
    if (node instanceof HTMLImageElement) {
      return ` [image: ${node.alt || "undescribed"}] `;
    }
    const field = fieldOf(node, label);
    if (field !== null) {
      return field;
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
export const scrollThroughInBrowser = async () => {
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
export const compareInBrowser = async (input: {
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
    return { blankBottom: false, sameBottom: false, sameTop: false };
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
    return { blankBottom, sameBottom: false, sameTop: true };
  }
  const previous = await draw(input.previous);
  /** Whether two bands of pixels are alike: under 1% of the sampled ones apart. */
  const alike = (
    a: Uint8ClampedArray | undefined,
    b: Uint8ClampedArray
  ): boolean => {
    let differing = 0;
    let sampled = 0;
    for (let i = 0; a && i < a.length; i += 32) {
      sampled += 1;
      if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 12) {
        differing += 1;
      }
    }
    return sampled > 0 && differing / sampled < 0.01;
  };
  const top = Math.floor(previous.height / 2);
  // The bottom of the frame as it was, found again at the bottom of the grown one: content pinned to
  // the frame's foot (a sidebar's account row) moved down with it, so the page ended above.
  const band = Math.min(160, Math.floor(previous.height / 4));
  return {
    blankBottom,
    sameBottom: alike(
      previous.context?.getImageData(
        0,
        previous.height - band,
        input.width,
        band
      ).data,
      current.context.getImageData(0, current.height - band, input.width, band)
        .data
    ),
    sameTop: alike(
      previous.context?.getImageData(0, 0, input.width, top).data,
      current.context.getImageData(0, 0, input.width, top).data
    ),
  };
};

/**
 * Runs in the page: a picture (a shot from a gallery, often 3200 wide) as a whole a model can take
 * in, and its parts enlarged, about 1,600 of its pixels each with an overlap, where its small text
 * can be read.
 */
export const zoomInBrowser = async (input: {
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
export const cropInBrowser = async (input: {
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
export const locateInBrowser = async (input: {
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
export const trimInBrowser = async (input: {
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
export const padInBrowser = async (input: {
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

/** A line of text, top to bottom, in CSS pixels of the window. */
export interface InkLine {
  readonly bottom: number;
  readonly top: number;
}

/**
 * An element as `measure` reads it: the lines of text it shows (its own and its children's,
 * merged where they share a line), its box, and the children that show text. A wrapper with one
 * such child and no text of its own is that child.
 */
export interface LaidBlock {
  readonly bottom: number;
  readonly children: readonly LaidBlock[];
  /** Its first words, to name it in a finding. */
  readonly label: string;
  readonly lines: readonly InkLine[];
  readonly top: number;
}

/** A thin vertical rule (a divider) and the vertical centre of what sits beside it in its bar. */
export interface LaidRule {
  readonly bar: string;
  readonly centre: number;
  readonly sideCentre: number;
}

/** The layout under `root`: its blocks of text, and its vertical rules beside their neighbours. */
export const layoutInBrowser = (root: string) => {
  const rootEl = document.querySelector(root) ?? document.body;
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  };
  /** Rects on one line (more than half the smaller one overlapping) are one line. */
  const merge = (rects: readonly InkLine[]) => {
    const lines: InkLine[] = [];
    for (const r of [...rects].sort((a, b) => a.top - b.top)) {
      const last = lines.at(-1);
      const overlap = last
        ? Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top)
        : 0;
      if (
        last &&
        overlap > Math.min(last.bottom - last.top, r.bottom - r.top) / 2
      ) {
        lines[lines.length - 1] = {
          bottom: Math.max(last.bottom, r.bottom),
          top: Math.min(last.top, r.top),
        };
      } else {
        lines.push({ bottom: r.bottom, top: r.top });
      }
    }
    return lines;
  };
  const textLines = (node: Node): InkLine[] => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ bottom: r.bottom, top: r.top }));
  };
  const walk = (el: Element): LaidBlock | null => {
    if (!shown(el)) {
      return null;
    }
    const nodes = [...el.childNodes];
    const own = nodes
      .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      .flatMap(textLines);
    const children = nodes.flatMap((n) => {
      const block = n instanceof Element ? walk(n) : null;
      return block ? [block] : [];
    });
    const lines = merge([...own, ...children.flatMap((c) => c.lines)]);
    if (lines.length === 0) {
      return null;
    }
    const [only] = children;
    if (children.length === 1 && own.length === 0 && only) {
      return only;
    }
    const box = el.getBoundingClientRect();
    return {
      bottom: box.bottom,
      children,
      label: ((el as HTMLElement).innerText ?? el.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40),
      lines,
      top: box.top,
    };
  };
  /** A thin vertical rule, with the median centre of what sits beside it in its bar. */
  const ruleOf = (el: Element): LaidRule | null => {
    const r = el.getBoundingClientRect();
    const bar = el.parentElement;
    if (!(bar && r.width > 0 && r.width <= 2 && r.height >= 6 && shown(el))) {
      return null;
    }
    const centres = [...bar.children]
      .filter((c) => c !== el && shown(c))
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 4 && b.height > 4)
      .map((b) => (b.top + b.bottom) / 2)
      .sort((a, b) => a - b);
    const middle = centres[Math.floor(centres.length / 2)];
    return middle === undefined
      ? null
      : {
          bar:
            bar.getAttribute("aria-label") ??
            (bar.textContent ?? "").trim().slice(0, 40),
          centre: (r.top + r.bottom) / 2,
          sideCentre: middle,
        };
  };
  const rules = [...rootEl.querySelectorAll("*")].flatMap((el) => {
    const rule = ruleOf(el);
    return rule ? [rule] : [];
  });
  return { block: walk(rootEl), rules };
};

/** What a design check of `auditInBrowser` found, and the measured value it fails on. */
export interface AuditFinding {
  readonly check:
    | "contrast"
    | "control-edge"
    | "control-fill"
    | "surface-tone"
    | "overlay-tone"
    | "off-scale"
    | "touching-rows"
    | "clipped-text"
    | "cant-truncate"
    | "hover-only"
    | "target-size";
  /** What it says, with the threshold. */
  readonly detail: string;
  /** The element's first words, or its tag and role: to find it. */
  readonly label: string;
  readonly value: number;
}

export interface AuditOptions {
  /**
   * Steps of the spacing scale, in CSS pixels: a computed padding, gap or margin not a multiple of
   * it is off the scale. 0 leaves spacing unchecked: on a rendered page the scale's half steps
   * look the same as values off it, so spacing is better checked in the document.
   */
  readonly grid: number;
  /**
   * Under this oklch lightness apart, nested surfaces are less than one tone step apart:
   * `elevation.md`'s step, about 0.045.
   */
  readonly nearTone: number;
  /** The checks to run, by name; all without it. */
  readonly only?: readonly AuditFinding["check"][] | undefined;
  readonly root: string;
  /** Whether the names in lists are lengthened to see if they truncate (it changes the page). */
  readonly stress: boolean;
}

/** What `auditInBrowser` gives back: its findings, and the controls a person can see. */
export interface Audited {
  /** The visible controls by their names: compared at rest and on hover, it finds hover-only ones. */
  readonly controls: readonly string[];
  readonly findings: readonly AuditFinding[];
}

/**
 * Runs in the page: the centres of the first rows of each list (three or more rows of one
 * height, stacked), at most `limit`, for a pointer to rest on one after another: what a page
 * shows only when a real pointer enters a row (an app's own hover state) shows then.
 */
export const rowPointsInBrowser = (limit: number) => {
  const shown = (el: Element) => {
    const b = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      b.width > 0 &&
      b.height > 0 &&
      b.top < innerHeight &&
      b.bottom > 0
    );
  };
  const points: { x: number; y: number }[] = [];
  for (const el of document.querySelectorAll("*")) {
    const children = [...el.children].filter(shown);
    const heights = children.map((c) =>
      Math.round(c.getBoundingClientRect().height)
    );
    const counts = new Map<number, number>();
    for (const h of heights) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const [common = 0, n = 0] =
      [...counts.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
    if (n < 3 || common < 16 || common > 64) {
      continue;
    }
    const rows = children.filter(
      (_, k) => Math.abs((heights[k] ?? 0) - common) <= 2
    );
    for (const row of rows.slice(0, 2)) {
      const b = row.getBoundingClientRect();
      if (points.length < limit) {
        points.push({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
      }
    }
  }
  return points;
};

/** What a hover pass forces `:hover` on: whatever a pointer acts on. */
export const HOVER_MARK = "data-audit-hover";

/**
 * Runs in the page: marks every element the pointer acts on (a control's role, or a pointer
 * cursor), for a hover pass to force `:hover` on; returns how many.
 */
export const markHoverableInBrowser = (mark: string) => {
  let n = 0;
  for (const el of document.querySelectorAll("*")) {
    if (
      el.matches(
        "button, a[href], [role=button], [role=option], [role=treeitem], [role=row], [role=menuitem], [role=tab], li"
      ) ||
      getComputedStyle(el).cursor === "pointer"
    ) {
      el.setAttribute(mark, "");
      n += 1;
    }
  }
  return n;
};

/**
 * The general design checks, on the rendered page under `root`, each with a threshold from the
 * skill or the design system: text contrast (4.5:1, large 3:1), a control's edge against what it
 * sits on (3:1), nested surfaces a tone step apart and a dialog not below the page it covers,
 * spacing on the scale, rounded or filled rows not touching, text not clipped, names that
 * truncate, targets at least 24px. Plain DOM code, since Playwright sends its source to the page.
 */
export const auditInBrowser = (options: AuditOptions): Audited => {
  const rootEl = document.querySelector(options.root) ?? document.body;
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  const add = (f: AuditFinding) => {
    const key = `${f.check}|${f.label}|${f.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  /** Any CSS colour as sRGB 0–1 and alpha, through the canvas, which knows every syntax. */
  const rgba = (css: string): [number, number, number, number] => {
    if (!ctx || css === "" || css === "transparent") {
      return [0, 0, 0, 0];
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255, a / 255];
  };
  const over = (
    top: [number, number, number, number],
    under: [number, number, number]
  ): [number, number, number] => [
    top[0] * top[3] + under[0] * (1 - top[3]),
    top[1] * top[3] + under[1] * (1 - top[3]),
    top[2] * top[3] + under[2] * (1 - top[3]),
  ];
  const linear = (c: number) =>
    c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance = (c: [number, number, number]) =>
    0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  /** Oklab lightness, the scale the skill's tone steps are given in. */
  const lightness = (c: [number, number, number]) => {
    const [r, g, b] = c.map(linear) as [number, number, number];
    const l = Math.cbrt(
      0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b
    );
    const m = Math.cbrt(
      0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b
    );
    const s = Math.cbrt(
      0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b
    );
    return 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
  };
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0 &&
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.right > 0 &&
      box.top < innerHeight &&
      box.left < innerWidth
    );
  };
  const labelOf = (el: Element) => {
    const text = (el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const name = el.getAttribute("aria-label") ?? el.getAttribute("title");
    const role = el.getAttribute("role");
    return (
      text || name || `${el.tagName.toLowerCase()}${role ? `[${role}]` : ""}`
    );
  };
  /** The colour behind an element: its ancestors' fills composited; none past a picture. */
  const backdrop = (
    el: Element | null
  ): [number, number, number] | undefined => {
    const layers: [number, number, number, number][] = [];
    for (let at = el; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.backgroundImage !== "none") {
        return;
      }
      const fill = rgba(style.backgroundColor);
      if (fill[3] > 0) {
        layers.push(fill);
        if (fill[3] >= 1) {
          break;
        }
      }
    }
    let colour: [number, number, number] = [1, 1, 1];
    for (const layer of layers.reverse()) {
      colour = over(layer, colour);
    }
    return colour;
  };
  const disabled = (el: Element) =>
    el.closest("[disabled], [aria-disabled='true'], [inert]") !== null;
  const opacityOf = (el: Element) => {
    let o = 1;
    for (let at: Element | null = el; at; at = at.parentElement) {
      o *= Number(getComputedStyle(at).opacity);
    }
    return o;
  };
  const px = (v: string) => Number.parseFloat(v) || 0;
  const all = [rootEl, ...rootEl.querySelectorAll("*")].filter(
    (el) => !el.closest("svg") && shown(el)
  );

  // Text contrast, placeholders included.
  const hasOwnText = (el: Element) =>
    [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== ""
    );
  /** An empty field showing its placeholder: the placeholder's contrast is checked. */
  const showsPlaceholder = (el: Element) =>
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.value === "" &&
    el.placeholder !== "";
  /** The contrast text needs: 3:1 when large (24px, or 18.66px bold), else 4.5:1. */
  const neededFor = (style: CSSStyleDeclaration) => {
    const size = px(style.fontSize);
    return size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      ? 3
      : 4.5;
  };
  const contrastOf = (el: Element) => {
    const field = showsPlaceholder(el);
    if (!(hasOwnText(el) || field) || disabled(el)) {
      return;
    }
    const bg = backdrop(el);
    if (!bg) {
      return;
    }
    const style = getComputedStyle(el, field ? "::placeholder" : null);
    const fg = rgba(style.color);
    const text = over([fg[0], fg[1], fg[2], fg[3] * opacityOf(el)], bg);
    const need = neededFor(style);
    const got = ratio(text, bg);
    if (got < need) {
      add({
        check: "contrast",
        detail: `${field ? "placeholder" : "text"} ${got.toFixed(2)}:1, under ${need}:1`,
        label: `${labelOf(el)}${field ? " (placeholder)" : ""}`,
        value: Number(got.toFixed(2)),
      });
    }
  };
  const textContrast = () => {
    for (const el of all) {
      contrastOf(el);
    }
  };

  // A control's edge against what it sits on: its fill or its border, 3:1.
  const controlEdges = () => {
    const controls = all.filter((el) =>
      el.matches(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select, [role=combobox], [role=textbox], [role=switch], [role=checkbox], [role=radio]"
      )
    );
    for (const el of controls) {
      if (disabled(el)) {
        continue;
      }
      const under = backdrop(el.parentElement);
      if (!under) {
        continue;
      }
      const style = getComputedStyle(el);
      const fill = over(rgba(style.backgroundColor), under);
      const border =
        px(style.borderTopWidth) >= 1
          ? ratio(over(rgba(style.borderTopColor), fill), under)
          : 1;
      const got = Math.max(ratio(fill, under), border);
      if (got < 3) {
        add({
          check: "control-edge",
          detail: `edge ${got.toFixed(2)}:1 against what it sits on, under 3:1`,
          label: labelOf(el),
          value: Number(got.toFixed(2)),
        });
      }
    }
  };

  // A filled control whose fill doesn't separate it from what it sits on.
  const controlFills = () => {
    for (const el of all.filter((e) =>
      e.matches("button, [role=button], [role=combobox], [aria-haspopup]")
    )) {
      const style = getComputedStyle(el);
      const fill = rgba(style.backgroundColor);
      const under = backdrop(el.parentElement);
      if (fill[3] < 0.3 || disabled(el) || !under) {
        continue;
      }
      const filled = over(fill, under);
      const edge =
        px(style.borderTopWidth) >= 1
          ? ratio(over(rgba(style.borderTopColor), filled), under)
          : 1;
      const got = ratio(filled, under);
      if (got > 1.001 && got < 1.1 && edge < 1.5) {
        add({
          check: "control-fill",
          detail: `its fill ${got.toFixed(2)}:1 against what it sits on, under 1.1:1: it doesn't separate`,
          label: labelOf(el),
          value: Number(got.toFixed(3)),
        });
      }
    }
  };

  // Nested surfaces a tone step apart; a dialog not below the page it covers.
  const isControl = (el: Element) =>
    el.matches(
      "button, a, input, select, textarea, [role=button], [role=option], [role=menuitem], [role=treeitem], [role=tab], li"
    );
  const toneOf = (el: Element) => {
    const fill = rgba(getComputedStyle(el).backgroundColor);
    const box = el.getBoundingClientRect();
    if (fill[3] < 0.5 || box.width < 120 || box.height < 64 || isControl(el)) {
      return;
    }
    const under = backdrop(el.parentElement);
    if (!under) {
      return;
    }
    const delta = Math.abs(lightness(over(fill, under)) - lightness(under));
    if (delta > 0.002 && delta < options.nearTone) {
      add({
        check: "surface-tone",
        detail: `${delta.toFixed(3)} lightness from its container, under a tone step (${options.nearTone})`,
        label: labelOf(el),
        value: Number(delta.toFixed(3)),
      });
    }
  };
  /**
   * Inside a floating card (one with a shadow), a surface covering part of it on the card's own
   * tone, the same tone included: chrome and content read as one sheet (elevation.md).
   */
  const floatingTonesOf = (card: Element) => {
    const style = getComputedStyle(card);
    const fill = rgba(style.backgroundColor);
    const box = card.getBoundingClientRect();
    if (
      style.boxShadow === "none" ||
      fill[3] < 0.5 ||
      box.width < 200 ||
      box.height < 150
    ) {
      return;
    }
    const tone = backdrop(card);
    if (!tone) {
      return;
    }
    const area = box.width * box.height;
    for (const inner of card.querySelectorAll("*")) {
      const b = inner.getBoundingClientRect();
      const share = (b.width * b.height) / area;
      const own = rgba(getComputedStyle(inner).backgroundColor);
      if (
        own[3] < 0.5 ||
        share < 0.15 ||
        share > 0.9 ||
        isControl(inner) ||
        !shown(inner)
      ) {
        continue;
      }
      const inside = backdrop(inner);
      const delta = inside ? Math.abs(lightness(inside) - lightness(tone)) : 1;
      if (delta < options.nearTone) {
        add({
          check: "surface-tone",
          detail: `${delta.toFixed(3)} lightness from the floating card it sits in: one sheet (under ${options.nearTone})`,
          label: labelOf(inner).slice(0, 40),
          value: Number(delta.toFixed(3)),
        });
      }
    }
  };
  const surfaceTones = () => {
    for (const el of all) {
      toneOf(el);
      floatingTonesOf(el);
    }
  };
  const overlayTones = () => {
    for (const dialog of all.filter((el) =>
      el.matches("[role=dialog], [role=alertdialog], dialog")
    )) {
      const box = dialog.getBoundingClientRect();
      const behind = document
        .elementsFromPoint(Math.max(2, box.left - 8), Math.max(2, box.top + 8))
        .find(
          (el) =>
            !dialog.contains(el) && getComputedStyle(el).position !== "fixed"
        );
      const page = behind ? backdrop(behind) : undefined;
      if (!page) {
        continue;
      }
      const surfaces = [dialog, ...dialog.querySelectorAll("*")].filter(
        (el) => {
          const b = el.getBoundingClientRect();
          return (
            rgba(getComputedStyle(el).backgroundColor)[3] >= 0.5 &&
            b.width * b.height >= (box.width * box.height) / 4
          );
        }
      );
      for (const s of surfaces) {
        const tone = backdrop(s);
        if (tone && lightness(tone) < lightness(page) - 0.005) {
          add({
            check: "overlay-tone",
            detail: `${(lightness(page) - lightness(tone)).toFixed(3)} lightness below the page it covers`,
            label: labelOf(s).slice(0, 30),
            value: Number((lightness(page) - lightness(tone)).toFixed(3)),
          });
        }
      }
    }
  };

  // Spacing on the scale: paddings, gaps and margins.
  const spacingScale = () => {
    if (options.grid <= 0) {
      return;
    }
    const props = [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "rowGap",
      "columnGap",
      "marginTop",
      "marginBottom",
    ] as const;
    for (const el of all) {
      const style = getComputedStyle(el);
      const flexOrGrid =
        style.display.includes("flex") || style.display.includes("grid");
      for (const prop of props) {
        if ((prop === "rowGap" || prop === "columnGap") && !flexOrGrid) {
          continue;
        }
        const value = px(style[prop]);
        if (
          value > 1 &&
          Math.abs(value / options.grid - Math.round(value / options.grid)) >
            0.01
        ) {
          add({
            check: "off-scale",
            detail: `${prop} ${Math.round(value * 100) / 100}px, not on the ${options.grid}px scale`,
            label: labelOf(el),
            value,
          });
        }
      }
    }
  };

  // Rows of a list, rounded or filled, touching their neighbours.
  /** Whether two neighbouring rows of the typical height, either rounded or filled, touch. */
  const touch = (
    a: Element | undefined,
    b: Element | undefined,
    typical: number
  ) => {
    const boxA = a?.getBoundingClientRect();
    const boxB = b?.getBoundingClientRect();
    if (
      !(a && b && boxA && boxB) ||
      Math.abs(boxA.height - typical) > 2 ||
      Math.abs(boxB.height - typical) > 2
    ) {
      return false;
    }
    const rounded = [a, b].some(
      (r) =>
        px(getComputedStyle(r).borderTopLeftRadius) >= 2 ||
        rgba(getComputedStyle(r).backgroundColor)[3] > 0.05
    );
    return Math.abs(boxB.top - boxA.bottom) < 0.5 && rounded;
  };
  const touchingIn = (el: Element) => {
    const rows = [...el.children].filter((c) => shown(c));
    if (rows.length < 3) {
      return;
    }
    const heights = rows.map((c) =>
      Math.round(c.getBoundingClientRect().height)
    );
    const typical =
      heights.sort((x, y) => x - y)[Math.floor(heights.length / 2)] ?? 0;
    if (
      typical >= 20 &&
      typical <= 48 &&
      rows.some((row, i) => i > 0 && touch(rows[i - 1], row, typical))
    ) {
      add({
        check: "touching-rows",
        detail: `rows of ${typical}px, rounded or filled, with no gap between them`,
        label: labelOf(el).slice(0, 40),
        value: 0,
      });
    }
  };
  const touchingRows = () => {
    for (const el of all) {
      touchingIn(el);
    }
  };
  // Text clipped with no ellipsis.
  const clippedText = () => {
    for (const el of all) {
      const style = getComputedStyle(el);
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== ""
      );
      if (
        own &&
        (style.overflowX === "hidden" || style.overflowX === "clip") &&
        el.scrollWidth > el.clientWidth + 1 &&
        style.textOverflow !== "ellipsis"
      ) {
        add({
          check: "clipped-text",
          detail: `${el.scrollWidth - el.clientWidth}px of its text cut off, no ellipsis`,
          label: labelOf(el),
          value: el.scrollWidth - el.clientWidth,
        });
      }
    }
  };

  // Targets at least 24px: a control's box, its label's when it has one around it.
  const targetSizes = () => {
    for (const el of all.filter((e) =>
      e.matches(
        "button, a[href], [role=button], [role=checkbox], [role=switch], [role=radio], [role=tab], input[type=checkbox], input[type=radio]"
      )
    )) {
      if (disabled(el)) {
        continue;
      }
      const target = el.closest("label") ?? el;
      const b = target.getBoundingClientRect();
      if (b.width < 24 || b.height < 24) {
        add({
          check: "target-size",
          detail: `${Math.round(b.width)}×${Math.round(b.height)}, under 24×24`,
          label: labelOf(el),
          value: Math.round(Math.min(b.width, b.height)),
        });
      }
    }
  };

  /** A list by its layout, whatever its markup: three or more rows of one height, stacked. */
  /**
   * A list's rows by their layout, whatever the markup: three or more children of the most common
   * height (16–64px), stacked; a heading row of another height above them is left out. None when
   * the element isn't a list.
   */
  const listRows = (el: Element): readonly Element[] => {
    const children = [...el.children].filter((c) => shown(c));
    const heights = children.map((c) =>
      Math.round(c.getBoundingClientRect().height)
    );
    const counts = new Map<number, number>();
    for (const h of heights) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const [common = 0] =
      [...counts.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
    const rows = children.filter(
      (_, i) => Math.abs((heights[i] ?? 0) - common) <= 2
    );
    const boxes = rows.map((r) => r.getBoundingClientRect());
    const stacked = boxes.every(
      (box, i) => i === 0 || box.top >= (boxes[i - 1]?.bottom ?? 0) - 1
    );
    return rows.length >= 3 && common >= 16 && common <= 64 && stacked
      ? rows
      : [];
  };

  /** Whether a text node, lengthened, overruns its row or what sits beside it in the row. */
  const overrunsWhenLong = (row: Element, textNode: ChildNode) => {
    const holder = textNode.parentElement;
    if (!holder) {
      return false;
    }
    const before = textNode.textContent ?? "";
    const rowBox = row.getBoundingClientRect();
    textNode.textContent = `${before.trim()}-${"verylongname".repeat(10)}`;
    const box = holder.getBoundingClientRect();
    const overlaps = (other: Element) => {
      if (
        other === holder ||
        other.contains(holder) ||
        holder.contains(other) ||
        !shown(other)
      ) {
        return false;
      }
      const o = other.getBoundingClientRect();
      return (
        o.width > 0 &&
        o.left < box.right - 1 &&
        o.right > box.left + 1 &&
        o.top < box.bottom - 1 &&
        o.bottom > box.top + 1
      );
    };
    const overruns =
      box.right > rowBox.right + 1 ||
      row.scrollWidth > row.clientWidth + 1 ||
      [...row.querySelectorAll("*")].some(overlaps);
    textNode.textContent = before;
    return overruns;
  };

  // Names that can't truncate: each text of a list's first row lengthened in turn, then put back.
  const namesTruncate = () => {
    if (!options.stress) {
      return;
    }
    for (const list of all) {
      const [row] = listRows(list);
      if (!row) {
        continue;
      }
      const texts = [...row.querySelectorAll("*")]
        .flatMap((e) => [...e.childNodes])
        .filter(
          (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length >= 2
        )
        .slice(0, 4);
      const long = texts.find((t) => overrunsWhenLong(row, t));
      if (long) {
        add({
          check: "cant-truncate",
          detail: "a long text overruns its row or what sits beside it",
          label: (long.textContent ?? "").trim().slice(0, 40),
          value: 1,
        });
      }
    }
  };

  const checks: readonly (readonly [AuditFinding["check"], () => void])[] = [
    ["contrast", textContrast],
    ["control-edge", controlEdges],
    ["control-fill", controlFills],
    ["surface-tone", surfaceTones],
    ["overlay-tone", overlayTones],
    ["off-scale", spacingScale],
    ["touching-rows", touchingRows],
    ["clipped-text", clippedText],
    ["target-size", targetSizes],
    ["cant-truncate", namesTruncate],
  ];
  for (const [name, run] of checks) {
    if (!options.only || options.only.includes(name)) {
      run();
    }
  }
  const controls = all
    .filter((el) =>
      el.matches("button, a[href], [role=button], [role=menuitem]")
    )
    .map(labelOf);
  return { controls: [...new Set(controls)], findings };
};
