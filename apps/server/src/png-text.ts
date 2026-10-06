import { crc32 } from "node:zlib";

/** How a PNG travels in a JSON message: base64 behind this prefix. */
export const PNG_DATA_URL = "data:image/png;base64,";

/**
 * A text chunk (`tEXt`) in a PNG: a keyword and its value, carried in the file itself and shown
 * by no viewer. A page's PNG records in one what it was drawn from, so the server knows whether
 * it is still the page without keeping a list of its own.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TEXT = "tEXt";

const isPng = (bytes: Uint8Array) =>
  bytes.length > SIGNATURE.length && SIGNATURE.every((b, i) => bytes[i] === b);

interface Chunk {
  readonly data: Uint8Array;
  /** Offset of the chunk's length field, and of the byte after its CRC. */
  readonly end: number;
  readonly start: number;
  readonly type: string;
}

const chunksOf = (bytes: Uint8Array): Chunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let at = SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.length) {
      break;
    }
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    chunks.push({
      data: bytes.subarray(at + 8, at + 8 + length),
      end,
      start: at,
      type,
    });
    if (type === "IEND") {
      break;
    }
    at = end;
  }
  return chunks;
};

const textOf = (data: Uint8Array) => {
  const nul = data.indexOf(0);
  return nul === -1
    ? null
    : {
        keyword: new TextDecoder("latin1").decode(data.subarray(0, nul)),
        value: new TextDecoder("latin1").decode(data.subarray(nul + 1)),
      };
};

/** The value the PNG carries under `keyword`, or null when it carries none or is no PNG. */
export const readPngText = (
  bytes: Uint8Array,
  keyword: string
): string | null => {
  if (!isPng(bytes)) {
    return null;
  }
  for (const chunk of chunksOf(bytes)) {
    if (chunk.type === TEXT) {
      const text = textOf(chunk.data);
      if (text?.keyword === keyword) {
        return text.value;
      }
    }
  }
  return null;
};

/**
 * The PNG with `value` under `keyword`, right after its header, replacing what it carried there
 * before. Keyword and value are ASCII: the format reads them as Latin-1.
 */
export const withPngText = (
  bytes: Uint8Array,
  keyword: string,
  value: string
): Uint8Array => {
  const chunks = chunksOf(bytes);
  const [header] = chunks;
  if (!(isPng(bytes) && header?.type === "IHDR")) {
    return bytes;
  }
  const payload = new TextEncoder().encode(`${TEXT}${keyword}\0${value}`);
  const added = new Uint8Array(payload.length + 8);
  const view = new DataView(added.buffer);
  view.setUint32(0, payload.length - 4);
  added.set(payload, 4);
  view.setUint32(payload.length + 4, crc32(payload));
  const kept = chunks
    .slice(1)
    .filter((c) => !(c.type === TEXT && textOf(c.data)?.keyword === keyword))
    .map((c) => bytes.subarray(c.start, c.end));
  const parts = [bytes.subarray(0, header.end), added, ...kept];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
