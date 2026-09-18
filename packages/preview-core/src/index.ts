/**
 * The framework-neutral half of the preview runtime, injected into every page iframe. It
 * speaks the editor's protocol (`@ultrapaint/contracts/preview`) over `postMessage` and works
 * on the DOM alone: hit-testing, rectangles, style provenance, inline text editing, tokens and
 * screenshots. Whatever needs the framework's component tree is asked of the renderer's
 * `Introspector`.
 */
import type {
  Introspector,
  PreviewGlobal,
} from "@ultrapaint/framework-api/browser";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";
import { toPng } from "html-to-image";
import { directText, parseStamp, STAMP, unionRect } from "./dom.ts";
import { elementAt } from "./hit.ts";
import { makeRouter } from "./router.ts";
import { inspectStyles, invalidateRules, readTokens } from "./styles.ts";

interface Config {
  designsDir: string;
  /** What this iframe is to the editor: a page on the canvas, a space in the prototype. */
  frame: string;
  /** Route the editor opened the preview at. */
  route: string;
  /** Space whose pages this preview may show. */
  space: string;
}

export const startPreview = (introspector: Introspector) => {
  const config: Config = (window as unknown as { __ED_CONFIG__?: Config })
    .__ED_CONFIG__ ?? { designsDir: "", frame: "", route: "/", space: "" };

  // ---- Messaging ----
  // Every message carries the frame id so the editor can route it without relying on window
  // identity, which changes when the host restarts on another port.
  const post = (msg: Record<string, unknown>) => {
    window.parent.postMessage({ ...msg, frame: config.frame }, "*");
  };

  const router = makeRouter({
    post,
    reportError: (error) => post({ error, type: "ed:error" }),
    route: config.route,
    space: config.space,
    standalone: window.parent === window,
  });

  const sendTree = () => {
    const children = introspector.tree();
    if (!children) {
      return;
    }
    const name = router.state().route;
    post({
      tree: {
        children,
        editable: false,
        id: "root",
        kind: "element",
        name,
        source: null,
        summary: name,
      },
      type: "ed:tree",
    });
  };

  let watched: string[] = [];
  let rectsScheduled = false;
  const sendRects = () => {
    rectsScheduled = false;
    if (watched.length === 0) {
      return;
    }
    const rects: Record<string, ReturnType<typeof unionRect>> = {};
    for (const id of watched) {
      const els = introspector.elementsOf(id);
      if (els.length > 0) {
        rects[id] = unionRect(els);
      }
    }
    post({ rects, type: "ed:rects" });
  };
  const scheduleRects = () => {
    if (rectsScheduled) {
      return;
    }
    rectsScheduled = true;
    requestAnimationFrame(sendRects);
  };

  let commitScheduled = false;
  const scheduleAfterCommit = () => {
    if (commitScheduled) {
      return;
    }
    commitScheduled = true;
    queueMicrotask(() => {
      commitScheduled = false;
      sendTree();
      scheduleRects();
    });
  };

  introspector.install({
    isEditable: (source) =>
      !!source &&
      config.designsDir !== "" &&
      source.file.startsWith(`${config.designsDir}/`),
    onCommit: scheduleAfterCommit,
    parseStamp,
    stampAttribute: STAMP,
  });

  // ---- Inspection ----
  const inspect = (nodeId: string) => {
    const facts = introspector.describe(nodeId);
    const els = introspector.elementsOf(nodeId);
    const [el] = els;
    if (!(facts && el)) {
      return null;
    }
    return {
      classes: Array.from(el.classList),
      editable: facts.editable,
      editableAncestor: facts.editableAncestor,
      kind: facts.kind,
      name: facts.name,
      nodeId,
      ownClasses: facts.ownClasses,
      props: facts.props,
      rect: unionRect(els),
      source: facts.source,
      styles: inspectStyles(el, facts.ownClasses, facts.editable),
      text: facts.kind === "element" ? directText(el) : facts.text,
    };
  };

  // ---- Interaction guard ----
  // Select mode blocks pointer events on the iframe from the editor side, but that is only half
  // of it: an element focused earlier still answers the keyboard, and the click the browser
  // synthesises from Enter or Space still runs the component's handlers — enough to open a
  // select and leave it hanging over a canvas that cannot close it. Everything the screen could
  // respond to is stopped here unless the editor put the canvas in interact mode. A preview
  // opened on its own (no editor around it) stays interactive.
  let interactive = window.parent === window;

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

  // Focus is deliberately left where it is when interact mode ends. A dropdown opened in
  // interact mode should still be there to be measured and restyled after the switch back to
  // select, and taking focus off it is one of the things that closes it. The guard above is
  // what keeps it from answering, so nothing is gained by moving focus as well.
  const setInteractive = (next: boolean) => {
    interactive = next;
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

  /** Enter commits, Escape reverts. Called from the guard, which owns the keyboard. */
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
    const el = introspector.elementsOf(nodeId)[0] as HTMLElement | undefined;
    if (!el) {
      return;
    }
    // Only an element that holds text and nothing else. Making one with element children
    // editable lets a keystroke delete a child React still believes it owns — the chevron of a
    // select, an icon inside a button — and the next render throws on the missing node.
    if (directText(el) === null) {
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
   * pair as the screen having moved. `disconnect` empties the record queue, and nothing else
   * runs in between.
   */
  const unobserved = <T>(f: () => T): T => {
    mo.disconnect();
    try {
      return f();
    } finally {
      observe();
    }
  };

  // ---- Handlers ----
  window.addEventListener("message", (ev) => {
    const msg = ev.data as ({ type?: string } & Record<string, unknown>) | null;
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("ed:")) {
      return;
    }
    switch (msg.type) {
      case "ed:getTree":
        sendTree();
        break;
      case "ed:hitTest": {
        // The lookup lifts `inert` off the page for an instant; our own observer would read
        // that as the screen changing and ask for rects on every hover.
        const el = unobserved(() =>
          elementAt(msg.x as number, msg.y as number)
        );
        post({
          nodeIds: el ? introspector.chainAt(el) : [],
          requestId: msg.requestId,
          type: "ed:hit",
        });
        break;
      }
      case "ed:inspect":
        post({
          requestId: msg.requestId,
          result: inspect(msg.nodeId as string),
          type: "ed:inspect",
        });
        break;
      case "ed:watchRects":
        watched = msg.nodeIds as string[];
        scheduleRects();
        break;
      case "ed:editText":
        startTextEdit(msg.nodeId as string);
        break;
      case "ed:setInteractive":
        if (editing && !msg.interactive) {
          finishTextEdit(true);
        }
        setInteractive(Boolean(msg.interactive));
        break;
      case "ed:scrollIntoView":
        introspector
          .elementsOf(msg.nodeId as string)[0]
          ?.scrollIntoView({ block: "nearest" });
        break;
      case "ed:screenshot":
        toPng(document.body, { cacheBust: true, pixelRatio: 1 })
          .then((dataUrl) =>
            post({ dataUrl, requestId: msg.requestId, type: "ed:screenshot" })
          )
          .catch(() =>
            post({
              dataUrl: null,
              requestId: msg.requestId,
              type: "ed:screenshot",
            })
          );
        break;
      case "ed:route":
        router.setRoute(msg.route as string);
        break;
      case "ed:getTokens":
        post({ tokens: readTokens(), type: "ed:tokens" });
        break;
      default:
        break;
    }
  });

  // ---- Observers ----
  const mo = new MutationObserver(() => {
    invalidateRules();
    scheduleRects();
  });
  const observe = () =>
    mo.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  /**
   * A plain `<a href="/pricing">` is a navigation too. Left alone it would load the preview's
   * own root into the iframe and take the runtime with it. The navigation module prevents the
   * default itself, so this only ever sees links written without it. Bubble phase: in select
   * mode the guard has already stopped the event in capture.
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
    if (url.origin !== location.origin || url.pathname === location.pathname) {
      return;
    }
    e.preventDefault();
    router.navigate(url.pathname);
  };

  const start = () => {
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
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Public surface for the generated entry module (HMR notifications, render errors).
  const surface: PreviewGlobal = {
    notifyHmr() {
      invalidateRules();
      post({ type: "ed:hmr" });
      scheduleAfterCommit();
    },
    reportError(error) {
      post({ error, type: "ed:error" });
    },
    showMessage(canvas, message) {
      const box = document.createElement("pre");
      box.textContent = message;
      box.setAttribute(
        "style",
        "padding:16px;color:#b00020;white-space:pre-wrap;font:12px ui-monospace,monospace"
      );
      canvas.replaceChildren(box);
    },
    startRouter(input) {
      router.start(input);
    },
  };
  (window as unknown as { __ED__: PreviewGlobal }).__ED__ = surface;
};
