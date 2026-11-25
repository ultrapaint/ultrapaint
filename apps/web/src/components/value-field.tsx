/**
 * A field over one value of a node: a number of pixels, a design token (`$color-primary`) or
 * plain CSS. The design system's tokens are the list, so they stay the easy path; anything else
 * is typed. Built on the style combobox, whose options are strings: numbers travel as their
 * decimal text and come back as numbers. A field that knows its kind of token offers a value
 * outside the design system a way onto it (ADR 0136): the nearest token, or a new one made from it,
 * which the field is set to in the same undo step.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { asTokenValue } from "@ultrapaint/contracts/nearest-token";
import {
  isOffSystem,
  type OffSystemKind,
} from "@ultrapaint/design-document/off-system";
import {
  isToken,
  tokenName,
  tokenRef,
} from "@ultrapaint/design-document/tokens";
import type * as React from "react";
import { useState } from "react";
import {
  type ColorRole,
  useWaysOnto,
  type WaysOnto,
} from "../lib/new-token.ts";
import type { FieldTokenKind } from "../lib/token-options.tsx";
import { makeTokenFor } from "../state/design-system.ts";
import { ensureEditable } from "../state/setup.ts";
import { NewTokenPopover } from "./new-token-popover.tsx";
import { StyleCombobox, type StyleOption } from "./style-combobox.tsx";

const NUMBER_RE = /^-?\d*\.?\d+$/;
const PX_RE = /^(-?\d*\.?\d+)px$/;
/** What the option list offers to take the value off the node. */
const UNSET = "__unset";

/**
 * The value a query types, or null: pixels and tokens always, other text when the field
 * accepts it, and never the field's own internal value, with Clear on the list or not.
 */
export const typedValue = (
  query: string,
  accept?: (query: string) => boolean
): string | null => {
  const q = query.trim();
  if (!q || q === UNSET) {
    return null;
  }
  if (NUMBER_RE.test(q) || PX_RE.test(q) || isToken(q)) {
    return q;
  }
  return accept?.(q) ? q : null;
};

/** A field's options, with Clear last while it holds a value. */
export const withClear = (
  options: readonly StyleOption[],
  current: string
): StyleOption[] =>
  current === ""
    ? [...options]
    : [...options, { internal: true, label: "Clear", value: UNSET }];

/** The option string a value is shown and picked as. */
const optionOf = (value: JsonValue | undefined): string => {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
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

/** The kind of the design's checks each kind of token a field takes is checked as. */
const OFF_SYSTEM_KINDS: Partial<Record<FieldTokenKind, OffSystemKind>> = {
  color: "color",
  font: "font",
  fontSize: "text-size",
  fontWeight: "weight",
  leading: "line-height",
  radius: "radius",
  shadow: "shadow",
  spacing: "spacing",
  tracking: "tracking",
};

/**
 * Whether a field's value, or a value typed in it, is outside the design system: set, and neither
 * a token (`$radius-lg`) nor one of the values the field offers (a step of the spacing scale,
 * `16px` as `16`; `fill`). A field that knows its kind asks what the design's checks ask too
 * (`isOffSystem`): any whole or half step of the spacing scale is on it, offered or not, and so are
 * a round radius and a keyword that is no value (`none`, `transparent`).
 */
export const isOutsideDesignSystem = (
  option: string,
  options: readonly StyleOption[],
  field?: WaysOnto["field"]
): boolean => {
  const parsed = parseValue(option);
  const checkedAs = field && OFF_SYSTEM_KINDS[field.kind];
  if (checkedAs) {
    const off = isOffSystem(checkedAs, parsed, field.spacingBase);
    // A spacing in pixels is on the system exactly when it is a step of the scale.
    if (!off || (checkedAs === "spacing" && typeof parsed === "number")) {
      return off;
    }
  }
  const value = optionOf(parsed);
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
  clearable = true,
  colors,
  kind,
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
  /** Whether the list offers Clear, which takes the value off; a field it would mean nothing in has none. */
  clearable?: boolean;
  /** What a colour field colours, which names a new token's namespace in a detailed system. */
  colors?: ColorRole;
  /**
   * The kind of token it takes: a value outside the design system is then offered the nearest
   * token and a new token made from it (ADR 0136), and a spacing is on the system as the checks say.
   */
  kind?: FieldTokenKind;
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
  /** The field's name, shown in the system tooltip over it. */
  title?: string;
}) => {
  const current = optionOf(value);
  const custom = (query: string) => typedValue(query, accept);
  const withUnset = clearable ? withClear(options, current) : [...options];
  const ways = useWaysOnto(kind, colors);
  // The field a new token is being named for, which its popover is drawn by.
  const [naming, setNaming] = useState<HTMLElement | null>(null);
  const addToken = (name: string) => {
    setNaming(null);
    if (!ways || value === undefined || value === null) {
      return;
    }
    makeTokenFor(
      {
        name,
        op: "addToken",
        value: asTokenValue(
          ways.field.kind,
          typeof value === "number" ? value : String(value)
        ),
      },
      () => onChange(tokenRef(name))
    );
  };
  return (
    <>
      <StyleCombobox
        autoOpen={autoOpen}
        className={className}
        current={current}
        custom={custom}
        display={displayOf(value) || (placeholder ?? "")}
        hint={hint}
        leading={leading}
        nearest={ways ? () => ways.nearest(value) : undefined}
        onNewToken={
          ways
            ? (at) => {
                // Not opened while the field could not be written, so nothing typed is lost.
                if (ensureEditable()) {
                  setNaming(at);
                }
              }
            : undefined
        }
        onPick={(picked) => onChange(parseValue(picked))}
        onPreview={
          onPreview &&
          ((highlighted) =>
            onPreview(
              highlighted === null ? undefined : parseValue(highlighted)
            ))
        }
        options={withUnset}
        outside={(option) =>
          isOutsideDesignSystem(option, options, ways?.field)
        }
        title={title}
      />
      {naming && ways ? (
        <NewTokenPopover
          anchor={naming}
          nameOf={ways.nameOf}
          onAdd={addToken}
          onCancel={() => setNaming(null)}
          prefix={ways.prefix}
        />
      ) : null}
    </>
  );
};
