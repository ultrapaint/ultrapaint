/**
 * The design checks that run inside a page: Playwright, or the editor, sends each function's
 * source to the page and runs it there, so each is plain DOM code that reaches nothing outside
 * itself (no imports, no names of this module), takes JSON and gives JSON back.
 *
 * `layoutInBrowser` reads the layout the spacing and divider findings are made from
 * (`findings.ts`); `auditInBrowser` runs the general checks (ADR 0061), each with a threshold
 * from the skill or the design system.
 */

/**
 * Where a finding is: a box in CSS pixels from the measured root's top left corner, so a picture
 * of the root can be cropped and boxed around it.
 */
export interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** A line of text, top to bottom, in CSS pixels from the root's top. */
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
  /** Its box, from the root's top left corner. */
  readonly box: Box;
  readonly children: readonly LaidBlock[];
  /** Its first words, to name it in a finding. */
  readonly label: string;
  readonly lines: readonly InkLine[];
  readonly top: number;
}

/** A thin vertical rule (a divider) and the vertical centre of what sits beside it in its bar. */
export interface LaidRule {
  readonly bar: string;
  /** The rule's box, from the root's top left corner. */
  readonly box: Box;
  readonly centre: number;
  readonly sideCentre: number;
}

/**
 * The layout under `root`: its blocks of text, and its vertical rules beside their neighbours,
 * every position from the root's top left corner; and the root's own box in the window.
 */
export const layoutInBrowser = (root: string) => {
  const rootEl = document.querySelector(root) ?? document.body;
  const origin = rootEl.getBoundingClientRect();
  const boxOf = (r: DOMRect) => ({
    height: Math.round(r.height * 10) / 10,
    width: Math.round(r.width * 10) / 10,
    x: Math.round((r.left - origin.left) * 10) / 10,
    y: Math.round((r.top - origin.top) * 10) / 10,
  });
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
      .map((r) => ({ bottom: r.bottom - origin.top, top: r.top - origin.top }));
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
      bottom: box.bottom - origin.top,
      box: boxOf(box),
      children,
      label: ((el as HTMLElement).innerText ?? el.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40),
      lines,
      top: box.top - origin.top,
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
          box: boxOf(r),
          centre: (r.top + r.bottom) / 2 - origin.top,
          sideCentre: middle - origin.top,
        };
  };
  const rules = [...rootEl.querySelectorAll("*")].flatMap((el) => {
    const rule = ruleOf(el);
    return rule ? [rule] : [];
  });
  return {
    block: walk(rootEl),
    root: {
      height: origin.height,
      width: origin.width,
      x: origin.left,
      y: origin.top,
    },
    rules,
  };
};

/** What a design check of `auditInBrowser` found, and the measured value it fails on. */
export interface AuditFinding {
  /** Where the element is, from the root's top left corner. */
  readonly box?: Box;
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
   * `surfaces.md`'s step, about 0.045.
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
  /** Where each of those controls is, by its name, from the root's top left corner. */
  readonly controlBoxes?: Readonly<Record<string, Box>>;
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
  const origin = rootEl.getBoundingClientRect();
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return {
      height: Math.round(r.height * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      x: Math.round((r.left - origin.left) * 10) / 10,
      y: Math.round((r.top - origin.top) * 10) / 10,
    };
  };
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  /** A finding once, by its check, element and detail, with where its element is. */
  const add = (f: Omit<AuditFinding, "box">, el: Element) => {
    const key = `${f.check}|${f.label}|${f.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ ...f, box: boxOf(el) });
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
      add(
        {
          check: "contrast",
          detail: `${field ? "placeholder" : "text"} ${got.toFixed(2)}:1, under ${need}:1`,
          label: `${labelOf(el)}${field ? " (placeholder)" : ""}`,
          value: Number(got.toFixed(2)),
        },
        el
      );
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
        add(
          {
            check: "control-edge",
            detail: `edge ${got.toFixed(2)}:1 against what it sits on, under 3:1`,
            label: labelOf(el),
            value: Number(got.toFixed(2)),
          },
          el
        );
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
        add(
          {
            check: "control-fill",
            detail: `its fill ${got.toFixed(2)}:1 against what it sits on, under 1.1:1: it doesn't separate`,
            label: labelOf(el),
            value: Number(got.toFixed(3)),
          },
          el
        );
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
      add(
        {
          check: "surface-tone",
          detail: `${delta.toFixed(3)} lightness from its container, under a tone step (${options.nearTone})`,
          label: labelOf(el),
          value: Number(delta.toFixed(3)),
        },
        el
      );
    }
  };
  /**
   * Inside a floating card (one with a shadow), a surface covering part of it on the card's own
   * tone, the same tone included: chrome and content read as one sheet (surfaces.md).
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
        add(
          {
            check: "surface-tone",
            detail: `${delta.toFixed(3)} lightness from the floating card it sits in: one sheet (under ${options.nearTone})`,
            label: labelOf(inner).slice(0, 40),
            value: Number(delta.toFixed(3)),
          },
          inner
        );
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
          add(
            {
              check: "overlay-tone",
              detail: `${(lightness(page) - lightness(tone)).toFixed(3)} lightness below the page it covers`,
              label: labelOf(s).slice(0, 30),
              value: Number((lightness(page) - lightness(tone)).toFixed(3)),
            },
            s
          );
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
          add(
            {
              check: "off-scale",
              detail: `${prop} ${Math.round(value * 100) / 100}px, not on the ${options.grid}px scale`,
              label: labelOf(el),
              value,
            },
            el
          );
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
      add(
        {
          check: "touching-rows",
          detail: `rows of ${typical}px, rounded or filled, with no gap between them`,
          label: labelOf(el).slice(0, 40),
          value: 0,
        },
        el
      );
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
        add(
          {
            check: "clipped-text",
            detail: `${el.scrollWidth - el.clientWidth}px of its text cut off, no ellipsis`,
            label: labelOf(el),
            value: el.scrollWidth - el.clientWidth,
          },
          el
        );
      }
    }
  };

  /**
   * The labels a click on which is a click on the control: one around it, and those whose `for`
   * names it (`labels`, for the elements a label can name).
   */
  const clickableLabels = (el: Element): readonly Element[] => {
    const found = new Set<Element>();
    const around = el.closest("label");
    if (around) {
      found.add(around);
    }
    for (const label of (el as HTMLInputElement).labels ?? []) {
      found.add(label);
    }
    return [...found].filter((label) => shown(label));
  };
  // Targets at least 24px: a control's box, or with its clickable labels at least the area of
  // 24×24, since a label that is clicked acts as the control (the person's rating, 11 November).
  const targetSizes = () => {
    for (const el of all.filter((e) =>
      e.matches(
        "button, a[href], [role=button], [role=checkbox], [role=switch], [role=radio], [role=tab], input[type=checkbox], input[type=radio]"
      )
    )) {
      if (disabled(el)) {
        continue;
      }
      const labels = clickableLabels(el);
      const target = el.closest("label") ?? el;
      const b = target.getBoundingClientRect();
      if (labels.length > 0) {
        const boxes = [el, ...labels].map((e) => e.getBoundingClientRect());
        const width =
          Math.max(...boxes.map((x) => x.right)) -
          Math.min(...boxes.map((x) => x.left));
        const height =
          Math.max(...boxes.map((x) => x.bottom)) -
          Math.min(...boxes.map((x) => x.top));
        if (width * height >= 24 * 24) {
          continue;
        }
      }
      if (b.width < 24 || b.height < 24) {
        add(
          {
            check: "target-size",
            detail: `${Math.round(b.width)}×${Math.round(b.height)}, under 24×24`,
            label: labelOf(el),
            value: Math.round(Math.min(b.width, b.height)),
          },
          target
        );
      }
    }
  };

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
        add(
          {
            check: "cant-truncate",
            detail: "a long text overruns its row or what sits beside it",
            label: (long.textContent ?? "").trim().slice(0, 40),
            value: 1,
          },
          row
        );
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
  const controlEls = all.filter((el) =>
    el.matches("button, a[href], [role=button], [role=menuitem]")
  );
  const controlBoxes: Record<string, Box> = {};
  for (const el of controlEls) {
    controlBoxes[labelOf(el)] ??= boxOf(el);
  }
  return {
    controlBoxes,
    controls: [...new Set(controlEls.map(labelOf))],
    findings,
  };
};
