/**
 * Bringing the code onto the design system, for the setup's Map and Migrate steps (ADR 0023):
 * the rules that settle what a value becomes when it matches a token exactly, and the rewrite of
 * a file where the mapping settles a value and the change is mechanical — a class, a style value,
 * a stylesheet declaration. What is left (a colour in a constant, a plain element to replace with
 * a component) is reported for an agent. Pure and synchronous.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import {
  mappingKey,
  type UsageKind,
  type UsageLeft,
  type UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import {
  spacingBasePx,
  spacingStepAt,
  spacingStepName,
  spacingStepOf,
  tokenPrefix,
  tokensOfKind,
} from "@ultrapaint/contracts/token-table";
import { sameValue, toPx } from "@ultrapaint/contracts/token-value";
import type {
  UsageOccurrence,
  UsageReader,
  UsageSuggestion,
} from "@ultrapaint/framework-api/node";
import {
  type Classified,
  classify,
  knownOf,
  scanning,
  splitClass,
} from "./usage-scan.ts";

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const REGEX_CHARS_RE = /[.*+?^${}()|[\]\\]/g;

/** The token of a kind whose value is this length, in pixels. */
const tokenOfLength = (
  tokens: readonly { readonly name: string; readonly value: string }[],
  px: number
) => tokens.find((t) => toPx(t.value) === px)?.name;

/** A target settled by a rule, for one value. */
type Rule = (
  value: UsageValue,
  ds: DesignSystem
) => { readonly note: string; readonly target: string } | null;

const EXACT = "Exactly the token's value";

/** A colour equal to a token, a plain element the library has a component for. */
const byToken: Rule = (value) => {
  if (!value.token) {
    return null;
  }
  return {
    note: value.kind === "color" ? EXACT : `The library has ${value.token}`,
    target: value.token,
  };
};

/** A length on the spacing scale, as its step: 16px is `spacing-4` on a 4px base; a zero is none. */
const bySpacing: Rule = (value, ds) => {
  const px = Math.abs(toPx(value.value) ?? 0);
  const base = spacingBasePx(ds.spacing.base);
  const step = spacingStepAt(px, base);
  return step === null || step === 0
    ? null
    : {
        note: `On the scale: ${px}px is ${step} × ${base}px`,
        target: spacingStepName(step),
      };
};

/** A length equal to a token's, in pixels. */
const byLength =
  (
    tokensOf: (ds: DesignSystem) => readonly { name: string; value: string }[]
  ): Rule =>
  (value, ds) => {
    const px = toPx(value.value);
    const name = px === null ? undefined : tokenOfLength(tokensOf(ds), px);
    return name ? { note: EXACT, target: name } : null;
  };

const byWeight: Rule = (value, ds) => {
  const name = tokensOfKind(ds, "fontWeight").find(
    (w) => w.value.trim() === value.value
  )?.name;
  return name ? { note: EXACT, target: name } : null;
};

const byShadow: Rule = (value, ds) => {
  const name = tokensOfKind(ds, "shadow").find((t) =>
    sameValue(t.value, value.value)
  )?.name;
  return name ? { note: EXACT, target: name } : null;
};

const byLayer: Rule = (value, ds) => {
  const level = (ds.elevation ?? []).find(
    (l) => String(l.layer) === value.value
  );
  return level
    ? { note: `The ${level.name} layer`, target: value.value }
    : null;
};

const RULES: Record<UsageKind, Rule> = {
  color: byToken,
  element: byToken,
  fontSize: byLength((ds) => tokensOfKind(ds, "fontSize")),
  fontWeight: byWeight,
  radius: byLength((ds) => tokensOfKind(ds, "radius")),
  shadow: byShadow,
  spacing: bySpacing,
  zIndex: byLayer,
};

/** Only values written out are settled by a rule: Tailwind's own are a judgement. */
const suggestOne = (
  value: UsageValue,
  ds: DesignSystem
): UsageSuggestion | null => {
  if (value.status !== "raw") {
    return null;
  }
  const settled = RULES[value.kind](value, ds);
  return settled ? { kind: value.kind, value: value.value, ...settled } : null;
};

const suggest: UsageReader["suggest"] = (values, ds) =>
  values.flatMap((v) => {
    const one = suggestOne(v, ds);
    return one ? [one] : [];
  });

/** A target as the value of a class of its kind: `color-primary` is `primary` in `bg-primary`. */
const classValue = (kind: UsageKind, target: string): string | null => {
  if (kind === "zIndex") {
    return NUMBER_RE.test(target) ? target : null;
  }
  // What is left of a token past its kind's prefix is the class's value; an element has none.
  const prefix = kind === "element" ? "" : tokenPrefix(kind);
  return prefix && target.startsWith(prefix)
    ? target.slice(prefix.length)
    : null;
};

/** A class rewritten to the target, its variants, importance and opacity kept. */
const rewriteClass = (
  raw: string,
  value: Classified,
  target: string
): string | null => {
  const parts = splitClass(raw);
  const next = classValue(value.kind, target);
  if (!(parts && next)) {
    return null;
  }
  // `top-[-10px]` is `-top-2.5`; `-mt-[13px]` stays negative.
  const negative = parts.negative !== value.value.startsWith("-");
  const bang = (where: "before" | "after") =>
    parts.important === where ? "!" : "";
  return `${parts.variants}${bang("before")}${negative ? "-" : ""}${parts.use}-${next}${parts.modifier}${bang("after")}`;
};

/**
 * A target as CSS: in a stylesheet Tailwind processes, or in an inline style. The target is the
 * token of the value's size, so a negative value, `-16px`, is that token turned around.
 */
const cssValue = (
  kind: UsageKind,
  target: string,
  where: "stylesheet" | "inline",
  negative: boolean
): string | null => {
  if (kind === "zIndex") {
    // A layer's target is the number itself, its sign included.
    return NUMBER_RE.test(target) ? target : null;
  }
  if (kind === "element") {
    return null;
  }
  const step = kind === "spacing" ? spacingStepOf(target) : null;
  if (step !== null && where === "inline") {
    return `calc(var(--spacing) * ${negative ? "-" : ""}${step})`;
  }
  const css = step === null ? `var(--${target})` : `--spacing(${step})`;
  return negative ? `calc(${css} * -1)` : css;
};

/** Every place `literal` is written in `text` as a value of its own: `4px`, not the end of `14px`. */
const replaceValue = (text: string, literal: string, css: string) =>
  text.replace(
    new RegExp(
      `(?<![\\w.#-])${literal.replace(REGEX_CHARS_RE, "\\$&")}(?![\\w.%])`,
      "g"
    ),
    css
  );

interface Edit {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

type Decided = readonly (readonly [Classified, string])[];

/** A use as the agent is told it is left, with its target when the mapping has one. */
const leftOf = (
  use: UsageOccurrence,
  value: Classified,
  target?: string
): UsageLeft => ({
  kind: value.kind,
  line: use.line,
  raw: use.raw,
  value: value.value,
  ...(target !== undefined && { target }),
});

/** A style value or a declaration with every decided value in it replaced; null when one is not. */
const rewriteDeclared = (
  use: UsageOccurrence,
  decided: Decided
): string | null => {
  const declared = use.use.startsWith("css:");
  let next = use.value;
  for (const [value, target] of decided) {
    // A number in a style object is the whole value.
    const written = use.numeric ? use.value : value.literal;
    const css = cssValue(
      value.kind,
      target,
      declared ? "stylesheet" : "inline",
      written?.trim().startsWith("-") ?? false
    );
    const replaced = css && written ? replaceValue(next, written, css) : next;
    if (replaced === next) {
      return null;
    }
    next = replaced;
  }
  // A layer stays a number in a style object; anything else there becomes a string.
  const number = use.numeric && decided[0]?.[0].kind === "zIndex";
  return declared || number ? next : JSON.stringify(next);
};

/** What a use with decided values is rewritten to; null when it cannot be done in place. */
const rewritten = (use: UsageOccurrence, decided: Decided): string | null => {
  if (use.use === "literal" || use.use === "element") {
    return null;
  }
  if (use.use.startsWith("css:") || use.use.startsWith("style:")) {
    return rewriteDeclared(use, decided);
  }
  const [only] = decided;
  return only ? rewriteClass(use.raw, only[0], only[1]) : null;
};

/** What one use becomes: an edit of the file, or what is left for the agent. */
const rewriteUse = (
  use: UsageOccurrence,
  values: readonly Classified[],
  mapping: ReadonlyMap<string, string | null>
): { edit: Edit | null; left: UsageLeft[] } => {
  const left: UsageLeft[] = [];
  const decided: [Classified, string][] = [];
  for (const value of values) {
    const target = mapping.get(mappingKey(value.kind, value.value));
    if (target === undefined) {
      left.push(leftOf(use, value));
    } else if (target !== null) {
      decided.push([value, target]);
    }
  }
  const text =
    decided.length > 0 && use.start !== undefined && use.end !== undefined
      ? rewritten(use, decided)
      : null;
  if (text === null || use.start === undefined || use.end === undefined) {
    return {
      edit: null,
      left: [
        ...left,
        ...decided.map(([value, target]) => leftOf(use, value, target)),
      ],
    };
  }
  return { edit: { end: use.end, start: use.start, text }, left };
};

const rewrite: UsageReader["rewrite"] = (file, text, ctx, mapping) => {
  const known = knownOf(ctx.designSystem, ctx.ownTokens);
  const edits: Edit[] = [];
  const left: UsageLeft[] = [];
  for (const use of scanning.scanFile(file, text)) {
    const values = classify(use, known, ctx, file).filter(
      (v) => v.status !== "system"
    );
    if (values.length === 0) {
      continue;
    }
    const result = rewriteUse(use, values, mapping);
    left.push(...result.left);
    if (result.edit) {
      edits.push(result.edit);
    }
  }
  let next = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return { changes: edits.length, left, text: next };
};

/** What the server reaches of the code's usage, through the `Framework` interface. */
export const usage: UsageReader = { ...scanning, rewrite, suggest };
