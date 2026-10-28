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
  installPageRuntime,
  REGISTRY_GLOBAL,
} from "@ultrapaint/contracts/page-runtime";
import {
  makeStyleContext,
  pageDefaultsStyle,
} from "@ultrapaint/design-document/css";
import type {
  FrameEvents,
  FrameRect,
  FrameRuntime,
  FrameShown,
  Mounted,
  MountFrameOptions,
  Preview,
  PreviewSetup,
  RenderRequest,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { toCanvas, toPng } from "html-to-image";
import { chainAt, directText, elementsOf, unionRect } from "./dom.ts";
import { BODY_ATTRIBUTE } from "./frame-css.ts";
import { showHost, writeClasses, writeStyle } from "./frame-host.ts";
import { elementAt, type HitScope } from "./hit.ts";
import { install, register } from "./kernel.ts";
import { renderSetup } from "./render-setup.ts";
import { onStrayError } from "./sandbox.ts";
import { adoptedSheets, frameSheets } from "./styles.ts";
import { readTokens } from "./tokens.ts";
import { frameOfEvent, onRunning } from "./turn.ts";

const SKELETON_ATTRIBUTE = "data-ed-skeleton";
/** A frame's host, marked with the frame's name. */
const FRAME_HOST_ATTRIBUTE = "data-ed-frame-host";
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

/**
 * The repository's components, ready to draw frames in the editor's page with `render`. Called
 * once by the generated entry, through the bundle's entry (`editor.ts`), with the registry, the
 * providers and where the preview's server is.
 */
export const createPreview = (
  render: RenderToCanvas,
  input: PreviewSetup
): Preview => {
  let { components } = input;
  const frames = new Set<{
    events: FrameEvents;
    mounted: Mounted;
  }>();
  const previewBase = new URL(input.designsRoot, location.href).pathname.split(
    "@fs"
  )[0] as string;
  // Whose code calls is told the same way by every guard: the base, and the editor's bundle.
  install({ base: previewBase });

  const preview: Preview = {
    fromFrame: (event) => frameOfEvent(event) !== null,
    mountFrame: (host, options) => {
      const frame = mountFrame(host, options, render, input, components);
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
    onRunning,
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
  installPageRuntime({
    [REGISTRY_GLOBAL]: { setComponents: preview.setComponents },
  });
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

const SPACE_RE = /\s+/;

/**
 * What the canvas draws every page in, on the frame's body, as an application sets it on its
 * root: popups the page opens are inside it too. They are the editor's classes and style there
 * (`frame-host.ts`): what the page's code put (a theme class, a modal's scroll lock) stays.
 */
const applyDefaults = (
  body: HTMLElement,
  request: RenderRequest,
  theme: string
) => {
  const { defaults } = request;
  body.setAttribute("data-theme", defaults?.theme ?? theme);
  // `dark` is a class to Tailwind, any other theme its `data-theme`: both are set.
  writeClasses(
    body,
    "editor",
    (defaults?.theme ?? "").split(SPACE_RE).filter(Boolean)
  );
  writeStyle(
    body,
    "editor",
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
  components: PreviewSetup["components"]
): { mounted: Mounted; runtime: FrameRuntime } => {
  const { events } = options;
  const { body, root: canvas, shadow } = buildFrame(host, input.theme);
  // The editor's one rule for an event from a frame is the registered frames (`fromFrame`); the
  // mark is what scripts and tests find a frame's host by.
  host.setAttribute(FRAME_HOST_ATTRIBUTE, options.frame);
  if (options.still) {
    host.setAttribute("data-ed-still", "");
  }
  let shown: FrameShown = { ...NOT_SHOWN, ...options.shown };
  showHost(host, shown);
  // Its turn (`turn.ts`): drawing, drawn by the editor, or taking input.
  const kernel = register({
    body,
    error: (error) => events.error?.(error),
    host,
    interactive: () => shown.interactive,
    name: options.frame,
    navigate: (route, replace) => events.navigateTo?.(route, replace),
    shadow,
    still: Boolean(options.still),
  });

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

  const setup = renderSetup(input, options, {
    components,
    drawing: kernel.ask,
    rendered: (renderId) => {
      applySkeletons();
      events.rendered?.(renderId);
      scheduleRects();
      requestAnimationFrame(sendSize);
    },
  });
  const mounted = draw(setup, canvas);
  const resize = new ResizeObserver(sendSize);
  resize.observe(canvas);

  const render = (request: RenderRequest) => {
    if (editing) {
      finishTextEdit(false);
    }
    // What the page's code asks as it draws, a popup included, is this frame's from here.
    kernel.ask();
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
  for (const type of ACTIVITY) {
    shadow.addEventListener(type, kernel.ask, true);
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
      shown = { ...shown, ...next };
      showHost(host, shown);
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
      kernel.unmount();
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
  return { mounted, runtime };
};
