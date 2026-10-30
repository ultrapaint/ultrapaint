/**
 * The frames of the editor's own page (ADR 0034, 0040). Every frame of the canvas is a shadow
 * root, drawn by the editor's renderer with the editor's system components: no iframe, no document of
 * its own, no message to wait for, and nothing of the repository's running. What a frame is asked
 * (where things are, what is under a point, a picture) it answers from the DOM as it is.
 *
 * A frame's coordinates are the page's own pixels: the canvas's zoom and where the frame is on the
 * screen are taken out of everything it measures.
 */

import {
  makeStyleContext,
  pageDefaultsStyle,
} from "@ultrapaint/design-document/css";
import { toCanvas, toPng } from "html-to-image";
import { chainAt, directText, elementsOf, unionRect } from "./dom.ts";
import { showHost, writeClasses, writeStyle } from "./frame-host.ts";
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
  frameSheets,
  ownDesignSheet,
  setComponentsCss,
  setDesignCss,
} from "./styles.ts";
import { readTokens } from "./tokens.ts";

const SKELETON_ATTRIBUTE = "data-ed-skeleton";
/** A frame's host, marked with the frame's name. */
const FRAME_HOST_ATTRIBUTE = "data-ed-frame-host";
/** A frame's host once its page has drawn: what it shows is the page's, not a blank. */
const DRAWN_ATTRIBUTE = "data-ed-drawn";
const INERT = "inert";
/** On a frame's body while it runs. */
const LIVE = "data-ed-live";

/** Wider than this, a crop is drawn at the page's own resolution rather than doubled. */
const SHARP_CROP_WIDTH = 800;

/**
 * Every image of a canvas is one URL told apart by its query, and html-to-image caches what it
 * fetched by the URL without its query unless told otherwise.
 */
const PICTURE_OPTIONS = { cacheBust: true, includeQueryParams: true };

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
        frame.relook();
      }
    },
  };
};

/** A frame as the preview keeps it. */
interface MountedFrame {
  /** Draws its last request again with the preview's look, unless it has one of its own. */
  readonly relook: () => void;
  readonly runtime: FrameRuntime;
}

/** The frame's body and root elements, as an iframe's document would have them. */
const buildFrame = (host: HTMLElement, theme: string) => {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  shadow.adoptedStyleSheets = frameSheets();
  host.setAttribute("data-theme", theme);
  const body = document.createElement("div");
  body.setAttribute(BODY_ATTRIBUTE, "");
  body.setAttribute("data-theme", theme);
  const root = document.createElement("div");
  root.id = "root";
  body.append(root);
  shadow.append(body);
  return { body, root, shadow };
};

const SPACE_RE = /\s+/;

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
  body.setAttribute("data-theme", defaults?.theme ?? theme);
  // `dark` is a class to Tailwind, any other theme its `data-theme`: both are set.
  writeClasses(body, (defaults?.theme ?? "").split(SPACE_RE).filter(Boolean));
  writeStyle(
    body,
    defaults
      ? pageDefaultsStyle(defaults, makeStyleContext(request.designSystem))
      : {}
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
    host.setAttribute("data-ed-still", "");
  }
  let shown: FrameShown = { ...NOT_SHOWN, ...options.shown };
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

  let lastSize = { height: -1, width: -1 };
  const sendSize = () => {
    if (mode !== "fit") {
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
      host.setAttribute("data-ed-fit", "");
      canvas.style.width = fill ? "100%" : "max-content";
      canvas.style.minHeight = "0";
      canvas.style.display = "block";
    } else {
      host.removeAttribute("data-ed-fit");
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
  /** The look given with a request, in a stylesheet of the frame's own. */
  let own: { readonly look: Look; readonly sheet: CSSStyleSheet } | null = null;
  /** The stylesheet given with a request besides the look (a board's). */
  let extra: { readonly css: string; readonly sheet: CSSStyleSheet } | null =
    null;
  const adopt = (look: Look | undefined, css: string | undefined) => {
    if (look === own?.look && css === extra?.css) {
      return;
    }
    if (look !== own?.look) {
      own = look ? { look, sheet: ownDesignSheet(look.css) } : null;
    }
    if (css !== extra?.css) {
      extra = css ? { css, sheet: ownDesignSheet(css) } : null;
    }
    shadow.adoptedStyleSheets = frameSheets(own?.sheet, extra?.sheet);
  };
  const render = (request: RenderRequest) => {
    if (editing) {
      finishTextEdit(false);
    }
    last = request;
    adopt(request.look, request.css);
    applyDefaults(body, request, input.theme);
    fill = request.root?.width === "fill";
    applyMode(request.mode);
    const { css: _css, look: _look, ...drawing } = request;
    mounted.render({
      ...drawing,
      components: (request.look ?? previewLook()).components,
    });
  };
  const relook = () => {
    if (last && !last.look) {
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
    if (watched.length === 0 || !events.rects) {
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
    // What a pointer does shows only in a frame that runs (the system components' look, ADR 0040).
    body.toggleAttribute(LIVE, shown.interactive);
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
  let editing: {
    el: HTMLElement;
    nodeId: string;
    onBlur: () => void;
    original: string;
  } | null = null;

  const finishTextEdit = (commit: boolean) => {
    if (!editing) {
      return;
    }
    const { el, nodeId, onBlur, original } = editing;
    el.removeEventListener("blur", onBlur);
    editing = null;
    setInert();
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
    const text = el.textContent ?? "";
    if (commit && text !== original) {
      events.textCommit?.(nodeId, text);
    } else {
      el.textContent = original;
    }
  };

  const editKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishTextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishTextEdit(false);
    }
  };

  const startTextEdit = (nodeId: string) => {
    const el = elementsOf(nodeId, shadow)[0] as HTMLElement | undefined;
    if (!el || directText(el) === null) {
      return;
    }
    if (editing) {
      finishTextEdit(false);
    }
    const onBlur = () => finishTextEdit(true);
    editing = { el, nodeId, onBlur, original: el.textContent ?? "" };
    setInert();
    el.contentEditable = "plaintext-only";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    el.addEventListener("blur", onBlur, { once: true });
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
  for (const type of GUARDED) {
    shadow.addEventListener(type, guard, true);
  }
  shadow.addEventListener("click", interceptLinks);
  setInert();

  // ---- Pictures ----
  const capture = async (nodeId: string | undefined) => {
    const target = mode === "fit" ? canvas : body;
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

  const runtime: FrameRuntime = {
    editText: startTextEdit,
    hitTest: (x, y) => {
      const at = placement();
      const el = unobserved(() =>
        elementAt(at.left + x * at.zoom, at.top + y * at.zoom, scope)
      );
      return chainAt(el);
    },
    measure,
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
      showHost(host, shown);
      setInert();
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
    tokens: (prefixes) =>
      readTokens(prefixes, shadow.adoptedStyleSheets.slice(1), body),
    unmount: () => {
      finishTextEdit(false);
      mo.disconnect();
      resize.disconnect();
      hostResize.disconnect();
      host.removeEventListener("scroll", scheduleRects);
      mounted.unmount();
      shadow.replaceChildren();
    },
    watchRects: (nodeIds) => {
      watched = [...nodeIds];
      rectsSent = "";
      scheduleRects();
    },
  };
  return { relook, runtime };
};
