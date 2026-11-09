/**
 * The editor's `cn`: the `cn` package's merge, told the type tokens of `styles.css` (ADRs 0071,
 * 0072). The tokens are one group, so a later token replaces an earlier one, `cn("font-body",
 * "font-heading-xsmall")` the heading alone, as it would replace any of Tailwind's own type
 * utilities, which the editor's theme draws nothing for.
 */
import { createCn } from "cn/config";

/** The type tokens, as `styles.css` defines them. */
export const TYPE_TOKENS = [
  "heading-xxlarge",
  "heading-xlarge",
  "heading-large",
  "heading-medium",
  "heading-small",
  "heading-xsmall",
  "heading-xxsmall",
  "body-large",
  "body",
  "body-medium",
  "body-semibold",
  "body-small",
  "body-small-medium",
  "code",
] as const;

export const cn = createCn({
  extend: {
    classGroups: { "type-token": [{ font: [...TYPE_TOKENS] }] },
    conflictingClassGroups: {
      "type-token": [
        "font-family",
        "font-size",
        "font-weight",
        "leading",
        "tracking",
      ],
    },
  },
});
