/**
 * What a point of the designs' history is called and what is said under it (ADR 0087): what was
 * asked of an agent, the person's edits, a restore, files changed from outside.
 */
import type { HistoryPoint } from "@ultrapaint/contracts/snapshots";
import { plural } from "@ultrapaint/shared/text";

/** A point's own words: its name when it is a version, else what it was. */
export const pointTitle = (point: HistoryPoint): string => {
  if (point.name) {
    return point.name;
  }
  switch (point.kind) {
    case "turn":
      return point.label ?? "An agent's turn";
    case "edits":
      return "Your edits";
    case "restore":
      return `Restored to “${point.label ?? "a point"}”`;
    case "outside":
      return `${plural(point.files.length, "file")} changed on disk`;
    case "start":
      return "History begins";
    default:
      return point.label ?? "Kept before";
  }
};

/**
 * The canvases a point changed, by name: the first, and how many more ("Redesign +1"). Empty
 * when it changed no canvas's pages.
 */
export const canvasesOf = (
  point: HistoryPoint,
  names: (id: string) => string | undefined
): string => {
  const known = point.canvases.flatMap((id) => names(id) ?? []);
  const [first, ...rest] = known;
  if (first === undefined) {
    return "";
  }
  return rest.length > 0 ? `${first} +${rest.length}` : first;
};
