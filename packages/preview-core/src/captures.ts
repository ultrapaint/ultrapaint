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
