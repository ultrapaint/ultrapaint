/**
 * The frames of the editor's own page (ADR 0034, 0040). Every frame of the canvas is a shadow
 * root, drawn by the editor's renderer with the editor's system components: no iframe, no document of
 * its own, no message to wait for, and nothing of the repository's running. What a frame is asked
 * (where things are, what is under a point, a picture) it answers from the DOM as it is.
 *
 * A frame's coordinates are the page's own pixels: the canvas's zoom and where the frame is on the
 * screen are taken out of everything it measures.
 */

import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { TextRun } from "@ultrapaint/contracts/document";
import { themeWord } from "@ultrapaint/contracts/themes";
import {
  makeStyleContext,
  pageDefaultsStyle,
  type StyleContext,
} from "@ultrapaint/design-document/css";
import {
  hasRuns,
  runsOf,
  setOverRuns,
  settleRuns,
  spliceOf,
  spliceRuns,
  underlinedThrough,
} from "@ultrapaint/design-document/text-runs";
import { findNode, sameJson } from "@ultrapaint/design-document/tree";
import { toCanvas, toPng } from "html-to-image";
import {
  chainAt,
  directText,
  elementsOf,
  pageChainAt,
  unionRect,
} from "./dom.ts";
import { clearHost, showHost, writeClasses, writeStyle } from "./frame-host.ts";
import { elementAt, type HitScope } from "./hit.ts";
import type {
  FrameRect,
  FrameRuntime,
  FrameShown,
  Look,
  Mounted,
  MountFrameOptions,
  Preview,
  PreviewSetup,
  RenderRequest,
  RenderToCanvas,
} from "./preview.ts";
import { renderSetup } from "./render-setup.ts";
import {
  BODY_ATTRIBUTE,
  frameSheet,
  frameSheets,
  setComponentsCss,
  setDesignCss,
} from "./styles.ts";
import { drawRuns, rangeOf, selectedIn, selectWords } from "./words.ts";

const SKELETON_ATTRIBUTE = "data-ed-skeleton";
/** A frame's host, marked with the frame's name. */
const FRAME_HOST_ATTRIBUTE = "data-ed-frame-host";
/** A frame's host once its page has drawn: what it shows is the page's, not a blank. */
const DRAWN_ATTRIBUTE = "data-ed-drawn";
/** A frame's host while it is as big as what it draws (`fit`). */
const FIT_ATTRIBUTE = "data-ed-fit";
/** A frame's host that draws at once, without transitions. */
const STILL_ATTRIBUTE = "data-ed-still";
const THEME_ATTRIBUTE = "data-theme";
/** What a frame marks its host with, taken off again when it is unmounted. */
const HOST_MARKS = [
  FRAME_HOST_ATTRIBUTE,
  DRAWN_ATTRIBUTE,
  FIT_ATTRIBUTE,
  STILL_ATTRIBUTE,
  THEME_ATTRIBUTE,
];
const INERT = "inert";

/** A text's cut to its lines taken away: every line (`lines: "all"`). */
const UNCUT: Readonly<Record<string, string>> = {
  "-webkit-line-clamp": "unset",
  overflow: "visible",
  "text-overflow": "clip",
};
const WHOLE_RE = /^\d+$/;

/** Wider than this, a crop is drawn at the page's own resolution rather than doubled. */
const SHARP_CROP_WIDTH = 800;

/**
 * Every image of a canvas is one URL told apart by its query, and html-to-image caches what it
 * fetched by the URL without its query unless told otherwise. An image it cannot fetch (a server
 * that sends no CORS header, as avatar services often do) draws as a grey placeholder: without
 * one, that image failed the whole picture, and every `get_screenshot` of its page.
 */
const PICTURE_OPTIONS = {
  cacheBust: true,
  imagePlaceholder:
    "data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  includeQueryParams: true,
};

/**
 * html-to-image copies an element's computed style but not its `::placeholder`, so an empty
 * field's placeholder was pictured in the field's text colour: every picture showed it as if
 * typed. While a picture is taken, an empty field takes its placeholder's colour as its own (the
 * placeholder is the only text it shows); the function returned puts each one back.
 */
const showPlaceholders = (
  roots: readonly (ParentNode | null | undefined)[]
): (() => void) => {
  const changed: { el: HTMLElement; color: string; priority: string }[] = [];
  for (const root of roots) {
    for (const el of root?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[placeholder], textarea[placeholder]") ?? []) {
      if (el.value !== "") {
        continue;
      }
      const { color } = getComputedStyle(el, "::placeholder");
      changed.push({
        color: el.style.getPropertyValue("color"),
        el,
        priority: el.style.getPropertyPriority("color"),
      });
      el.style.setProperty("color", color, "important");
    }
  }
  return () => {
    for (const { color, el, priority } of changed) {
      if (color === "") {
        el.style.removeProperty("color");
      } else {
        el.style.setProperty("color", color, priority);
      }
    }
  };
};

/** Events a frame stops while it is a picture or an element of it is being edited. */
const GUARDED = [
  "auxclick",
  "beforeinput",
  "change",
  "click",
  "contextmenu",
  "dblclick",
  "dragstart",
  "drop",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "submit",
] as const;

/** The editor's frames, drawn with `render`; created once, by the editor's page. */
export const createPreview = (
  render: RenderToCanvas,
  input: PreviewSetup
): Preview => {
  if (input.css) {
    setComponentsCss(input.css);
  }
  /** The hosts of the mounted frames: an event with one on its path is from a frame. */
  const hosts = new Set<EventTarget>();
  /** The mounted frames, each drawn again when the look changes. */
  const frames = new Set<MountedFrame>();
  let look: Look = { components: [], css: "" };
  return {
    fromFrame: (event) =>
      event.composedPath().some((target) => hosts.has(target)),
    mountFrame: (host, options) => {
      const frame = mountFrame(host, options, render, input, () => look);
      hosts.add(host);
      frames.add(frame);
      return {
        ...frame.runtime,
        unmount: () => {
          hosts.delete(host);
          frames.delete(frame);
          frame.runtime.unmount();
        },
      };
    },
    setLook: (next) => {
      if (next === look) {
        return;
      }
      look = next;
      setDesignCss(next.css);
      for (const frame of frames) {
        frame.redraw();
      }
    },
  };
};

/** A frame as the preview keeps it. */
interface MountedFrame {
  /** Draws its last request again, with the preview's look as it is now. */
  readonly redraw: () => void;
  readonly runtime: FrameRuntime;
}

/** The frame's body and root elements, as an iframe's document would have them. */
const buildFrame = (host: HTMLElement, theme: string) => {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  shadow.adoptedStyleSheets = frameSheets();
  host.setAttribute(THEME_ATTRIBUTE, themeWord(theme));
  const body = document.createElement("div");
  body.setAttribute(BODY_ATTRIBUTE, "");
  body.setAttribute(THEME_ATTRIBUTE, themeWord(theme));
  const root = document.createElement("div");
  root.id = "root";
  body.append(root);
  shadow.append(body);
  return { body, root, shadow };
};

/**
 * Each design system's style context, made once for every frame that draws in it: a frame
 * writes its page's defaults from it at every draw, and every frame draws again when the look
 * changes.
 */
const styleContexts = new WeakMap<DesignSystem, StyleContext>();
const NO_SYSTEM = makeStyleContext(null);
const stylesIn = (designSystem: DesignSystem | null): StyleContext => {
  if (!designSystem) {
    return NO_SYSTEM;
  }
  let styles = styleContexts.get(designSystem);
  if (!styles) {
    styles = makeStyleContext(designSystem);
    styleContexts.set(designSystem, styles);
  }
  return styles;
};

/**
 * What the canvas draws every page in, on the frame's body, as an application sets it on its
 * root: popups the page opens are inside it too (`frame-host.ts` writes only what changed).
 */
const applyDefaults = (
  body: HTMLElement,
  request: RenderRequest,
  theme: string
) => {
  const { defaults } = request;
  // `dark` is a class to Tailwind, any other theme its `data-theme`: both are set, to the one
  // word the theme's selector reads (`themeSelector`).
  body.setAttribute(THEME_ATTRIBUTE, themeWord(defaults?.theme ?? theme));
  const own = themeWord(defaults?.theme ?? "");
  writeClasses(body, own === "" ? [] : [own]);
  writeStyle(
    body,
    defaults ? pageDefaultsStyle(defaults, stylesIn(request.designSystem)) : {}
  );
};

/** How a frame is shown until the editor says otherwise: a picture, in view. */
const NOT_SHOWN: FrameShown = {
  away: false,
  className: "",
  interactive: false,
  style: "",
  title: "",
};

const mountFrame = (
  host: HTMLElement,
  options: MountFrameOptions,
  draw: RenderToCanvas,
  input: PreviewSetup,
  previewLook: () => Look
): MountedFrame => {
  const { events } = options;
  const { body, root: canvas, shadow } = buildFrame(host, input.theme);
  // The editor's one rule for an event from a frame is the registered frames (`fromFrame`); the
  // marks (this one, and `data-ed-drawn` once it has drawn) are what scripts and tests find a
  // frame's host by.
  host.setAttribute(FRAME_HOST_ATTRIBUTE, options.frame);
  if (options.still) {
    host.setAttribute(STILL_ATTRIBUTE, "");
  }
  let shown: FrameShown = { ...NOT_SHOWN, ...options.shown };
  /**
   * The host as the editor shows it; while a text of it is edited, it takes the pointer too, so
   * a click on that text reaches it through the editor's layer over the frame.
   */
  const showShown = () =>
    showHost(host, editing ? { ...shown, interactive: true } : shown);
  showHost(host, shown);
  // ---- Where the frame is ----
  /** The frame's place on the screen and the canvas's zoom, which its pixels are scaled by. */
  const placement = () => {
    const box = host.getBoundingClientRect();
    const zoom = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
    return { left: box.left, top: box.top, zoom: zoom || 1 };
  };
  const toFrame = (rect: FrameRect, at = placement()): FrameRect => ({
    height: rect.height / at.zoom,
    width: rect.width / at.zoom,
    x: (rect.x - at.left) / at.zoom,
    y: (rect.y - at.top) / at.zoom,
  });
  const scope: HitScope = {
    root: shadow,
    viewport: () => {
      const box = host.getBoundingClientRect();
      return { height: box.height, width: box.width };
    },
  };

  // ---- Drawing ----
  let mode: RenderRequest["mode"] = "page";
  /** Whether a `fit` render takes the frame's width, and wraps in it, rather than its own. */
  let fill = false;

  /** Unmounted: what was waiting for the next frame has nobody left to tell. */
  let unmounted = false;
  let lastSize = { height: -1, width: -1 };
  const sendSize = () => {
    if (unmounted || mode !== "fit") {
      return;
    }
    const width = Math.ceil(canvas.offsetWidth);
    const height = Math.ceil(canvas.offsetHeight);
    if (width === lastSize.width && height === lastSize.height) {
      return;
    }
    lastSize = { height, width };
    events.size?.({ height, width });
  };

  /** `fit` draws at the content's own size, so the editor can size the frame around it. */
  const applyMode = (next: RenderRequest["mode"]) => {
    mode = next;
    if (next === "fit") {
      host.setAttribute(FIT_ATTRIBUTE, "");
      canvas.style.width = fill ? "100%" : "max-content";
      canvas.style.minHeight = "0";
      canvas.style.display = "block";
    } else {
      host.removeAttribute(FIT_ATTRIBUTE);
      canvas.style.width = "";
      canvas.style.minHeight = "";
      canvas.style.display = "";
    }
  };

  /** Who hears the frame start or stop running: the system components, which run only then. */
  const interactiveListeners = new Set<() => void>();
  const setup = renderSetup(input, options, {
    frame: {
      container: body,
      host,
      interactive: () => shown.interactive,
      onInteractive: (listener) => {
        interactiveListeners.add(listener);
        return () => interactiveListeners.delete(listener);
      },
    },
    rendered: (renderId) => {
      if (!host.hasAttribute(DRAWN_ATTRIBUTE)) {
        host.setAttribute(DRAWN_ATTRIBUTE, "");
      }
      applySkeletons();
      events.rendered?.(renderId);
      scheduleRects();
      requestAnimationFrame(sendSize);
    },
  });
  const mounted: Mounted = draw(setup, canvas);
  const resize = new ResizeObserver(sendSize);
  resize.observe(canvas);

  /** The last request, drawn again when the preview's look changes. */
  let last: RenderRequest | null = null;
  /** The stylesheet given with a request after the look (a board's). */
  let extra: { readonly css: string; readonly sheet: CSSStyleSheet } | null =
    null;
  const adopt = (css: string | undefined) => {
    if (css === extra?.css) {
      return;
    }
    extra = css ? { css, sheet: frameSheet(css) } : null;
    shadow.adoptedStyleSheets = frameSheets(extra?.sheet);
  };
  const render = (request: RenderRequest) => {
    if (editing) {
      finishTextEdit(false);
    }
    last = request;
    adopt(request.css);
    applyDefaults(body, request, input.theme);
    fill = request.root?.width === "fill";
    applyMode(request.mode);
    const { css: _css, ...drawing } = request;
    mounted.render({ ...drawing, components: previewLook().components });
  };
  const redraw = () => {
    if (last) {
      render(last);
    }
  };

  // ---- Skeletons ----
  let skeletons: readonly string[] = [];
  const applySkeletons = () =>
    unobserved(() => {
      for (const el of Array.from(
        shadow.querySelectorAll(`[${SKELETON_ATTRIBUTE}]`)
      )) {
        el.removeAttribute(SKELETON_ATTRIBUTE);
      }
      for (const id of skeletons) {
        for (const el of elementsOf(id, shadow)) {
          el.setAttribute(SKELETON_ATTRIBUTE, "");
        }
      }
    });

  // ---- Rectangles ----
  let watched: readonly string[] = [];
  let rectsScheduled = false;
  let rectsSent = "";
  const measure = (ids: readonly string[]) => {
    const at = placement();
    const rects: Record<string, FrameRect> = {};
    for (const id of ids) {
      const els = elementsOf(id, shadow);
      if (els.length > 0) {
        rects[id] = toFrame(unionRect(els), at);
      }
    }
    return rects;
  };
  const sendRects = () => {
    rectsScheduled = false;
    if (unmounted || watched.length === 0 || !events.rects) {
      return;
    }
    const rects = measure(watched);
    const text = JSON.stringify(rects);
    if (text !== rectsSent) {
      rectsSent = text;
      events.rects(rects);
    }
  };
  const scheduleRects = () => {
    if (!rectsScheduled) {
      rectsScheduled = true;
      requestAnimationFrame(sendRects);
    }
  };

  // ---- Input ----
  const setInert = () => {
    if (shown.interactive || editing) {
      body.removeAttribute(INERT);
    } else {
      body.setAttribute(INERT, "");
    }
  };

  const reportPress = (e: Event) => {
    if (e.type === "click") {
      events.pressed?.(chainAt(e.target instanceof Element ? e.target : null));
    }
  };

  /**
   * A frame that is a picture is inert, which keeps focus and the pointer out of it; this stops
   * what else could reach a component while an element of it is edited.
   */
  const guard = (e: Event) => {
    if (editing) {
      if (e.type === "keydown") {
        editKey(e as KeyboardEvent);
      } else if (e.type === "input") {
        editInput();
      }
      const { target } = e;
      if (target instanceof Node && editing?.el.contains(target)) {
        e.stopImmediatePropagation();
        return;
      }
    }
    if (shown.interactive) {
      reportPress(e);
      return;
    }
    e.stopImmediatePropagation();
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  /** A plain `<a href>` a component renders is a navigation the editor decides on. */
  const interceptLinks = (e: Event) => {
    const click = e as MouseEvent;
    if (
      click.defaultPrevented ||
      click.button !== 0 ||
      click.metaKey ||
      click.ctrlKey
    ) {
      return;
    }
    const anchor = (click.target as Element | null)?.closest?.(
      "a[href]"
    ) as HTMLAnchorElement | null;
    if (
      !anchor ||
      anchor.target === "_blank" ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) {
      return;
    }
    click.preventDefault();
    events.navigateTo?.(url.pathname, false);
  };

  // ---- Inline text editing ----
  /**
   * A text cut to its lines (one line with an ellipsis, or clamped) shows every word while it is
   * edited: its cut is lifted off the element, and what lifting it changed given back by the
   * function returned.
   */
  const liftCut = (el: HTMLElement): (() => void) => {
    const clamp = el.style.getPropertyValue("-webkit-line-clamp");
    if (el.style.textOverflow !== "ellipsis" && !WHOLE_RE.test(clamp)) {
      return () => undefined;
    }
    // One line's `nowrap` back to the spaces as typed, wrapping; a clamp's own wrap is its own.
    const lifted: Record<string, string> = {
      ...UNCUT,
      ...(el.style.display === "-webkit-box" && { display: "block" }),
      ...(el.style.whiteSpace === "nowrap" && { "white-space": "pre-wrap" }),
    };
    const own = Object.keys(lifted).map(
      (p) => [p, el.style.getPropertyValue(p)] as const
    );
    for (const [p, v] of Object.entries(lifted)) {
      el.style.setProperty(p, v);
    }
    return () => {
      for (const [p, v] of own) {
        if (v === "") {
          el.style.removeProperty(p);
        } else {
          el.style.setProperty(p, v);
        }
      }
    };
  };

  let editing: {
    /** What the element held as drawn, given back when the edit is left as it was. */
    readonly drawn: readonly Node[];
    readonly el: HTMLElement;
    /** The runs it was drawn with (ADR 0163); null for a plain text. */
    readonly drawnRuns: readonly TextRun[] | null;
    readonly nodeId: string;
    readonly onBlur: () => void;
    readonly original: string;
    /** The element's own inline outline, given back when the edit ends. */
    readonly outline: string;
    /** Gives the text back the cut to its lines the edit lifted. */
    readonly recut: () => void;
    /** Its runs as the edit has changed them; null for a plain text nothing gave runs. */
    runs: TextRun[] | null;
    /** Its words as the last edit left them, which the next is told from. */
    words: string;
  } | null = null;

  /**
   * An edit the browser made to the words, mapped onto the runs from what it changed and where
   * the caret is, never from the elements it left them in (ADR 0163).
   */
  const editInput = () => {
    if (!editing) {
      return;
    }
    const after = editing.el.textContent ?? "";
    if (after === editing.words) {
      return;
    }
    if (editing.runs) {
      const caret = selectedIn(editing.el, shadow)?.end;
      const { inserted, removed, start } = spliceOf(
        editing.words,
        after,
        caret
      );
      editing.runs = spliceRuns(editing.runs, start, removed, inserted);
    }
    editing.words = after;
  };

  /** The words selected in the text edited, once something is: none for a bare caret. */
  const wordsSelected = () => {
    if (!editing) {
      return null;
    }
    editInput();
    const words = selectedIn(editing.el, shadow);
    return words && words.start < words.end ? words : null;
  };

  /** ⌘U: the words selected underlined, or no longer when every one of them is. */
  const underlineSelected = () => {
    const words = wordsSelected();
    if (!(editing && words)) {
      return;
    }
    const runs = editing.runs ?? [{ text: editing.words }];
    editing.runs = setOverRuns(runs, words, {
      underline: underlinedThrough(runs, words) ? null : true,
    });
    drawRuns(editing.el, editing.runs);
    selectWords(editing.el, words);
  };

  /** ⌘K: what was typed kept, and the editor asked where the words selected lead. */
  const linkSelected = () => {
    const words = wordsSelected();
    if (!(editing && words)) {
      return;
    }
    const drawnAt = rangeOf(editing.el, words).getBoundingClientRect();
    const { nodeId } = editing;
    finishTextEdit(true);
    events.linkWords?.(nodeId, {
      anchor: {
        height: drawnAt.height,
        width: drawnAt.width,
        x: drawnAt.x,
        y: drawnAt.y,
      },
      ...words,
    });
  };

  /**
   * Takes the browser's highlight (its text selection) out of the frame: outside an edit nothing
   * in a frame shows it, as nothing on Figma's canvas does. One elsewhere, the caret in a field
   * the person went to, is left alone.
   */
  const clearBrowserSelection = () => {
    const selection = getSelection();
    if (selection && isInFrame(selection)) {
      selection.removeAllRanges();
    }
  };

  /**
   * Whether the browser's highlight is the frame's. A browser reports one inside the shadow root
   * there, or as the host's place in its parent: Chrome and WebKit both report a highlight made
   * with the mouse that way, and WebKit every one.
   */
  const isInFrame = (selection: Selection) => {
    const anchor = selection.anchorNode;
    return (
      anchor !== null &&
      (shadow.contains(anchor) ||
        anchor.childNodes[selection.anchorOffset] === host)
    );
  };

  const finishTextEdit = (commit: boolean) => {
    if (!editing) {
      return;
    }
    editInput();
    const {
      drawn,
      el,
      drawnRuns,
      nodeId,
      onBlur,
      original,
      outline,
      recut,
      runs,
    } = editing;
    el.removeEventListener("blur", onBlur);
    editing = null;
    setInert();
    showShown();
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
    clearBrowserSelection();
    el.style.outline = outline;
    recut();
    const text = el.textContent ?? "";
    const settled = runs === null ? undefined : settleRuns(runs);
    const runsChanged = settled !== undefined && !sameJson(settled, drawnRuns);
    if (commit && (text !== original || runsChanged)) {
      // A text with runs, or given some, says them: its words alone would take them off.
      if (settled === undefined) {
        events.textCommit?.(nodeId, text);
      } else {
        events.textCommit?.(nodeId, text, settled);
      }
    } else if (drawnRuns) {
      el.replaceChildren(...drawn);
    } else {
      el.textContent = original;
    }
    events.textEditing?.(null);
  };

  const editKey = (e: KeyboardEvent) => {
    const shortcut = (e.metaKey || e.ctrlKey) && !e.altKey;
    if (shortcut && e.key.toLowerCase() === "u") {
      e.preventDefault();
      underlineSelected();
    } else if (shortcut && e.key.toLowerCase() === "k") {
      e.preventDefault();
      linkSelected();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishTextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishTextEdit(false);
    }
  };

  const startTextEdit = (nodeId: string) => {
    const el = elementsOf(nodeId, shadow)[0] as HTMLElement | undefined;
    const node = last?.root ? findNode(last.root, nodeId) : null;
    // A text with runs holds an element for each that links or is underlined (ADR 0163).
    const drawnRuns = node !== null && hasRuns(node) ? runsOf(node) : null;
    if (!el || (directText(el) === null && drawnRuns === null)) {
      return;
    }
    if (editing) {
      finishTextEdit(false);
    }
    const onBlur = () => finishTextEdit(true);
    editing = {
      drawn: drawnRuns ? [...el.childNodes].map((n) => n.cloneNode(true)) : [],
      drawnRuns,
      el,
      nodeId,
      onBlur,
      original: el.textContent ?? "",
      outline: el.style.outline,
      recut: liftCut(el),
      runs: drawnRuns ? [...drawnRuns] : null,
      words: el.textContent ?? "",
    };
    setInert();
    showShown();
    // The editor's selection outlines the text: the browser's focus ring would be a second one.
    el.style.outline = "none";
    el.contentEditable = "plaintext-only";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    el.addEventListener("blur", onBlur, { once: true });
    events.textEditing?.(nodeId);
  };

  // ---- Observers ----
  const mo = new MutationObserver(scheduleRects);
  const observe = () =>
    mo.observe(shadow, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  const unobserved = <T>(f: () => T): T => {
    mo.disconnect();
    try {
      return f();
    } finally {
      observe();
    }
  };
  observe();
  const hostResize = new ResizeObserver(scheduleRects);
  hostResize.observe(host);
  host.addEventListener("scroll", scheduleRects, { passive: true });
  // A scroll inside the page (a panel, a list) does not bubble to the host: caught on its way
  // down, so what is outlined, and the hole over a text being edited, follow it.
  shadow.addEventListener("scroll", scheduleRects, {
    capture: true,
    passive: true,
  });
  for (const type of GUARDED) {
    shadow.addEventListener(type, guard, true);
  }
  shadow.addEventListener("click", interceptLinks);
  setInert();

  // ---- Pictures ----
  const capture = async (nodeId: string | undefined) => {
    const target = mode === "fit" ? canvas : body;
    const restore = showPlaceholders([target, shadow]);
    try {
      return await captureOf(target, nodeId);
    } finally {
      restore();
    }
  };

  const captureOf = async (target: HTMLElement, nodeId: string | undefined) => {
    if (nodeId === undefined) {
      return await toPng(target, {
        ...PICTURE_OPTIONS,
        pixelRatio: mode === "fit" ? 2 : 1,
      });
    }
    const els = elementsOf(nodeId, shadow);
    if (els.length === 0) {
      return null;
    }
    const at = placement();
    const node = toFrame(unionRect(els), at);
    const origin = toFrame(target.getBoundingClientRect(), at);
    const pixelRatio = mode === "fit" || node.width <= SHARP_CROP_WIDTH ? 2 : 1;
    const whole = await toCanvas(target, { ...PICTURE_OPTIONS, pixelRatio });
    const x = Math.max(0, Math.floor((node.x - origin.x) * pixelRatio));
    const y = Math.max(0, Math.floor((node.y - origin.y) * pixelRatio));
    const width = Math.min(whole.width - x, Math.ceil(node.width * pixelRatio));
    const height = Math.min(
      whole.height - y,
      Math.ceil(node.height * pixelRatio)
    );
    if (width <= 0 || height <= 0) {
      return null;
    }
    const cut = document.createElement("canvas");
    cut.width = width;
    cut.height = height;
    cut
      .getContext("2d")
      ?.drawImage(whole, x, y, width, height, 0, 0, width, height);
    return cut.toDataURL("image/png");
  };

  /** The element drawn under a point of the frame. */
  const drawnAt = (x: number, y: number) => {
    const at = placement();
    return unobserved(() =>
      elementAt(at.left + x * at.zoom, at.top + y * at.zoom, scope)
    );
  };

  const runtime: FrameRuntime = {
    editText: startTextEdit,
    endTextEdit: () => finishTextEdit(true),
    hitTest: (x, y) => chainAt(drawnAt(x, y)),
    measure,
    pageAt: (x, y) => pageChainAt(drawnAt(x, y)),
    render,
    screenshot: (nodeId) => capture(nodeId).catch(() => null),
    scrollIntoView: (nodeId) => {
      elementsOf(nodeId, shadow)[0]?.scrollIntoView({ block: "nearest" });
    },
    show: (next) => {
      if (editing && next.interactive === false) {
        finishTextEdit(true);
      }
      const wasInteractive = shown.interactive;
      shown = { ...shown, ...next };
      showShown();
      setInert();
      if (wasInteractive && !shown.interactive) {
        // What the person selected in the running page is not left on the picture.
        clearBrowserSelection();
      }
      if (shown.interactive !== wasInteractive) {
        for (const listener of interactiveListeners) {
          listener();
        }
      }
    },
    skeleton: (nodeIds) => {
      skeletons = [...nodeIds];
      applySkeletons();
    },
    unmount: () => {
      finishTextEdit(false);
      unmounted = true;
      mo.disconnect();
      resize.disconnect();
      hostResize.disconnect();
      host.removeEventListener("scroll", scheduleRects);
      shadow.removeEventListener("scroll", scheduleRects, { capture: true });
      for (const type of GUARDED) {
        shadow.removeEventListener(type, guard, true);
      }
      shadow.removeEventListener("click", interceptLinks);
      mounted.unmount();
      // A shadow root cannot be taken off its host: it is left with nothing in it.
      shadow.replaceChildren();
      shadow.adoptedStyleSheets = [];
      for (const mark of HOST_MARKS) {
        host.removeAttribute(mark);
      }
      clearHost(host);
    },
    watchRects: (nodeIds) => {
      watched = [...nodeIds];
      rectsSent = "";
      scheduleRects();
    },
  };
  return { redraw, runtime };
};
