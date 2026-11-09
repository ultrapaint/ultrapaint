/**
 * The editor's `cn`: the `cn` package's merge, told the type tokens of `styles.css` (ADR 0071).
 * A token sets the family, size, line height, weight and tracking at once, so a later token
 * drops an earlier weight, line height or tracking: `cn("font-body font-medium",
 * "font-heading-xsmall")` is the heading alone, as the heading is drawn. A weight after a token
 * stays, as the emphasis it is.
 */
import { createCn } from "cn/config";

const TYPE_TOKENS = [
  "heading-xxlarge",
  "heading-xlarge",
  "heading-large",
  "heading-medium",
  "heading-small",
  "heading-xsmall",
  "heading-xxsmall",
  "body-large",
  "body",
  "body-small",
  "code",
];

export const cn = createCn({
  extend: {
    classGroups: { "type-token": [{ font: TYPE_TOKENS }] },
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
