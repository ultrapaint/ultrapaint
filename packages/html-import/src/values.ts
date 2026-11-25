/**
 * Values of pasted markup written as the design system's tokens where it has one (ADR 0148): the
 * first token of the field's kind that holds the value, in any unit or colour space
 * (`tokensByValue`), as the Figma import writes colours (ADR 0016); a spacing as its step of the
 * scale first (`16px` on a 4px base is `$spacing-4`). A value with no token stays as it is, which
 * the inspector and the design checks show as off the system (ADR 0061). Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DeclaredValue } from "@ultrapaint/contracts/node-style";
import {
  listedTokens,
  spacingBasePx,
  spacingStepAt,
  spacingStepName,
  tokensByValue,
} from "@ultrapaint/contracts/token-table";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { isToken } from "@ultrapaint/design-document/tokens";

/** A value of a field, as a token of the design system's where one holds it. */
export interface Values {
  /** A token of `kind` that holds the value, else the value: `#2b7fff` → `$color-primary`. */
  readonly of: (kind: TokenKind, value: DeclaredValue) => DeclaredValue;
  /** A spacing: its step of the scale, else a named spacing that holds it, else the value. */
  readonly spacing: (value: DeclaredValue) => DeclaredValue;
  /** One step of the spacing scale in pixels. */
  readonly stepPx: number;
}

export const valuesOf = (ds: DesignSystem | null | undefined): Values => {
  const byValue = tokensByValue(ds ? listedTokens(ds) : []);
  const stepPx = spacingBasePx(ds?.spacing.base);
  const of = (kind: TokenKind, value: DeclaredValue): DeclaredValue => {
    if (typeof value === "string" && isToken(value)) {
      return value;
    }
    const [first] = byValue(
      kind,
      typeof value === "number" ? `${value}px` : value
    );
    return first ? `$${first.name}` : value;
  };
  return {
    of,
    spacing: (value) => {
      if (typeof value === "number" && value > 0) {
        const step = spacingStepAt(value, stepPx);
        if (step !== null) {
          return `$${spacingStepName(step)}`;
        }
      }
      return value === 0 ? 0 : of("spacing", value);
    },
    stepPx,
  };
};
