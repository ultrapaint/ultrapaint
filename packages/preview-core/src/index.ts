/**
 * The framework-neutral half of the preview runtime, injected into every preview iframe. It
 * speaks the editor's protocol (`@ultrapaint/contracts/preview`) over `postMessage` and works on
 * the DOM alone: what to draw comes from the editor as a document, the renderer draws it, and
 * this answers where things are — hit tests, rectangles, sizes — and edits text in place.
 */
import type {
  Mounted,
  PreviewGlobal,
  RenderRequest,
  RenderSetup,
  StartInput,
} from "@ultrapaint/framework-api/browser";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";
import { toCanvas, toPng } from "html-to-image";
import { chainAt, directText, elementsOf, unionRect } from "./dom.ts";
import { elementAt } from "./hit.ts";
import { readTokens } from "./tokens.ts";

interface Config {
  /** URL of the designs directory on the dev server, `/@fs/...`. */
  designsRoot: string;
  /** What this iframe is to the editor: a frame on the canvas, the prototype, a specimen. */
  frame: string;
  /** Space whose assets relative image paths are in. */
  space: string;
}

const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const LEADING_DOT_SLASH_RE = /^\.\//;

export const startPreview = () => {
  const config: Config = (window as unknown as { __ED_CONFIG__?: Config })
    .__ED_CONFIG__ ?? { designsRoot: "", frame: "", space: "" };
  const standalone = window.parent === window;

  // ---- Messaging ----
  // Every message carries the frame id so the editor can route it without relying on window
  // identity, which changes when the host restarts on another port.
  const post = (msg: Record<string, unknown>) => {
    window.parent.postMessage({ ...msg, frame: config.frame }, "*");
  };

  // ---- Drawing ----
  let canvas: HTMLElement | null = null;
  let mounted: Mounted | null = null;
  /** A render asked for before the renderer was loaded: drawn as soon as it is. */
  let waiting: RenderRequest | null = null;
  let mode: RenderRequest["mode"] = "page";

  const assetUrl = (src: string) => {
    if (ABSOLUTE_URL_RE.test(src)) {
      return src;
    }
    const space = config.space ? `${config.space}/` : "";
    return `${config.designsRoot}/${space}${src.replace(LEADING_DOT_SLASH_RE, "")}`;
  };

  let lastSize = { height: -1, width: -1 };
  const sendSize = () => {
    if (!canvas || mode !== "fit") {
      return;
    }
    const width = Math.ceil(canvas.offsetWidth);
    const height = Math.ceil(canvas.offsetHeight);
    if (width === lastSize.width && height === lastSize.height) {
      return;
    }
    lastSize = { height, width };
    post({ height, type: "ed:size", width });
  };

  /** Whether a `fit` render takes the iframe's width, and wraps in it, rather than its own. */
  let fill = false;

  /** `fit` draws at the content's own size, so the editor can size the frame around it. */
  const applyMode = (next: RenderRequest["mode"]) => {
    mode = next;
    if (!canvas) {
      return;
    }
    if (next === "fit") {
      canvas.style.width = fill ? "100%" : "max-content";
      canvas.style.minHeight = "0";
      canvas.style.display = "block";
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    } else {
      canvas.style.width = "";
      canvas.style.minHeight = "";
      canvas.style.display = "";
      document.documentElement.style.background = "";
      document.body.style.background = "";
    }
  };

  const render = (request: RenderRequest) => {
    if (!mounted) {
      waiting = request;
      return;
    }
    if (editing) {
      finishTextEdit(false);
    }
    fill = request.root?.width === "fill";
    applyMode(request.mode);
    mounted.render(request);
  };

  const setup: RenderSetup = {
    assetUrl,
    components: {},
    navigate: (route) => {
      if (!standalone) {
        post({ replace: false, route, type: "ed:navigateTo" });
      }
    },
    onRendered: (renderId) => {
      post({ renderId, type: "ed:rendered" });
      scheduleRects();
      requestAnimationFrame(sendSize);
    },
    providers: undefined,
    reportError: (error) => post({ error, type: "ed:error" }),
    reportInstances: (instances) => post({ instances, type: "ed:instances" }),
  };

  const start = (input: StartInput) => {
    ({ canvas } = input);
    mounted = input.mount(
      { ...setup, components: input.components, providers: input.providers },
      input.canvas
    );
    new ResizeObserver(sendSize).observe(input.canvas);
    applyMode(mode);
    if (waiting) {
      const request = waiting;
      waiting = null;
      render(request);
    }
  };

  // ---- Rectangles ----
  let watched: string[] = [];
  let rectsScheduled = false;
  const measure = (ids: readonly string[]) => {
    const rects: Record<string, ReturnType<typeof unionRect>> = {};
    for (const id of ids) {
      const els = elementsOf(id);
      if (els.length > 0) {
        rects[id] = unionRect(els);
      }
    }
    return rects;
  };
  const sendRects = () => {
    rectsScheduled = false;
    if (watched.length > 0) {
      post({ rects: measure(watched), type: "ed:rects" });
    }
  };
  const scheduleRects = () => {
    if (rectsScheduled) {
      return;
    }
    rectsScheduled = true;
    requestAnimationFrame(sendRects);
  };

  // ---- Interaction guard ----
  // Select mode blocks pointer events on the iframe from the editor side, but that is only half
  // of it: an element focused earlier still answers the keyboard, and the click the browser
  // synthesises from Enter or Space still runs the component's handlers — enough to open a
  // select and leave it hanging over a canvas that cannot close it. Everything the page could
  // respond to is stopped here unless the editor put the canvas in interact mode. A preview
  // opened on its own (no editor around it) stays interactive.
  let interactive = standalone;

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

  const guard = (e: Event) => {
    if (editing) {
      if (e.type === "keydown") {
        editKey(e as KeyboardEvent);
      }
      const { target } = e;
      // Typing into the edited element must keep working, and the component under it must not
      // see any of it. Anything outside falls through to the block below.
      if (target instanceof Node && editing?.el.contains(target)) {
        e.stopImmediatePropagation();
        return;
      }
    }
    if (interactive) {
      return;
    }
    e.stopImmediatePropagation();
    if (e.cancelable) {
      // Stops what the browser itself would do: following a link, submitting a form, inserting
      // the character a keystroke would have typed into a focused field.
      e.preventDefault();
    }
  };

  // ---- Inline text editing ----
  let editing: {
    cleanup: () => void;
    el: HTMLElement;
    nodeId: string;
    original: string;
  } | null = null;

  const finishTextEdit = (commit: boolean) => {
    if (!editing) {
      return;
    }
    const { cleanup, el, nodeId, original } = editing;
    cleanup();
    editing = null;
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
    const text = el.textContent ?? "";
    if (commit && text !== original) {
      post({ nodeId, text, type: "ed:textCommit" });
    } else {
      el.textContent = original;
    }
  };

  /** Enter commits, Escape reverts; Shift+Enter is a new line. Called from the guard. */
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
    const el = elementsOf(nodeId)[0] as HTMLElement | undefined;
    // Only an element that holds text and nothing else: what a text node draws.
    if (!el || directText(el) === null) {
      return;
    }
    if (editing) {
      finishTextEdit(false);
    }
    const onBlur = () => finishTextEdit(true);
    editing = {
      cleanup: () => {
        el.removeEventListener("blur", onBlur);
      },
      el,
      nodeId,
      original: el.textContent ?? "",
    };
    el.contentEditable = "plaintext-only";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    el.addEventListener("blur", onBlur, { once: true });
  };

  /**
   * Runs something that changes the DOM and changes it back, without our observer reading the
   * pair as the page having moved. `disconnect` empties the record queue, and nothing else runs
   * in between.
   */
  const unobserved = <T>(f: () => T): T => {
    mo.disconnect();
    try {
      return f();
    } finally {
      observe();
    }
  };

  /** Wider than this, a crop is drawn at the page's own resolution rather than doubled. */
  const SHARP_CROP_WIDTH = 800;

  /**
   * A picture of what is drawn, or of one node of it in place: the whole is drawn, then cut to
   * the node, so what is behind the node and around it is as the page shows it.
   */
  const capture = async (nodeId: string | undefined) => {
    const target = mode === "fit" && canvas ? canvas : document.body;
    if (nodeId === undefined) {
      return await toPng(target, {
        cacheBust: true,
        pixelRatio: mode === "fit" ? 2 : 1,
      });
    }
    const els = elementsOf(nodeId);
    if (els.length === 0) {
      return null;
    }
    const node = unionRect(els);
    const origin = target.getBoundingClientRect();
    const pixelRatio = mode === "fit" || node.width <= SHARP_CROP_WIDTH ? 2 : 1;
    const whole = await toCanvas(target, { cacheBust: true, pixelRatio });
    const x = Math.max(0, Math.floor((node.x - origin.left) * pixelRatio));
    const y = Math.max(0, Math.floor((node.y - origin.top) * pixelRatio));
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

  const screenshot = (requestId: unknown, nodeId: string | undefined) => {
    capture(nodeId)
      .then((dataUrl) => post({ dataUrl, requestId, type: "ed:screenshot" }))
      .catch(() => post({ dataUrl: null, requestId, type: "ed:screenshot" }));
  };

  // ---- Handlers ----
  window.addEventListener("message", (ev) => {
    const msg = ev.data as ({ type?: string } & Record<string, unknown>) | null;
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("ed:")) {
      return;
    }
    switch (msg.type) {
      case "ed:render":
        render(msg as unknown as RenderRequest);
        break;
      case "ed:hitTest": {
        // The lookup lifts `inert` off the page for an instant; our own observer would read
        // that as the page changing and ask for rects on every hover.
        const el = unobserved(() =>
          elementAt(msg.x as number, msg.y as number)
        );
        post({
          nodeIds: chainAt(el),
          requestId: msg.requestId,
          type: "ed:hit",
        });
        break;
      }
      case "ed:watchRects":
        watched = msg.nodeIds as string[];
        scheduleRects();
        break;
      case "ed:measure":
        post({
          rects: measure(msg.nodeIds as string[]),
          requestId: msg.requestId,
          type: "ed:measured",
        });
        break;
      case "ed:editText":
        startTextEdit(msg.nodeId as string);
        break;
      case "ed:setInteractive":
        if (editing && !msg.interactive) {
          finishTextEdit(true);
        }
        interactive = Boolean(msg.interactive);
        break;
      case "ed:scrollIntoView":
        elementsOf(msg.nodeId as string)[0]?.scrollIntoView({
          block: "nearest",
        });
        break;
      case "ed:screenshot":
        screenshot(msg.requestId, msg.nodeId as string | undefined);
        break;
      case "ed:getTokens":
        post({
          requestId: msg.requestId,
          tokens: readTokens(msg.prefixes as string[] | undefined),
          type: "ed:tokens",
        });
        break;
      default:
        break;
    }
  });

  // ---- Observers ----
  const mo = new MutationObserver(scheduleRects);
  const observe = () =>
    mo.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

  /**
   * A plain `<a href="/pricing">` a component renders is a navigation too. Left alone it would
   * load the preview's own root into the iframe and take the runtime with it. Bubble phase: in
   * select mode the guard has already stopped the event in capture.
   */
  const interceptLinks = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) {
      return;
    }
    const anchor = (e.target as Element | null)?.closest?.(
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
    e.preventDefault();
    setup.navigate(url.pathname);
  };

  const ready = () => {
    window.addEventListener("click", interceptLinks);
    for (const type of GUARDED) {
      // Capture on the window: React listens on its root container, so this runs first and can
      // keep an event from ever reaching a component.
      window.addEventListener(type, guard, true);
    }
    observe();
    window.addEventListener("scroll", scheduleRects, true);
    window.addEventListener("resize", scheduleRects);
    new ResizeObserver(scheduleRects).observe(document.documentElement);
    window.addEventListener("error", (e) => {
      post({
        error: {
          file: e.filename,
          line: e.lineno,
          message: e.message,
          stack: e.error?.stack,
        },
        type: "ed:error",
      });
    });
    post({ protocol: PREVIEW_PROTOCOL, type: "ed:ready" });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  // Public surface for the generated modules: start, the registry, HMR and errors.
  const surface: PreviewGlobal = {
    notifyHmr() {
      post({ type: "ed:hmr" });
      scheduleRects();
    },
    reportError(error) {
      post({ error, type: "ed:error" });
    },
    setComponents(components) {
      mounted?.setComponents(components);
    },
    start,
  };
  (window as unknown as { __ED__: PreviewGlobal }).__ED__ = surface;
};
