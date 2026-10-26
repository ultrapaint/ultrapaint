# Spike: frames drawn from captures of their instances

Run on 2026-10-26 on the Linux reference machine, as Phase 6 of `docs/PLAN-editor-renderer.md`,
on top of ADR 0034 (frames in the editor's page). Not merged: main stays on drawing the
components live. The code is on the branch `experiment/captures` (e844d7f, pushed); it is copied
below so this note stands without the branch.

## What it does

After a frame draws live, what each instance drew is kept as markup, keyed by its component,
its props and the box the design gives it. Where its children went is marked (`ed-slot`), and
where its text went (`ed-text`), so another page using the component with other children or
another text draws from the same capture. Tokens and looks are stylesheets and change no
capture; a component's code changing drops them all.

With `?captures=1` (kept in the browser's storage, `?captures=0` turns it off), a page whose
instances all have captures is drawn as plain DOM in the frame's shadow root, without running a
component. It goes live (React mounts and replaces the static DOM) to edit a text in place, to
take input (prototype, interact mode), or when the components change. Hit tests, measures and
selection work on it as they do live, through `data-ed-node`. Draft components draw their own
tree. A page with one instance never captured is drawn live.

Captures last for the session: nothing is written to disk.

## Measured

`pnpm bench:canvas --captures` against `pnpm bench:canvas`, same machine:

| | Live (main) | Captures |
|---|---|---|
| 50 frames, the canvas switched to and drawn | 6,239 ms | 877 ms |
| 50 frames, renderer / all processes | 731 / 966 MB | 643 / 884 MB |
| 50 frames, first load of the session | 2.1 s | 2.3 s (nothing is captured yet) |
| Redesign (10 frames), first load | 406 ms | 328 ms |
| A page edited, until drawn (median) | 17 ms | 26 ms (the page is built again whole) |
| Pan, zoom | the same within noise | |
| Pictures, static against live | | 0% of pixels differ on the 7 pages drawn static |

## What it says

- It pays where many frames are drawn cold after their components were seen: a big canvas
  opened or switched to is seven times faster, with a tenth less memory.
- It costs on edits: a page drawn from captures is built again whole, where React changes one
  node. An edit could go live first, which is what text editing does.
- The first view of a session gains nothing: there is nothing captured yet.
- Kept between sessions it would draw a page at once when a project opens, but a component's
  code changed while the editor was closed would show its old markup until the page goes live.
  The catalogue says when it was built, not what the components draw: the server would have to
  hash the component files (and what they import) and the captures be keyed by it.
- On canvases of ten pages, live is as fast.

## When to take it up again

If canvases of fifty pages and more become common, or the first paint of a project opened
matters: as a first-paint cache that goes live when idle, persisted under the cache directory
with the server's hash of the components. `git cherry-pick e844d7f` onto main is the starting
point (it touches `preview-core/frame.ts`, `framework-api/browser.ts`, `web/canvas/frame.tsx`
and the bench, and adds `preview-core/captures.ts`, its test and `web/canvas/captures-flag.ts`).
The debug handle `globalThis.__edCaptures` lists the captures, the misses (instances a page
could not be drawn without) and the timings of capturing and building.

## The code

`packages/preview-core/src/captures.ts`:

```ts
/**
 * Captures of the repository's components (PLAN-editor-renderer Phase 6, an experiment): what an
 * instance drew, kept as markup, so a page whose instances were all seen before is drawn without
 * running a component. Where the instance's children went is marked (`ed-slot`), and where its
 * text went (`ed-text`): another page using the component with other children, or another text,
 * draws from the same capture.
 *
 * A capture is keyed by what decides the instance's markup besides its children and its text:
 * its component, its props and the box the design gives it. The design's tokens and looks are
 * stylesheets, not markup, and change no capture; a component's code changing drops them all.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import {
  layoutOf,
  makeStyleContext,
  maskOf,
  nodeStyle,
  type ParentLayout,
  type StyleContext,
  tagOf,
} from "@ultrapaint/design-document/css";
import { childrenOf } from "@ultrapaint/design-document/tree";
import {
  NODE_ATTRIBUTE,
  nodeSelector,
} from "@ultrapaint/framework-api/browser";

const SLOT = "ed-slot";
const TEXT = "ed-text";
const DRAFT_FROM = "#draft";
const DRAFT_NODE_ATTRIBUTE = "data-ed-draft-node";

/** Captures by key: markup with its slots and text marked. */
const captures = new Map<string, string>();
/** What the last builds could not find, for whoever studies the experiment. */
const misses: { component: string; keys: string[] }[] = [];
/** How long capturing and drawing from captures took, in milliseconds, for whoever measures. */
export const timings = { build: [] as number[], capture: [] as number[] };
(globalThis as { __edCaptures?: unknown }).__edCaptures = {
  captures,
  misses,
  timings,
};
/** Parsed once per capture, cloned for every instance drawn from it. */
const templates = new Map<string, HTMLTemplateElement>();

/** Every capture goes: a component's code changed. */
export const dropCaptures = () => {
  captures.clear();
  templates.clear();
};

/** How many captures there are, for whoever measures. */
export const captureCount = () => captures.size;

const keyOf = (
  node: InstanceNode,
  style: Record<string, string>,
  text: string
) =>
  JSON.stringify([
    node.from,
    node.component,
    node.props ?? {},
    style,
    childrenOf(node).length,
    text,
  ]);

/** The keys a capture of the instance may be under: its text marked, or its text as it is. */
const keysOf = (node: InstanceNode, style: Record<string, string>) =>
  node.text === undefined
    ? [keyOf(node, style, "")]
    : [keyOf(node, style, TEXT), keyOf(node, style, `=${node.text}`)];

/** The first text node in `root` that says `text` exactly. */
const textNodeOf = (root: Node, text: string): Text | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue === text) {
      return n as Text;
    }
  }
  return null;
};

interface Walk {
  readonly ctx: StyleContext;
  readonly parent: ParentLayout;
}

/**
 * Keeps what each instance of the page drew in `root`, the frame's shadow root, as it is drawn
 * now. Instances whose markup cannot be found (a component that drew nothing) are skipped.
 */
export const captureInstances = (
  page: DesignNode,
  designSystem: DesignSystem | null,
  root: ParentNode
) => {
  const started = performance.now();
  const visit = (node: DesignNode, walk: Walk) => {
    const layout = layoutOf(node);
    if (node.type === "instance" && node.from !== DRAFT_FROM) {
      const style = nodeStyle(node, { ...walk.ctx, parent: walk.parent });
      const el = root.querySelector(nodeSelector(node.id));
      if (el) {
        const clone = el.cloneNode(true) as Element;
        clone.removeAttribute(NODE_ATTRIBUTE);
        childrenOf(node).forEach((child, i) => {
          const at = clone.querySelector(nodeSelector(child.id));
          const slot = document.createElement(SLOT);
          slot.setAttribute("i", String(i));
          at?.replaceWith(slot);
        });
        let key = keyOf(node, style, "");
        if (node.text !== undefined) {
          const text = textNodeOf(clone, node.text);
          if (text) {
            text.replaceWith(document.createElement(TEXT));
            key = keyOf(node, style, TEXT);
          } else {
            key = keyOf(node, style, `=${node.text}`);
          }
        }
        captures.set(key, clone.outerHTML);
        templates.delete(key);
      }
    }
    for (const child of childrenOf(node)) {
      visit(child, { ctx: walk.ctx, parent: layout });
    }
  };
  visit(page, { ctx: makeStyleContext(designSystem), parent: "free" });
  timings.capture.push(performance.now() - started);
};

const templateOf = (key: string): HTMLTemplateElement | null => {
  let found = templates.get(key);
  if (!found) {
    const html = captures.get(key);
    if (html === undefined) {
      return null;
    }
    found = document.createElement("template");
    found.innerHTML = html;
    templates.set(key, found);
  }
  return found;
};

export interface StaticInput {
  readonly assetUrl: (src: string) => string;
  readonly designSystem: DesignSystem | null;
  readonly mode: "page" | "fit";
  readonly pageHeight: string;
  readonly root: DesignNode;
  readonly specs: readonly ComponentSpec[] | undefined;
}

/** Thrown inside the build when an instance has no capture: the page is drawn live instead. */
class Missing extends Error {}

const applyStyle = (el: HTMLElement, style: Record<string, string>) => {
  for (const [key, value] of Object.entries(style)) {
    (el.style as unknown as Record<string, string>)[key] = value;
  }
};

/**
 * The page drawn from captures, as a fragment; null when an instance of it has none, or draws
 * something a capture cannot (a draft component's own tree is drawn, it is the design's).
 */
export const buildStatic = (input: StaticInput): DocumentFragment | null => {
  const ctx = makeStyleContext(input.designSystem);
  const drafts = new Map(
    (input.specs ?? []).flatMap((s) =>
      s.draft ? [[s.component, s.draft] as const] : []
    )
  );
  const fromCapture = (
    node: InstanceNode,
    style: Record<string, string>,
    attribute: string
  ): Node => {
    for (const key of keysOf(node, style)) {
      const template = templateOf(key);
      if (!template) {
        continue;
      }
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const el = fragment.firstElementChild as HTMLElement;
      el.setAttribute(attribute, node.id);
      const layout = layoutOf(node);
      for (const slot of Array.from(fragment.querySelectorAll(SLOT))) {
        const child = childrenOf(node)[Number(slot.getAttribute("i"))];
        slot.replaceWith(child ? build(child, layout, attribute) : "");
      }
      fragment.querySelector(TEXT)?.replaceWith(node.text ?? "");
      return el;
    }
    misses.push({ component: node.component, keys: keysOf(node, style) });
    throw new Missing(node.component);
  };
  const fromDraft = (node: InstanceNode): Node => {
    const tree = drafts.get(node.component);
    if (!tree) {
      throw new Missing("a draft without its tree");
    }
    const el = build(tree, "free", DRAFT_NODE_ATTRIBUTE) as HTMLElement;
    el.setAttribute(NODE_ATTRIBUTE, node.id);
    el.setAttribute("data-ed-c", node.component);
    el.setAttribute("data-ed-instance", node.component);
    return el;
  };
  const fillImage = (el: HTMLElement, node: DesignNode & { type: "image" }) => {
    if (node.tint === undefined) {
      el.setAttribute("alt", node.alt ?? "");
      el.setAttribute("src", input.assetUrl(node.src));
      el.setAttribute("draggable", "false");
      return;
    }
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", node.alt ?? "");
    applyStyle(el, maskOf(input.assetUrl(node.src)));
  };
  function build(
    node: DesignNode,
    parent: ParentLayout,
    attribute: string
  ): Node {
    const style = nodeStyle(node, { ...ctx, parent });
    if (node.type === "instance") {
      return node.from === DRAFT_FROM
        ? fromDraft(node)
        : fromCapture(node, style, attribute);
    }
    const el = document.createElement(tagOf(node));
    el.setAttribute(attribute, node.id);
    if (node.type === "text") {
      el.textContent = node.text;
    } else if (node.type === "image") {
      fillImage(el, node);
    } else {
      const layout = layoutOf(node);
      for (const child of childrenOf(node)) {
        el.append(build(child, layout, attribute));
      }
    }
    applyStyle(el, style);
    return el;
  }
  const root =
    input.mode === "page" && input.root.type === "page"
      ? {
          ...input.root,
          minHeight: input.root.minHeight ?? input.pageHeight,
        }
      : input.root;
  const started = performance.now();
  try {
    const fragment = document.createDocumentFragment();
    fragment.append(build(root, "free", NODE_ATTRIBUTE));
    timings.build.push(performance.now() - started);
    return fragment;
  } catch (error) {
    if (error instanceof Missing) {
      return null;
    }
    throw error;
  }
};
```

How the frame, the editor and the bench use it, against main at the time (`git diff d8bf755
e844d7f`):

```diff
diff --git a/apps/web/src/canvas/captures-flag.ts b/apps/web/src/canvas/captures-flag.ts
new file mode 100644
index 0000000..fae3f0f
--- /dev/null
+++ b/apps/web/src/canvas/captures-flag.ts
@@ -0,0 +1,19 @@
+/**
+ * Whether frames are drawn from captures of their instances when they can (PLAN-editor-renderer
+ * Phase 6, an experiment): `?captures=1` in the editor's address, or `"1"` under
+ * `ultrapaint:captures` in this browser's storage.
+ */
+const KEY = "ultrapaint:captures";
+
+let on: boolean | null = null;
+
+export const capturesOn = (): boolean => {
+  if (on === null) {
+    const asked = new URLSearchParams(window.location.search).get("captures");
+    if (asked !== null) {
+      localStorage.setItem(KEY, asked === "1" ? "1" : "0");
+    }
+    on = localStorage.getItem(KEY) === "1";
+  }
+  return on;
+};
diff --git a/apps/web/src/canvas/frame.tsx b/apps/web/src/canvas/frame.tsx
index 009cfc8..54f16cd 100644
--- a/apps/web/src/canvas/frame.tsx
+++ b/apps/web/src/canvas/frame.tsx
@@ -35,6 +35,7 @@ import { FramePresence } from "./agent-presence.tsx";
 import { AgentWorkOverlay, useFrameWork, useSkeletons } from "./agent-work.tsx";
 import { bridgeFor } from "./bridge.ts";
 import { screenPx, UNZOOM } from "./camera.ts";
+import { capturesOn } from "./captures-flag.ts";
 import { commentCursor, FrameComments } from "./comments.tsx";
 import { ToolbarLayer } from "./element-toolbar-placement.ts";
 import {
@@ -421,6 +422,7 @@ const PreviewHost = ({
         const bridge = bridgeFor(frameId);
         const runtime = preview.mountFrame(el, {
           canvas,
+          captures: capturesOn(),
           events: bridge.events(),
           frame: frameId,
         });
diff --git a/packages/framework-api/src/browser.ts b/packages/framework-api/src/browser.ts
index 191aafd..43b4f62 100644
--- a/packages/framework-api/src/browser.ts
+++ b/packages/framework-api/src/browser.ts
@@ -148,6 +148,11 @@ export interface FrameRuntime {
 export interface MountFrameOptions {
   /** Canvas whose own assets relative image paths are looked for in first. */
   readonly canvas: string;
+  /**
+   * Draws the page from captures of its instances when it can, without running a component
+   * (PLAN-editor-renderer Phase 6, an experiment), and live once it has to be.
+   */
+  readonly captures?: boolean;
   readonly events: FrameEvents;
   /** Identifies the frame: a frame on the canvas, the prototype, a specimen. */
   readonly frame: string;
diff --git a/packages/preview-core/src/frame.ts b/packages/preview-core/src/frame.ts
index d2102e5..6b8c39e 100644
--- a/packages/preview-core/src/frame.ts
+++ b/packages/preview-core/src/frame.ts
@@ -25,6 +25,7 @@ import type {
   RenderSetup,
 } from "@ultrapaint/framework-api/browser";
 import { toCanvas, toPng } from "html-to-image";
+import { buildStatic, captureInstances, dropCaptures } from "./captures.ts";
 import { chainAt, directText, elementsOf, unionRect } from "./dom.ts";
 import { BODY_ATTRIBUTE } from "./frame-css.ts";
 import { elementAt, type HitScope } from "./hit.ts";
@@ -90,6 +91,8 @@ export const createPreview = (input: PreviewSetup): Preview => {
   const frames = new Set<{
     events: FrameEvents;
     mounted: Mounted;
+    /** The components changed: a page drawn from captures is drawn live. */
+    refresh: () => void;
   }>();
   const previewBase = new URL(input.designsRoot, location.href).pathname.split(
     "@fs"
@@ -99,7 +102,11 @@ export const createPreview = (input: PreviewSetup): Preview => {
   const preview: Preview = {
     mountFrame: (host, options) => {
       const frame = mountFrame(host, options, input, components);
-      const entry = { events: options.events, mounted: frame.mounted };
+      const entry = {
+        events: options.events,
+        mounted: frame.mounted,
+        refresh: frame.refresh,
+      };
       frames.add(entry);
       return {
         ...frame.runtime,
@@ -121,8 +128,10 @@ export const createPreview = (input: PreviewSetup): Preview => {
     },
     setComponents: (next) => {
       components = next;
+      dropCaptures();
       for (const frame of frames) {
         frame.mounted.setComponents(next);
+        frame.refresh();
       }
     },
   };
@@ -177,9 +186,16 @@ const mountFrame = (
   options: MountFrameOptions,
   input: PreviewSetup,
   components: PreviewSetup["components"]
-): { mounted: Mounted; runtime: FrameRuntime } => {
+): { mounted: Mounted; refresh: () => void; runtime: FrameRuntime } => {
   const { events } = options;
   const { body, root: canvas, shadow } = buildFrame(host, input.theme);
+  // What a page drawn from captures is drawn in, beside the live root, until it goes live.
+  const still = document.createElement("div");
+  still.setAttribute("data-ed-static", "");
+  body.prepend(still);
+  let live = !options.captures;
+  let last: RenderRequest | null = null;
+  let pendingEdit: string | null = null;
   if (options.still) {
     host.setAttribute("data-ed-still", "");
   }
@@ -257,6 +273,18 @@ const mountFrame = (
     components,
     navigate: (route) => events.navigateTo?.(route, false),
     onRendered: (renderId) => {
+      if (live && still.firstChild) {
+        still.replaceChildren();
+        canvas.style.display = "";
+      }
+      if (live && options.captures && last?.root) {
+        captureInstances(last.root, last.designSystem, shadow);
+      }
+      if (live && pendingEdit !== null) {
+        const id = pendingEdit;
+        pendingEdit = null;
+        queueMicrotask(() => startTextEdit(id));
+      }
       applySkeletons();
       events.rendered?.(renderId);
       scheduleRects();
@@ -272,14 +300,43 @@ const mountFrame = (
   const resize = new ResizeObserver(sendSize);
   resize.observe(canvas);
 
+  /** The page drawn by its components from now on; what is drawn from captures goes once it is. */
+  const goLive = () => {
+    if (live) {
+      return;
+    }
+    live = true;
+    if (last) {
+      mounted.render(last);
+    }
+  };
+
   const render = (request: RenderRequest) => {
     if (editing) {
       finishTextEdit(false);
     }
     activeFrame = body;
+    last = request;
     applyDefaults(body, request, input.theme);
     fill = request.root?.width === "fill";
     applyMode(request.mode);
+    if (!live && request.root && request.message === undefined) {
+      const drawn = buildStatic({
+        assetUrl,
+        designSystem: request.designSystem,
+        mode: request.mode,
+        pageHeight: "100cqh",
+        root: request.root,
+        specs: request.specs,
+      });
+      if (drawn) {
+        canvas.style.display = "none";
+        still.replaceChildren(drawn);
+        setup.onRendered(request.renderId);
+        return;
+      }
+      live = true;
+    }
     mounted.render(request);
   };
 
@@ -530,7 +587,14 @@ const mountFrame = (
   };
 
   const runtime: FrameRuntime = {
-    editText: startTextEdit,
+    editText: (nodeId) => {
+      if (live) {
+        startTextEdit(nodeId);
+        return;
+      }
+      pendingEdit = nodeId;
+      goLive();
+    },
     hitTest: (x, y) => {
       const at = placement();
       const el = unobserved(() =>
@@ -548,6 +612,9 @@ const mountFrame = (
       if (editing && !next) {
         finishTextEdit(true);
       }
+      if (next) {
+        goLive();
+      }
       interactive = next;
       setInert();
     },
@@ -574,5 +641,5 @@ const mountFrame = (
       scheduleRects();
     },
   };
-  return { mounted, runtime };
+  return { mounted, refresh: goLive, runtime };
 };
diff --git a/scripts/bench-canvas.ts b/scripts/bench-canvas.ts
index bf76eeb..2ce2d62 100644
--- a/scripts/bench-canvas.ts
+++ b/scripts/bench-canvas.ts
@@ -36,6 +36,8 @@ import {
 const { values: args } = parseArgs({
   options: {
     canvas: { default: "redesign", type: "string" },
+    // The captures experiment (PLAN-editor-renderer Phase 6): frames drawn from captures.
+    captures: { default: false, type: "boolean" },
     chrome: { type: "string" },
     other: { default: "samples", type: "string" },
     out: { type: "string" },
@@ -387,7 +389,10 @@ const launch = async () => {
 };
 
 const open = async (page: Page, canvas: string) => {
-  await page.goto(`${EDITOR}/?canvas=${canvas}`, { waitUntil: "load" });
+  await page.goto(
+    `${EDITOR}/?canvas=${canvas}${args.captures ? "&captures=1" : "&captures=0"}`,
+    { waitUntil: "load" }
+  );
   await page.waitForFunction(
     (c) => {
       const ed = (window as unknown as Partial<BenchWindow>).__ed;
```
