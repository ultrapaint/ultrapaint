/**
 * A field over one value of a node: a number of pixels, a design token (`$color-primary`) or
 * plain CSS. The design system's tokens are the list, so they stay the easy path; anything else
 * is typed. Built on the style combobox, whose options are strings: numbers travel as their
 * decimal text and come back as numbers.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { isToken, tokenName } from "@ultrapaint/design-document/tokens";
import type * as React from "react";
import { StyleCombobox, type StyleOption } from "./style-combobox.tsx";

const NUMBER_RE = /^-?\d*\.?\d+$/;
const PX_RE = /^(-?\d*\.?\d+)px$/;
/** What the option list offers to take the value off the node. */
const UNSET = "__unset";

/** The option string a value is shown and picked as. */
const optionOf = (value: JsonValue | undefined): string => {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "number" ? String(value) : String(value);
};

/** The value an option string or a typed query stands for. */
const parseValue = (option: string): JsonValue => {
  const trimmed = option.trim();
  if (trimmed === UNSET || trimmed === "") {
    return null;
  }
  if (NUMBER_RE.test(trimmed)) {
    return Number(trimmed);
  }
  const px: RegExpExecArray | null = PX_RE.exec(trimmed);
  if (px?.[1]) {
    return Number(px[1]);
  }
  return trimmed;
};

/**
 * Whether a field's value, or a value typed in it, is outside the design system: set, and neither
 * a token (`$radius-lg`) nor one of the values the field offers (a step of the spacing scale,
 * `16px` as `16`; `fill`).
 */
export const isOutsideDesignSystem = (
  option: string,
  options: readonly StyleOption[]
): boolean => {
  const value = optionOf(parseValue(option));
  return (
    value !== "" && !isToken(value) && !options.some((o) => o.value === value)
  );
};

/** How a value reads in a field: a token by its name, pixels as a number. */
export const displayOf = (value: JsonValue | undefined): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(Math.round(value * 100) / 100);
  }
  return isToken(value) ? tokenName(value) : String(value);
};

export const ValueField = ({
  autoOpen,
  value,
  options,
  onChange,
  onPreview,
  placeholder,
  hint,
  leading,
  accept,
  className,
  title,
}: {
  /** Opens the list as soon as it is drawn: the field was just added, to be given a value. */
  autoOpen?: boolean;
  value: JsonValue | undefined;
  options: readonly StyleOption[];
  onChange: (value: JsonValue) => void;
  /**
   * The value the open list has highlighted, to be drawn before it is picked (null takes the
   * value off); undefined once none is.
   */
  onPreview?: (value: JsonValue | undefined) => void;
  /** Muted at the field's end while it is not set: where the value it takes comes from. */
  hint?: string;
  /** Shown while nothing is set: what the layout does on its own. */
  placeholder?: string;
  leading?: React.ReactNode;
  /** Whether a typed value may be used; pixels and tokens always may. */
  accept?: (query: string) => boolean;
  className?: string;
  title?: string;
}) => {
  const current = optionOf(value);
  const custom = (query: string) => {
    const q = query.trim();
    if (!q) {
      return null;
    }
    if (NUMBER_RE.test(q) || PX_RE.test(q) || isToken(q)) {
      return q;
    }
    return accept?.(q) ? q : null;
  };
  const withUnset: StyleOption[] =
    current === ""
      ? [...options]
      : [...options, { label: "Clear", value: UNSET }];
  return (
    <StyleCombobox
      autoOpen={autoOpen}
      className={className}
      current={current}
      custom={custom}
      display={displayOf(value) || (placeholder ?? "")}
      hint={hint}
      leading={leading}
      onPick={(picked) => onChange(parseValue(picked))}
      onPreview={
        onPreview &&
        ((highlighted) =>
          onPreview(highlighted === null ? undefined : parseValue(highlighted)))
      }
      options={withUnset}
      outside={(option) => isOutsideDesignSystem(option, options)}
      title={title}
    />
  );
};
