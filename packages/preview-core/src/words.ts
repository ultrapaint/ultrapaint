/**
 * The words of a text edited in place (ADR 0163), read and written by their offsets: where the
 * browser's selection is in them, and a text's runs drawn while it is edited. Never the DOM's
 * markup: what the browser does to the elements inside the words is not read back.
 */
import type { TextRun } from "@ultrapaint/contracts/document";
import type { WordsRange } from "@ultrapaint/design-document/text-runs";

/** The selection's ranges inside a shadow root, however the browser reports them. */
const rangesIn = (shadow: ShadowRoot): readonly AbstractRange[] => {
  const selection = getSelection();
  if (!selection) {
    return [];
  }
  const composed = (
    selection as Selection & {
      getComposedRanges?: (options: {
        shadowRoots: ShadowRoot[];
      }) => StaticRange[];
    }
  ).getComposedRanges;
  if (composed) {
    const ranges = composed.call(selection, { shadowRoots: [shadow] });
    if (ranges.length > 0) {
      return ranges;
    }
  }
  // Chromium reports a selection inside a shadow root on the root alone.
  const own = (
    shadow as ShadowRoot & { getSelection?: () => Selection | null }
  ).getSelection?.();
  const from = own ?? selection;
  return from.rangeCount > 0 ? [from.getRangeAt(0)] : [];
};

/** How many characters of `el`'s words come before a place in it. */
const offsetOf = (el: Node, node: Node, offset: number): number => {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(node, offset);
  return range.toString().length;
};

/** Where the selection is in `el`'s words; null when it is not in them. */
export const selectedIn = (
  el: HTMLElement,
  shadow: ShadowRoot
): WordsRange | null => {
  const [range] = rangesIn(shadow);
  if (
    !(
      range &&
      el.contains(range.startContainer) &&
      el.contains(range.endContainer)
    )
  ) {
    return null;
  }
  const a = offsetOf(el, range.startContainer, range.startOffset);
  const b = offsetOf(el, range.endContainer, range.endOffset);
  return { end: Math.max(a, b), start: Math.min(a, b) };
};

/** The place of an offset of `el`'s words: a text node and an offset in it. */
const placeOf = (el: Node, offset: number): [Node, number] => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: [Node, number] = [el, 0];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const length = n.textContent?.length ?? 0;
    if (offset <= seen + length) {
      return [n, offset - seen];
    }
    seen += length;
    last = [n, length];
  }
  return last;
};

/** The range of `el`'s words from `start` to `end`. */
export const rangeOf = (el: HTMLElement, { end, start }: WordsRange) => {
  const range = document.createRange();
  range.setStart(...placeOf(el, start));
  range.setEnd(...placeOf(el, end));
  return range;
};

/** Selects `el`'s words from `start` to `end`. */
export const selectWords = (el: HTMLElement, words: WordsRange) => {
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(rangeOf(el, words));
};

/** A text's runs drawn in its element as the renderer draws them, while it is edited. */
export const drawRuns = (el: HTMLElement, runs: readonly TextRun[]) => {
  el.replaceChildren(
    ...runs.map((run) => {
      if (!(run.link || run.underline)) {
        return document.createTextNode(run.text);
      }
      const part = document.createElement(run.link ? "a" : "span");
      if (run.underline) {
        part.style.textDecorationLine = "underline";
      }
      part.textContent = run.text;
      return part;
    })
  );
};
