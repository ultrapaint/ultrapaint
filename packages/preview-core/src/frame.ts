/**
 * The preview in the editor's own page (ADR 0034). The repository's components are loaded once,
 * by the generated entry, and every frame of the canvas is a shadow root drawn with them: no
 * iframe, no document of its own, no message to wait for. What the iframe's runtime answered
 * over `postMessage` (where things are, what is under a point, a picture) a frame answers when
 * asked, from the DOM as it is.
 *
 * A frame's coordinates are the page's own pixels, as they were in an iframe: the canvas's zoom
 * and where the frame is on the screen are taken out of everything it measures.
 */

import {
  makeStyleContext,
  pageDefaultsStyle,
} from "@ultrapaint/design-document/css";
import type {
  FrameEvents,
  FrameRect,
  FrameRuntime,
  Mounted,
  MountFrameOptions,
  Preview,
  PreviewSetup,
  RenderRequest,
  RenderSetup,
} from "@ultrapaint/framework-api/browser";
import { toCanvas, toPng } from "html-to-image";
import { chainAt, directText, elementsOf, unionRect } from "./dom.ts";
import { BODY_ATTRIBUTE } from "./frame-css.ts";
import { elementAt, type HitScope } from "./hit.ts";
import { frameMedia } from "./media.ts";
import { routePortals } from "./portals.ts";
import { publicUrlOf } from "./public-url.ts";
import { guardFrame, installGuards, onStrayError } from "./sandbox.ts";
import {
  adoptedSheets,
  frameSheets,
  installHooks,
  setDesignCss,
} from "./styles.ts";
import { readTokens } from "./tokens.ts";

const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const LEADING_DOT_SLASH_RE = /^\.\//;
const SKELETON_ATTRIBUTE = "data-ed-skeleton";
const INERT = "inert";

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

/** Events that say which frame the user is working in: where a popup it opens belongs. */
const ACTIVITY = ["pointerdown", "keydown", "focusin"] as const;

/** The frame that last drew or took input: where a popup the page opens goes. */
let activeFrame: Element | null = null;

/** How often a frame whose code keeps running is told again. */
const RUNNING_EVERY_MS = 200;
const runningListeners = new Set<(frame: string) => void>();
let running: { at: number; frame: string } | null = null;

/** `frame`'s page code runs: told when it changes, and again now and then while it does. */
const tellRunning = (frame: string) => {
  const now = performance.now();
  if (running?.frame === frame && now - running.at < RUNNING_EVERY_MS) {
    return;
  }
  running = { at: now, frame };
  for (const listener of runningListeners) {
    listener(frame);
  }
};

/**
 * The repository's components, ready to draw frames in the editor's page. Called once by the
 * generated entry, with the registry, the providers and where the preview's server is.
 */
export const createPreview = (input: PreviewSetup): Preview => {
  installHooks();
  let { components } = input;
  const frames = new Set<{
    events: FrameEvents;
    mounted: Mounted;
  }>();
  const previewBase = new URL(input.designsRoot, location.href).pathname.split(
    "@fs"
  )[0] as string;
  routePortals(previewBase, () => activeFrame);
  installGuards();

  const preview: Preview = {
    mountFrame: (host, options) => {
      const frame = mountFrame(host, options, input, components);
      const entry = { events: options.events, mounted: frame.mounted };
      frames.add(entry);
      return {
        ...frame.runtime,
        unmount: () => {
          frames.delete(entry);
          frame.runtime.unmount();
        },
      };
    },
    notifyHmr: () => {
      for (const frame of frames) {
        frame.events.hmr?.();
      }
    },
    onRunning: (listener) => {
      runningListeners.add(listener);
      return () => {
        runningListeners.delete(listener);
      };
    },
    onStrayError,
    reportError: (error) => {
      for (const frame of frames) {
        frame.events.error?.(error);
      }
    },
    setComponents: (next) => {
      components = next;
      for (const frame of frames) {
        frame.mounted.setComponents(next);
      }
    },
  };
  // The registry module, rewritten as components are catalogued, hands itself over here.
  (window as unknown as { __ED__: Pick<Preview, "setComponents"> }).__ED__ = {
    setComponents: preview.setComponents,
  };
  return preview;
};

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

/**
 * What the canvas draws every page in, on the frame's body, as an application sets it on its
 * root: popups the page opens are inside it too.
 */
const applyDefaults = (
  body: HTMLElement,
  request: RenderRequest,
  theme: string
) => {
  const { defaults } = request;
  const shown = defaults?.theme ?? theme;
  body.setAttribute("data-theme", shown);
  // `dark` is a class to Tailwind, any other theme its `data-theme`: both are set.
  body.className = defaults?.theme ?? "";
  body.removeAttribute("style");
  if (defaults) {
    Object.assign(
      body.style,
      pageDefaultsStyle(defaults, makeStyleContext(request.designSystem))
    );
  }
};

const mountFrame = (
  host: HTMLElement,
  options: MountFrameOptions,
  input: PreviewSetup,
  components: PreviewSetup["components"]
): { mounted: Mounted; runtime: FrameRuntime } => {
  const { events } = options;
  const { body, root: canvas, shadow } = buildFrame(host, input.theme);
  if (options.still) {
    host.setAttribute("data-ed-still", "");
  }
  const media = frameMedia(host, shadow);
  const sandbox = guardFrame({
    asking: () => {
      media.asking();
      tellRunning(options.frame);
    },
    error: (error) => events.error?.(error),
    host,
    interactive: () => interactive,
    navigate: (route, replace) => events.navigateTo?.(route, replace),
    still: options.still,
  });
  /** The frame is drawing or took input: what its code asks of the window is about it. */
  const asking = () => {
    media.asking();
    sandbox.asking();
    tellRunning(options.frame);
  };

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

  const publicUrl = publicUrlOf(input.publicFiles);
  const assetUrl = (src: string) => {
    if (ABSOLUTE_URL_RE.test(src)) {
      return publicUrl(src);
    }
    const file = src.replace(LEADING_DOT_SLASH_RE, "");
    if (options.canvas) {
      const query = new URLSearchParams({ canvas: options.canvas, src: file });
      return `${input.assets}?${query.toString()}`;
    }
    return `${input.designsRoot}/${file}`;
  };

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

  const setup: RenderSetup = {
    assetUrl,
    components,
    drawing: asking,
    navigate: (route) => events.navigateTo?.(route, false),
    onRendered: (renderId) => {
      applySkeletons();
      events.rendered?.(renderId);
      scheduleRects();
      requestAnimationFrame(sendSize);
    },
    pageHeight: "100cqh",
    providers: input.providers,
    publicUrl,
    reportError: (error) => events.error?.(error),
    reportInstances: (instances) => events.instances?.(instances),
    setDesignCss,
  };
  const mounted = input.mount(setup, canvas);
  const resize = new ResizeObserver(sendSize);
  resize.observe(canvas);

  const render = (request: RenderRequest) => {
    if (editing) {
      finishTextEdit(false);
    }
    activeFrame = body;
    applyDefaults(body, request, input.theme);
    fill = request.root?.width === "fill";
    applyMode(request.mode);
    mounted.render(request);
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
  let interactive = false;
  const setInert = () => {
    if (interactive || editing) {
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
      }
      const { target } = e;
      if (target instanceof Node && editing?.el.contains(target)) {
        e.stopImmediatePropagation();
        return;
      }
    }
    if (interactive) {
      reportPress(e);
      return;
    }
    e.stopImmediatePropagation();
    if (e.cancelable) {
      e.preventDefault();
    }
  };
  const activity = () => {
    activeFrame = body;
    asking();
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
  for (const type of ACTIVITY) {
    shadow.addEventListener(type, activity, true);
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
    setInteractive: (next) => {
      if (editing && !next) {
        finishTextEdit(true);
      }
      interactive = next;
      setInert();
    },
    skeleton: (nodeIds) => {
      skeletons = [...nodeIds];
      applySkeletons();
    },
    tokens: (prefixes) => readTokens(prefixes, adoptedSheets(), body),
    unmount: () => {
      finishTextEdit(false);
      mo.disconnect();
      resize.disconnect();
      hostResize.disconnect();
      media.unmount();
      sandbox.unmount();
      host.removeEventListener("scroll", scheduleRects);
      mounted.unmount();
      shadow.replaceChildren();
      if (activeFrame === body) {
        activeFrame = null;
      }
    },
    watchRects: (nodeIds) => {
      watched = [...nodeIds];
      rectsSent = "";
      scheduleRects();
    },
  };
  return { mounted, runtime };
};
