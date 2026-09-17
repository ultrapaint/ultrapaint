/**
 * The framework-neutral half of the preview runtime, injected into every screen iframe. It
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
import { inspectStyles, invalidateRules, readTokens } from "./styles.ts";

interface Config {
  designsDir: string;
  screen: string;
}

export const startPreview = (introspector: Introspector) => {
  const config: Config = (window as unknown as { __ED_CONFIG__?: Config })
    .__ED_CONFIG__ ?? { designsDir: "", screen: "" };

  // ---- Messaging ----
  // Every message carries the screen id so the editor can route it without relying on window
  // identity, which changes when the host restarts on another port.
  const post = (msg: Record<string, unknown>) => {
    window.parent.postMessage({ ...msg, screen: config.screen }, "*");
  };

  const sendTree = () => {
    const children = introspector.tree();
    if (!children) {
      return;
    }
    const name = config.screen || "screen";
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

  const startTextEdit = (nodeId: string) => {
    const el = introspector.elementsOf(nodeId)[0] as HTMLElement | undefined;
    if (!el) {
      return;
    }
    if (editing) {
      finishTextEdit(false);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finishTextEdit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishTextEdit(false);
      }
    };
    const onBlur = () => finishTextEdit(true);
    editing = {
      cleanup: () => {
        el.removeEventListener("keydown", onKey);
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
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur, { once: true });
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
        const el = document.elementFromPoint(msg.x as number, msg.y as number);
        post({
          nodeId: el ? introspector.selectable(el, Boolean(msg.deepest)) : null,
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
  const start = () => {
    mo.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
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
  };
  (window as unknown as { __ED__: PreviewGlobal }).__ED__ = surface;
};
