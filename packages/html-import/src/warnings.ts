/**
 * What pasted markup had that the layers do not carry (ADR 0148), each kind counted, so the
 * editor's toast can say it once with how often: "4 classes not read". Pure.
 */

/** Each kind of thing left behind, said of one and of several. */
export const WARNINGS = {
  backgroundImage: [
    "a background image left out",
    "background images left out",
  ],
  borderSides: [
    "a border on some sides only left out",
    "borders on some sides only left out",
  ],
  button: [
    "a button's look kept without its behaviour",
    "buttons' looks kept without their behaviour",
  ],
  corners: [
    "corners of different radii left out",
    "boxes' corners of different radii left out",
  ],
  dataImage: [
    "an image held in the markup (data:) left out",
    "images held in the markup (data:) left out",
  ],
  depth: ["layers nested too deep cut off", "layers nested too deep cut off"],
  form: ["a form control left out", "form controls left out"],
  grid: ["a grid laid out as a column", "grids laid out as columns"],
  inFlow: [
    "a child positioned absolutely put in the flow",
    "children positioned absolutely put in the flow",
  ],
  inline: [
    "inline formatting (bold, italic, links) flattened into its text",
    "texts' inline formatting (bold, italic, links) flattened",
  ],
  media: [
    "a canvas, video or frame left out",
    "canvases, videos or frames left out",
  ],
  positions: [
    "children positioned absolutely stacked in reading order",
    "groups of children positioned absolutely stacked in reading order",
  ],
  reversed: [
    "a reversed direction laid out forwards",
    "reversed directions laid out forwards",
  ],
  size: ["a size in %, vw or calc left out", "sizes in %, vw or calc left out"],
  svg: ["an SVG left out", "SVGs left out"],
  unread: ["a class not read", "classes not read"],
  variant: [
    "a class for a breakpoint or a state not read",
    "classes for a breakpoint or a state not read",
  ],
} as const satisfies Readonly<Record<string, readonly [string, string]>>;

export type WarningKind = keyof typeof WARNINGS;

/** One kind of thing left behind, and how many times. */
export interface Warning {
  readonly count: number;
  readonly kind: WarningKind;
  /** How it is said, with its count when there are several: `4 classes not read`. */
  readonly text: string;
}

/** Counts one kind, `times` times (once when left out; never for none). */
export type Warn = (kind: WarningKind, times?: number) => void;

/** A tally of warnings, in the order each kind was first met. */
export const makeWarnings = () => {
  const counts = new Map<WarningKind, number>();
  const warn: Warn = (kind, times = 1) => {
    if (times > 0) {
      counts.set(kind, (counts.get(kind) ?? 0) + times);
    }
  };
  const list = (): Warning[] =>
    [...counts].map(([kind, count]) => {
      const [one, many] = WARNINGS[kind];
      return { count, kind, text: count === 1 ? one : `${count} ${many}` };
    });
  return { list, warn };
};
