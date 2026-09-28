/**
 * Builds a `.fig` file from nodes written by hand, for tests: the same zip, header, schema and
 * kiwi message a real file has, so that what the tests read is what Figma writes. Node only
 * (zstd is the platform's).
 */
import { zstdCompressSync } from "node:zlib";
import {
  assembleCanvasFig,
  createEmptyFigDoc,
  createFigZip,
  encodeFigParts,
  type FigGuid,
  type FigNode,
} from "openfig-core";

export interface FixtureBuilder {
  /** Adds a node under a parent; answers with its guid for children to point at. */
  readonly add: (
    parent: FigGuid | null,
    node: Omit<FigNode, "guid" | "parentIndex"> & { guid?: FigGuid }
  ) => FigGuid;
  readonly addImage: (hash: string, bytes: Uint8Array) => void;
  /** The zip bytes of the file. */
  readonly build: () => Uint8Array;
  /** The canvas Figma files components on when they are not on a page. */
  readonly internal: FigGuid;
  /** The first page of the empty document. */
  readonly page: FigGuid;
}

export const solid = (r: number, g: number, b: number, a = 1, opacity = 1) => ({
  blendMode: "NORMAL",
  color: { a, b, g, r },
  opacity,
  type: "SOLID",
  visible: true,
});

export const identity = (x = 0, y = 0) => ({
  m00: 1,
  m01: 0,
  m02: x,
  m10: 0,
  m11: 1,
  m12: y,
});

export const makeFixture = (): FixtureBuilder => {
  const doc = createEmptyFigDoc();
  const changes = doc.message.nodeChanges as FigNode[];
  const page = (
    changes.find((n) => n.type === "CANVAS" && !n.internalOnly) as FigNode
  ).guid;
  const internal = (
    changes.find((n) => n.type === "CANVAS" && n.internalOnly) as FigNode
  ).guid;
  let local = 1000;
  const positions = new Map<string, number>();
  const images = new Map<string, Uint8Array>();
  const nextPosition = (parent: FigGuid) => {
    const key = `${parent.sessionID}:${parent.localID}`;
    const n = (positions.get(key) ?? 0) + 1;
    positions.set(key, n);
    // Sorted as strings by the reader: zero-padded so ten sorts after nine.
    return `!${String(n).padStart(4, "0")}`;
  };
  return {
    add: (parent, node) => {
      local += 1;
      const guid = node.guid ?? { localID: local, sessionID: 7 };
      changes.push({
        ...node,
        guid,
        phase: "CREATED",
        ...(parent
          ? { parentIndex: { guid: parent, position: nextPosition(parent) } }
          : {}),
      } as FigNode);
      return guid;
    },
    addImage: (hash, bytes) => {
      images.set(hash, bytes);
    },
    build: () => {
      const parts = encodeFigParts(doc);
      const canvasFig = assembleCanvasFig({
        messageCompressed: zstdCompressSync(parts.messageRaw),
        passThrough: parts.passThrough,
        prelude: parts.prelude,
        schemaCompressed: parts.schemaCompressed,
        version: parts.version,
      });
      return createFigZip({ canvasFig, images, meta: { name: "fixture" } });
    },
    internal,
    page,
  };
};

/** A few bytes that read as a PNG. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
