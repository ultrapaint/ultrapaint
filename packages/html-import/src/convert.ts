/**
 * Pasted HTML as design nodes, by fixed rules, as a Figma frame is imported (ADRs 0016, 0148): a
 * flex container becomes a row or a column, another block holding elements a column (a group when
 * its children are all positioned absolutely), an element holding only words a text, an `img` an
 * image. Each element's fields come from its element style, its inline style over its classes as
 * the style system's class reader reads them (`element-style`), every value the design system has
 * a token for written as that token (`fields`). What the rules cannot carry is counted in the
 * warnings. Pure and synchronous over the `Document` it is given, the browser's `DOMParser`'s or
 * happy-dom's.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  ImageFit,
  TextRun,
} from "@ultrapaint/contracts/document";
import type { ClassReader } from "@ultrapaint/contracts/node-style";
import { type IdGenerator, idPrefix } from "@ultrapaint/design-document/ids";
import {
  type RunFields,
  settleRuns,
} from "@ultrapaint/design-document/text-runs";
import {
  type ElementStyle,
  isAbsolute,
  isBlock,
  isFlex,
  isGrid,
  styleOf,
} from "./element-style.ts";
import { type BoxFields, type Layout, makeFields } from "./fields.ts";
import { valuesOf } from "./values.ts";
import { makeWarnings, type Warning } from "./warnings.ts";

export interface HtmlImportOptions {
  /** How the style system reads an element's classes, the design system's tokens made once. */
  readonly classes: ClassReader;
  readonly designSystem: DesignSystem | null | undefined;
  readonly next: IdGenerator;
}

export interface HtmlConversion {
  /** The layers, in the markup's order; none when nothing could be carried. */
  readonly nodes: readonly DesignNode[];
  readonly warnings: readonly Warning[];
}

const ELEMENT = 1;
const TEXT = 3;
const MAX_DEPTH = 48;

/** Elements that show nothing, dropped without a word. */
const UNSHOWN = new Set([
  "base",
  "head",
  "link",
  "meta",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);
const LEFT_OUT: Readonly<Record<string, "form" | "media" | "svg">> = {
  audio: "media",
  canvas: "media",
  datalist: "form",
  embed: "media",
  iframe: "media",
  input: "form",
  meter: "form",
  object: "media",
  progress: "form",
  select: "form",
  svg: "svg",
  textarea: "form",
  video: "media",
};
/** Elements that sit in a line of words, which a text keeps the words of. */
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);
/** Inline elements that format nothing, so flattening them loses nothing. */
const PLAIN_INLINE = new Set(["br", "span", "wbr"]);
/** Inline elements a text keeps as runs of its words (ADR 0163): a link, an underline. */
const RUN_INLINE = new Set(["a", "ins", "u"]);
const UNDERLINE_RE = /\bunderline\b/;
/** A link a run does not keep: one that runs code. */
const SCRIPT_LINK_RE = /^\s*javascript:/i;
/** What an underline's longhands hold when they say nothing more than the underline. */
const DECORATION_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  textDecorationColor: ["currentcolor", "currentColor"],
  textDecorationStyle: ["solid"],
  textDecorationThickness: ["auto"],
};
/** Shown to screen readers alone, as Tailwind's utility writes it. */
const SCREEN_READER_ONLY = "sr-only";
const FITS: readonly ImageFit[] = ["cover", "contain", "fill"];
const HEADING_RE = /^h([1-6])$/;
const SPACE_RE = /[ \t\n\r\f]+/g;
const EDGE_SPACE_RE = /^\s$/;
const NUMBER_RE = /^-?\d*\.?\d+$/;

/** Text settings, which a text takes from the elements around it as CSS inherits them. */
const TEXT_SETTINGS = [
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textAlign",
] as const;

/** A converted child, with where it says it is when positioned absolutely. */
interface Converted {
  readonly absolute: boolean;
  readonly left: number;
  readonly node: DesignNode;
  readonly top: number;
}

/** The words of a run of the markup, their runs, and whether flattening them lost formatting. */
interface Words {
  readonly flattened: boolean;
  /** Its words with their links and underlines; null when none has either. */
  readonly runs: TextRun[] | null;
  readonly words: string;
}

/** A character of the words, with the link and underline of the elements it is in. */
interface RunChar {
  readonly char: string;
  /** What the elements it is in set. */
  readonly sets: RunFields;
}

/** Whether an element's style draws a line under its words. */
const underlines = (own: ElementStyle) =>
  UNDERLINE_RE.test(String(own.textDecorationLine ?? own.textDecoration ?? ""));

/** Whether an element's style sets more than an underline a run keeps. */
const stylesBeyondUnderline = (own: ElementStyle) =>
  Object.entries(own).some(
    ([name, value]) =>
      name !== "textDecoration" &&
      name !== "textDecorationLine" &&
      !DECORATION_DEFAULTS[name]?.includes(String(value))
  );

/** What the words inside an element set: what is around it, and its link or underline. */
const fieldsWithin = (
  element: Element,
  own: ElementStyle,
  around: RunFields
): RunFields => {
  const tag = tagOf(element);
  const href = tag === "a" ? element.getAttribute("href")?.trim() : undefined;
  return {
    ...around,
    ...(href && !SCRIPT_LINK_RE.test(href) && { link: href }),
    ...((tag === "u" || tag === "ins" || underlines(own)) && {
      underline: true,
    }),
  };
};

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

const tagOf = (element: Element) => element.tagName.toLowerCase();

const isElement = (node: ChildNode): node is Element =>
  node.nodeType === ELEMENT;

export const convertHtml = (
  document: Document,
  options: HtmlImportOptions
): HtmlConversion => {
  const { classes, designSystem, next } = options;
  const { list, warn } = makeWarnings();
  const fields = makeFields(valuesOf(designSystem), designSystem, warn);

  // An element's style is read once, so the classes it could not read are counted once.
  const styles = new WeakMap<Element, ElementStyle>();
  const style = (element: Element): ElementStyle => {
    const known = styles.get(element);
    if (known) {
      return known;
    }
    const read = styleOf(element, classes, warn);
    styles.set(element, read);
    return read;
  };

  /** Whether an element shows anything: not hidden, nor shown to screen readers alone. */
  const shown = (element: Element): boolean => {
    if (
      UNSHOWN.has(tagOf(element)) ||
      element.hasAttribute("hidden") ||
      element.classList.contains(SCREEN_READER_ONLY)
    ) {
      return false;
    }
    const own = style(element);
    return own.display !== "none" && own.visibility !== "hidden";
  };

  /** Whether a node flows in a line of words: text, or an inline element holding only words. */
  const flows = (node: ChildNode): boolean => {
    if (node.nodeType === TEXT) {
      return true;
    }
    if (!isElement(node)) {
      return false;
    }
    if (!shown(node)) {
      // What shows nothing takes no room in the line.
      return true;
    }
    const own = style(node);
    return (
      INLINE.has(tagOf(node)) &&
      !(isBlock(own) || isAbsolute(own)) &&
      holdsOnlyWords(node)
    );
  };

  const holdsOnlyWords = (element: Element): boolean =>
    [...element.childNodes].every((child) => !isElement(child) || flows(child));

  /**
   * The words of a run, its spaces collapsed as a browser shows them, `br` a new line, each with
   * the link and the underline of the elements it is in (ADR 0163). Any other formatting is lost.
   */
  const wordsOf = (
    nodes: readonly ChildNode[],
    /** What the element holding them sets: a link or an underline of the whole text. */
    around: RunFields = {}
  ): Words => {
    const chars: RunChar[] = [];
    let flattened = false;
    /** A character as a browser shows it: no space after a space or a line's edge. */
    const put = (char: string, sets: RunFields) => {
      const last = chars.at(-1)?.char;
      if (
        char === " " &&
        (last === undefined || last === " " || last === "\n")
      ) {
        return;
      }
      if (char === "\n") {
        while (chars.at(-1)?.char === " ") {
          chars.pop();
        }
        if (chars.length === 0) {
          return;
        }
      }
      chars.push({ char, sets });
    };
    const walk = (node: ChildNode, sets: RunFields) => {
      if (node.nodeType === TEXT) {
        for (const char of (node.textContent ?? "").replace(SPACE_RE, " ")) {
          put(char, sets);
        }
        return;
      }
      if (!(isElement(node) && shown(node))) {
        return;
      }
      const tag = tagOf(node);
      if (tag === "br") {
        put("\n", sets);
        return;
      }
      const own = style(node);
      const here = fieldsWithin(node, own, sets);
      // Its own style is lost in the text, as a bold is; a link and an underline are runs.
      flattened ||=
        !(PLAIN_INLINE.has(tag) || RUN_INLINE.has(tag)) ||
        stylesBeyondUnderline(own);
      for (const child of node.childNodes) {
        walk(child, here);
      }
    };
    for (const node of nodes) {
      walk(node, around);
    }
    // Any space at either end is left out, a non-breaking one too, as the words are trimmed.
    const first = chars.findIndex((c) => !EDGE_SPACE_RE.test(c.char));
    const last = chars.findLastIndex((c) => !EDGE_SPACE_RE.test(c.char));
    const kept = first === -1 ? [] : chars.slice(first, last + 1);
    return {
      flattened,
      // One run a character: settling them joins the neighbours that set the same.
      runs: settleRuns(kept.map(({ char, sets }) => ({ text: char, ...sets }))),
      words: kept.map((c) => c.char).join(""),
    };
  };

  /** The settings a text inherits from an element, its own over those around it. */
  const inherit = (around: ElementStyle, own: ElementStyle): ElementStyle => {
    const settings: ElementStyle = { ...around };
    for (const name of TEXT_SETTINGS) {
      if (own[name] !== undefined) {
        settings[name] = own[name];
      }
    }
    return settings;
  };

  const textNode = (
    { flattened, runs, words }: Words,
    settings: ElementStyle,
    box: BoxFields | Record<string, never>,
    tag: string
  ): DesignNode => {
    if (flattened) {
      warn("inline");
    }
    const match: RegExpExecArray | null = HEADING_RE.exec(tag);
    const heading = match?.[1];
    return compact({
      ...box,
      ...fields.text(settings),
      id: next(idPrefix("text")),
      level: heading === undefined ? undefined : Number(heading),
      role:
        heading === undefined ? ("paragraph" as const) : ("heading" as const),
      runs: runs ?? undefined,
      text: words,
      type: "text" as const,
    });
  };

  const imageNode = (
    element: Element,
    own: ElementStyle,
    parent: Layout
  ): DesignNode | null => {
    const src = element.getAttribute("src")?.trim() ?? "";
    if (src === "") {
      return null;
    }
    if (src.startsWith("data:")) {
      warn("dataImage");
      return null;
    }
    const attribute = (name: string) => {
      const value = element.getAttribute(name);
      return value !== null && NUMBER_RE.test(value)
        ? Number(value)
        : undefined;
    };
    return compact({
      ...fields.box(
        { height: attribute("height"), width: attribute("width"), ...own },
        parent
      ),
      alt: element.getAttribute("alt") ?? "",
      fit: FITS.find((fit) => fit === own.objectFit),
      id: next(idPrefix("image")),
      src,
      type: "image" as const,
    });
  };

  /**
   * The children of an element. In normal flow a run of words between blocks is a text of its own,
   * an inline element alone keeping its own look (a link styled as a button); in a flex or a grid
   * every child is one, as each is an item there.
   */
  const childrenOf = (
    parent: ParentNode,
    settings: ElementStyle,
    layout: Layout,
    flowing: boolean,
    depth: number
  ): Converted[] => {
    const out: Converted[] = [];
    const add = (converted: Converted | null) => {
      if (converted) {
        out.push(converted);
      }
    };
    const paragraph = (words: Words) =>
      words.words === ""
        ? null
        : {
            absolute: false,
            left: 0,
            node: textNode(words, settings, {}, "p"),
            top: 0,
          };
    let run: ChildNode[] = [];
    const endRun = () => {
      const elements = run.filter(isElement).filter(shown);
      const [only] = elements;
      const words = wordsOf(run);
      add(
        elements.length === 1 && only && words.words === wordsOf([only]).words
          ? elementNode(only, settings, layout, depth)
          : paragraph(words)
      );
      run = [];
    };
    for (const child of parent.childNodes) {
      if (!flowing) {
        add(
          isElement(child)
            ? elementNode(child, settings, layout, depth)
            : paragraph(wordsOf([child]))
        );
      } else if (flows(child)) {
        run.push(child);
      } else {
        endRun();
        if (isElement(child)) {
          add(elementNode(child, settings, layout, depth));
        }
      }
    }
    endRun();
    return out;
  };

  /** How a container lays out its children: its display and direction read, a grid warned. */
  const arrangementOf = (own: ElementStyle) => {
    const flex = isFlex(own);
    const grid = isGrid(own);
    const direction = String(own.flexDirection ?? "row");
    if (flex && direction.endsWith("-reverse")) {
      warn("reversed");
    }
    if (grid) {
      warn("grid");
    }
    const layout: "row" | "column" =
      flex && !direction.startsWith("column") ? "row" : "column";
    return { flex, grid, layout };
  };

  const containerNode = (
    element: Element,
    own: ElementStyle,
    settings: ElementStyle,
    parent: Layout,
    depth: number
  ): DesignNode | null => {
    const { flex, grid, layout } = arrangementOf(own);
    const converted = childrenOf(
      element,
      settings,
      layout,
      !(flex || grid),
      depth + 1
    );
    const absolute = converted.filter((child) => child.absolute).length;
    const free =
      !(flex || grid) && absolute > 0 && absolute === converted.length;
    if (free) {
      warn("positions");
    } else {
      warn("inFlow", absolute);
    }
    const children = (
      free
        ? converted.toSorted((a, b) => a.top - b.top || a.left - b.left)
        : converted
    ).map((c) => c.node);
    const box = fields.box(own, parent);
    if (children.length === 0 && Object.keys(box).length === 0) {
      return null;
    }
    if (free) {
      return { ...box, children, id: next(idPrefix("group")), type: "group" };
    }
    // A grid's rows are a column's children, its row gap their gap.
    const stack = flex || grid ? fields.stack(own, layout) : undefined;
    return {
      ...box,
      ...(grid ? compact({ gap: stack?.gap }) : stack),
      children,
      id: next(idPrefix(layout)),
      type: layout,
    };
  };

  /** A node with where its element says it is, when it is positioned absolutely. */
  const placed = (
    own: ElementStyle,
    node: DesignNode | null
  ): Converted | null =>
    node === null
      ? null
      : {
          absolute: isAbsolute(own),
          left: typeof own.left === "number" ? own.left : 0,
          node,
          top: typeof own.top === "number" ? own.top : 0,
        };

  /** An element as the node it is by the rules; null for one shown as nothing, or left out. */
  function elementNode(
    element: Element,
    around: ElementStyle,
    parent: Layout,
    depth: number
  ): Converted | null {
    const tag = tagOf(element);
    // What is not shown is dropped without a word, a hidden control as anything else.
    if (!shown(element)) {
      return null;
    }
    const left = Object.hasOwn(LEFT_OUT, tag) ? LEFT_OUT[tag] : undefined;
    if (left !== undefined) {
      warn(left);
      return null;
    }
    if (depth > MAX_DEPTH) {
      warn("depth");
      return null;
    }
    const own = style(element);
    if (tag === "button") {
      warn("button");
    }
    if (tag === "img") {
      return placed(own, imageNode(element, own, parent));
    }
    const settings = inherit(around, own);
    const words =
      isFlex(own) || isGrid(own) || !holdsOnlyWords(element)
        ? null
        : wordsOf([...element.childNodes], fieldsWithin(element, own, {}));
    if (words === null || words.words === "") {
      return placed(own, containerNode(element, own, settings, parent, depth));
    }
    return placed(own, textNode(words, settings, fields.box(own, parent), tag));
  }

  // The body is an element as any other: hidden, it shows nothing; its text settings are its
  // children's to inherit.
  const { body } = document;
  const layers = shown(body)
    ? childrenOf(body, inherit({}, style(body)), "column", true, 0).map(
        (c) => c.node
      )
    : [];
  return { nodes: layers, warnings: list() };
};
