/**
 * The line of the repository's source a stack's line stands for. A stack names the module as the
 * preview's server sent it, after the React plugin and TypeScript wrote it out again: its lines
 * are not the source's. The server sends every module with its source map inline; the module is
 * read again (the browser has it, the server answers that it has not changed) and its map
 * followed back to the source. Only when something throws, once per module.
 */

const INLINE_MAP_RE =
  /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/;

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((c, i) => [c, i]));

/** For each line of the module, its segments: the column and the source line it comes from. */
export type Lines = readonly (readonly (readonly [number, number])[])[];

/**
 * A segment's values, each relative to the one before it (base64 VLQ): five bits a digit, the
 * sixth saying another follows, the lowest bit of the value its sign.
 */
const decodeSegment = (segment: string): number[] => {
  const values: number[] = [];
  let value = 0;
  let scale = 1;
  for (const char of segment) {
    const digit = DIGIT.get(char) ?? 0;
    value += (digit % 32) * scale;
    if (digit >= 32) {
      scale *= 32;
    } else {
      const magnitude = Math.floor(value / 2);
      values.push(value % 2 === 1 ? -magnitude : magnitude);
      value = 0;
      scale = 1;
    }
  }
  return values;
};

/** The map's segments by line of the module, with absolute columns and source lines. */
export const decodeMappings = (mappings: string): Lines => {
  let sourceLine = 0;
  return mappings.split(";").map((line) => {
    let column = 0;
    const segments: [number, number][] = [];
    for (const segment of line.split(",")) {
      if (segment === "") {
        continue;
      }
      const [dColumn = 0, , dLine] = decodeSegment(segment);
      column += dColumn;
      if (dLine !== undefined) {
        sourceLine += dLine;
        segments.push([column, sourceLine]);
      }
    }
    return segments;
  });
};

/** The source line (from 1) of `line` and `column` (from 1) of the module, if the map says. */
export const sourceLineIn = (
  lines: Lines,
  line: number,
  column: number
): number | null => {
  const segments = lines[line - 1];
  if (!segments || segments.length === 0) {
    return null;
  }
  let [found] = segments;
  for (const segment of segments) {
    if (segment[0] > column - 1) {
      break;
    }
    found = segment;
  }
  return found ? found[1] + 1 : null;
};

/** The lines of the map a module's `code` carries inline; null when it has none. */
export const inlineMapOf = (code: string): Lines | null => {
  // biome-ignore lint/suspicious/noUnnecessaryConditions: null when the module has no inline map.
  const [, inline = ""] = INLINE_MAP_RE.exec(code) ?? [];
  if (inline === "") {
    return null;
  }
  const { mappings } = JSON.parse(atob(inline)) as { mappings?: unknown };
  return typeof mappings === "string" ? decodeMappings(mappings) : null;
};

/**
 * The source's line for `line` and `column` of the module at `url` (`line` when the module has no
 * map that says), each module read once by `read`.
 */
export const mappedLines = (read: (url: string) => Promise<string>) => {
  const maps = new Map<string, Promise<Lines | null>>();
  const mapOf = (url: string) => {
    let map = maps.get(url);
    if (!map) {
      map = read(url)
        .then(inlineMapOf)
        .catch(() => null);
      maps.set(url, map);
    }
    return map;
  };
  return async (url: string, line: number, column: number): Promise<number> => {
    const lines = await mapOf(url);
    return (lines && sourceLineIn(lines, line, column)) ?? line;
  };
};
