/**
 * The system components' views rendered to static markup (ADR 0150): what an instance's HTML is
 * made of (`toHtml`), so it is the canvas's by construction rather than a template that drifts
 * from it. The server renders a view with `react-dom/server`, at rest and without the editor's
 * frame: an overlay is closed whatever its design opens, its popup portalled nowhere, so it is its
 * trigger alone, and a toast or a dialog without a trigger is nothing. The markup is then read
 * into the tree the HTML writer takes, the instance's element marked and each slot held in a
 * placeholder.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { SystemComponentFile } from "@ultrapaint/contracts/components";
import {
  INSTANCE_MARK,
  type Markup,
  SLOT_PLACEHOLDER,
  type SystemDrawing,
  VOID_ELEMENTS,
} from "@ultrapaint/design-document/code";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { systemComponentOf } from "./catalogue.ts";
import { SYSTEM_COMPONENT_VIEWS } from "./components.tsx";
import { defaultLookOf, lookOf } from "./defaults.ts";

/** What `renderToStaticMarkup` writes: a comment, a closing tag, an opening tag, or text. */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|[^<]+/g;
const ATTRIBUTE_RE = /\s+([^\s"'>/=]+)(?:="([^"]*)")?/g;
const ENTITY_RE = /&(?:#x([\da-f]+)|#(\d+)|([a-z]+));/gi;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};
const decode = (text: string) =>
  text.replace(
    ENTITY_RE,
    (entity, hex: string | undefined, dec: string | undefined, name) => {
      if (hex !== undefined) {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      }
      if (dec !== undefined) {
        return String.fromCodePoint(Number.parseInt(dec, 10));
      }
      return NAMED_ENTITIES[String(name).toLowerCase()] ?? entity;
    }
  );

interface Open {
  readonly attributes: readonly (readonly [string, string])[];
  readonly children: Markup[];
  readonly tag: string;
}

/**
 * React's static markup as a tree. It writes well-formed markup (every attribute quoted and
 * escaped, every element closed or void), which is all this reads.
 */
const parseMarkup = (html: string): Markup[] => {
  const root: Open = { attributes: [], children: [], tag: "" };
  const stack: Open[] = [root];
  const top = () => stack.at(-1) ?? root;
  for (const match of html.matchAll(TOKEN_RE)) {
    const [token, closing, opening, attributes = "", selfClosing] = match;
    if (token.startsWith("<!--")) {
      continue;
    }
    if (closing !== undefined) {
      const open = stack.length > 1 ? stack.pop() : undefined;
      if (open) {
        top().children.push({ ...open, kind: "element" });
      }
    } else if (opening === undefined) {
      top().children.push({ kind: "text", text: decode(token) });
    } else {
      const element: Open = {
        attributes: Array.from(attributes.matchAll(ATTRIBUTE_RE), (a) => [
          a[1] ?? "",
          decode(a[2] ?? ""),
        ]),
        children: [],
        tag: opening,
      };
      if (selfClosing || VOID_ELEMENTS.has(opening.toLowerCase())) {
        top().children.push({ ...element, kind: "element" });
      } else {
        stack.push(element);
      }
    }
  }
  return root.children;
};

/**
 * The elements a system component's view renders at rest for an instance's props: the
 * instance's element marked (`INSTANCE_MARK`), each slot named in `slots` held in a placeholder
 * (`SLOT_PLACEHOLDER`) where the view draws it, and the ids its parts make up for each other
 * (a label's, a control's) starting with `idPrefix`. None for a name that is no system component.
 */
export const restingMarkupOf = (
  component: string,
  props: Readonly<Record<string, JsonValue>>,
  slots: readonly string[],
  idPrefix = ""
): Markup[] => {
  const View = SYSTEM_COMPONENT_VIEWS[component];
  const meta = systemComponentOf(component);
  if (!(View && meta)) {
    return [];
  }
  const held = (name: string) => createElement(SLOT_PLACEHOLDER, { name });
  const fallback = meta.slots.find((s) => s.holds === "default")?.name;
  const named = Object.fromEntries(
    slots.filter((s) => s !== fallback).map((s) => [s, held(s)])
  );
  const content =
    fallback !== undefined && slots.includes(fallback)
      ? held(fallback)
      : undefined;
  return parseMarkup(
    renderToStaticMarkup(
      createElement(
        View,
        { ...props, [INSTANCE_MARK]: "", open: false, slots: named },
        content
      ),
      { identifierPrefix: idPrefix }
    )
  );
};

/**
 * How the HTML writer draws each system component (`SystemDrawing`): its default look with the
 * project's file over it, which the canvas draws the same way, the content the project's file
 * gives its empty slots, and its view's markup at rest. Undefined for a name that is no system
 * component.
 */
export const systemDrawingOf = (
  files: readonly SystemComponentFile[]
): ((component: string) => SystemDrawing | undefined) => {
  const own = new Map(files.map((f) => [f.name, f]));
  return (component) => {
    const fallback = defaultLookOf(component);
    if (!(fallback && SYSTEM_COMPONENT_VIEWS[component])) {
      return;
    }
    const file = own.get(component);
    return {
      content: file?.content ?? {},
      looks: [fallback, file].flatMap((f) => {
        const look = f && lookOf(f);
        return look ? [look] : [];
      }),
      markup: ({ id, props = {} }, slots) =>
        restingMarkupOf(component, props, slots, `${id}-`),
    };
  };
};
