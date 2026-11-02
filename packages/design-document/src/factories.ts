/**
 * New nodes: what the Insert menu and the Library insert and what a new page starts as. Ids come
 * from the caller's generator, so a node made in the editor can be selected as soon as the server
 * has it.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignNode,
  InstanceFrom,
  InstanceNode,
  PageDocument,
  PageNode,
} from "@ultrapaint/contracts/document";
import { type IdGenerator, idPrefix, makeIdGenerator } from "./ids.ts";
import { DOCUMENT_VERSION } from "./tree.ts";

/**
 * The elements a design is built of (ADRs 0040, 0045): layout, text, images. The tools' Insert
 * menu offers some of them; a group is drawn with the group tool.
 */
export type ElementId =
  | "column"
  | "row"
  | "group"
  | "heading"
  | "paragraph"
  | "image";

/** Placeholder picture for an image nobody has chosen yet: a grey box, inline. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#e4e4e7"/><path d="M120 130l30-36 24 28 16-18 30 26z" fill="#a1a1aa"/><circle cx="130" cy="78" r="12" fill="#a1a1aa"/></svg>'
  );

export const newElement = (id: ElementId, next: IdGenerator): DesignNode => {
  switch (id) {
    case "row":
      return {
        children: [],
        gap: 8,
        id: next(idPrefix("row")),
        minHeight: 40,
        padding: 8,
        type: "row",
      };
    case "column":
      return {
        children: [],
        gap: 8,
        id: next(idPrefix("column")),
        minHeight: 40,
        padding: 8,
        type: "column",
      };
    case "group":
      return {
        children: [],
        id: next(idPrefix("group")),
        minHeight: 40,
        padding: 8,
        type: "group",
      };
    case "heading":
      return {
        id: next(idPrefix("text")),
        level: 2,
        role: "heading",
        text: "Heading",
        type: "text",
      };
    case "paragraph":
      return {
        id: next(idPrefix("text")),
        role: "paragraph",
        text: "Write something here.",
        type: "text",
      };
    default:
      return {
        alt: "",
        height: 200,
        id: next(idPrefix("image")),
        src: PLACEHOLDER_IMAGE,
        type: "image",
        width: 320,
      };
  }
};

/** What the catalogue knows of a component that a new instance needs. */
interface ComponentShape {
  /** The props a new instance starts with. */
  readonly example?: Readonly<Record<string, JsonValue>> | undefined;
  readonly importFrom: InstanceFrom;
  readonly name: string;
  /** The text a new instance shows. */
  readonly text?: string | undefined;
}

/** A new instance of a component, as the catalogue's example of it (ADR 0042). */
export const newInstance = (
  component: ComponentShape,
  next: IdGenerator
): InstanceNode => ({
  component: component.name,
  from: component.importFrom,
  id: next(idPrefix("instance")),
  ...(component.example &&
    Object.keys(component.example).length > 0 && { props: component.example }),
  ...(component.text !== undefined && { text: component.text }),
  type: "instance",
});

export const pageTemplates = [
  { id: "blank", name: "Blank" },
  { id: "centered", name: "Centered content" },
  { id: "page", name: "Page with header" },
] as const;

/** A new page, from one of the templates, titled after its route. */
export const renderTemplate = (
  templateId: string,
  title: string,
  random?: () => number
): PageDocument => {
  const next = makeIdGenerator(["root"], random);
  const root = (
    children: DesignNode[],
    extra: Partial<PageNode> = {}
  ): PageDocument => ({
    root: { children, id: "root", type: "page", ...extra },
    version: DOCUMENT_VERSION,
  });
  switch (templateId) {
    case "centered":
      return root(
        [
          {
            id: next("t"),
            level: 1,
            role: "heading",
            text: title,
            type: "text",
          },
          {
            id: next("t"),
            role: "paragraph",
            text: "Start designing here.",
            type: "text",
          },
        ],
        { align: "center", crossAlign: "center", gap: 24, padding: 32 }
      );
    // The header links nowhere: a canvas need not serve `/`, and a link to a URL no page serves
    // is a broken one from the start.
    case "page":
      return root([
        {
          children: [
            {
              id: next("t"),
              level: 1,
              role: "heading",
              size: 18,
              text: title,
              type: "text",
            },
          ],
          crossAlign: "center",
          id: next("r"),
          name: "Header",
          padding: { bottom: 16, left: 24, right: 24, top: 16 },
          type: "row",
          width: "fill",
        },
        {
          children: [
            {
              id: next("t"),
              role: "paragraph",
              text: "Start designing here.",
              type: "text",
            },
          ],
          gap: 16,
          height: "fill",
          id: next("c"),
          name: "Content",
          padding: 24,
          type: "column",
          width: "fill",
        },
      ]);
    default:
      return root([]);
  }
};

/** The file contents of a document: stable formatting, one trailing newline. */
export const serialise = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;
