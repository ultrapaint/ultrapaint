/**
 * A page's stylesheet, made to work in a frame of the editor's page (ADR 0034). A frame is a
 * shadow root, not a document: what the stylesheet says of the document's root and body is said
 * of the shadow host and the frame's body element; what it says of the window's size (media
 * queries on width, `vh`) is said of the frame's; and what only a document can hold (font faces,
 * registered properties, imported sheets) goes to the editor's document, where the frames see it.
 *
 * Parsed by the browser itself (a constructable stylesheet) and written out again rule by rule,
 * so nesting, layers and every at-rule are read as the browser reads them.
 */

/** The name the frames' query container goes by: the shadow host. */
export const FRAME_CONTAINER = "ed-frame";

/** The attribute of the element that stands for a page's `<body>`. */
export const BODY_ATTRIBUTE = "data-ed-body";

/** What a stylesheet becomes: what the frames adopt, and what the editor's document holds. */
export interface FrameCss {
  /** `@font-face` and `@property` rules, and `@import`s of other sites' stylesheets. */
  readonly document: string;
  readonly frame: string;
}

const IMPORT_RE = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;/g;
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

/** A selector's `:root` or `html`, with what it says of the root element itself. */
const ROOT_RE =
  /(^|[\s>+~(,])(?::root|html)(?![-\w(])((?:[.#[][^\s>+~,()]*)?)/g;
const BODY_RE = /(^|[\s>+~(,])body(?![-\w(])/g;

/** `100vh`, `50dvw`, `10vmin`: the window's size, which a frame's is. */
const VIEWPORT_UNIT_RE = /(\d*\.?\d+)(?:s|l|d)?v(h|w|min|max|b|i)\b/g;

const MEDIA_TYPE_RE = /^\s*(?:only\s+)?(?:screen|all)\s+and\s+/i;
const FEATURE_RE = /\(([^()]*)\)/g;
/** A feature about the window's size: `min-width: 40rem`, `width >= 40rem`, `40rem < width`. */
const SIZE_FEATURE_RE =
  /^\s*(?:(?:min-|max-)?(?:width|height|aspect-ratio)\s*:|orientation\s*:|[^:]*\b(?:width|height|aspect-ratio)\b\s*[<>=]|[^:]*[<>=]\s*(?:width|height|aspect-ratio)\b)/;
const LEFTOVER_RE = /^[\s()]*(?:and[\s()]*)*$/i;

/**
 * The container query a media query on the window's size is, in a frame; null when it asks
 * anything else (a hover, a colour scheme, print), which a frame answers as the window does.
 */
export const containerCondition = (media: string): string | null => {
  if (media.includes(",")) {
    return null;
  }
  const condition = media.replace(MEDIA_TYPE_RE, "");
  const features = [...condition.matchAll(FEATURE_RE)];
  if (
    features.length === 0 ||
    !features.every((f) => SIZE_FEATURE_RE.test(f[1] ?? ""))
  ) {
    return null;
  }
  // Nothing but the features and `and` between them: `not`, `or` and media types stay media.
  if (!LEFTOVER_RE.test(condition.replace(FEATURE_RE, ""))) {
    return null;
  }
  return condition.trim();
};

/** A selector of the document, as the shadow root of a frame has it. */
export const frameSelector = (selector: string): string => {
  const rooted = selector
    .replace(ROOT_RE, (_, before: string, own: string) =>
      own ? `${before}:host(${own})` : `${before}:host`
    )
    .replace(BODY_RE, (_, before: string) => `${before}[${BODY_ATTRIBUTE}]`);
  // `*` matches every element of the frame but not the host, which the root's variables are
  // declared on now: what a stylesheet declares on everything, the host gets too.
  return rooted.split(",").some((part) => part.trim() === "*")
    ? `${rooted}, :host`
    : rooted;
};

/** Declarations, with the window's units as the frame's. */
export const frameDeclarations = (text: string): string =>
  text.replace(
    VIEWPORT_UNIT_RE,
    (_, n: string, axis: string) => `${n}cq${axis}`
  );

const isFontFace = (rule: CSSRule) =>
  typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule;
const isProperty = (rule: CSSRule) =>
  typeof CSSPropertyRule !== "undefined" && rule instanceof CSSPropertyRule;
const isStyle = (rule: CSSRule): rule is CSSStyleRule =>
  typeof CSSStyleRule !== "undefined" && rule instanceof CSSStyleRule;
const isMedia = (rule: CSSRule): rule is CSSMediaRule =>
  typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule;
const isImport = (rule: CSSRule) =>
  typeof CSSImportRule !== "undefined" && rule instanceof CSSImportRule;

/** Rules with rules inside: `@layer`, `@supports`, `@container`, keyframes, nested styles. */
const childRules = (rule: CSSRule): CSSRuleList | null =>
  "cssRules" in rule ? (rule as CSSGroupingRule).cssRules : null;

/** Declarations that come after nested rules (`CSSNestedDeclarations`). */
const isNestedDeclarations = (rule: CSSRule) =>
  !("selectorText" in rule) && "style" in rule && !("keyText" in rule);

const writeRules = (rules: CSSRuleList, lifted: string[]): string => {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    out.push(writeRule(rule, lifted));
  }
  return out.join("\n");
};

const writeRule = (rule: CSSRule, lifted: string[]): string => {
  if (isFontFace(rule) || isProperty(rule)) {
    lifted.push(rule.cssText);
    return "";
  }
  if (isImport(rule)) {
    return "";
  }
  if (isStyle(rule)) {
    const nested = rule.cssRules?.length
      ? `\n${writeRules(rule.cssRules, lifted)}\n`
      : "";
    return `${frameSelector(rule.selectorText)} { ${frameDeclarations(rule.style.cssText)}${nested} }`;
  }
  if (isMedia(rule)) {
    const media = rule.media.mediaText;
    const container = containerCondition(media);
    const prelude = container
      ? `@container ${FRAME_CONTAINER} ${container}`
      : `@media ${media}`;
    return `${prelude} {\n${writeRules(rule.cssRules, lifted)}\n}`;
  }
  const children = childRules(rule);
  if (children) {
    const text = rule.cssText;
    const prelude = text.slice(0, text.indexOf("{")).trim();
    return `${prelude} {\n${writeRules(children, lifted)}\n}`;
  }
  if (isNestedDeclarations(rule)) {
    return frameDeclarations((rule as CSSStyleRule).style.cssText);
  }
  return frameDeclarations(rule.cssText);
};

/** A stylesheet of the page, as a frame of the editor's page adopts it. */
export const frameCss = (text: string): FrameCss => {
  const imports: string[] = [];
  // A constructable stylesheet takes no `@import`: another site's (a web font's) goes to the
  // document; the page's own were inlined by its bundler already.
  const body = text.replace(IMPORT_RE, (statement, _quote, url: string) => {
    if (ABSOLUTE_URL_RE.test(url)) {
      imports.push(statement);
    }
    return "";
  });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(body);
  const lifted: string[] = [];
  const frame = writeRules(sheet.cssRules, lifted);
  return { document: [...imports, ...lifted].join("\n"), frame };
};
