/**
 * The CSS custom properties the page's stylesheets define at its root, resolved: what the
 * design system's tokens are worth in the theme the preview is showing. Reads the document's
 * stylesheets only, so it works for any framework.
 */
const ROOT_SELECTOR_RE = /(^|,)\s*(:root|:host|html)\b/;

const collect = (rules: CSSRuleList, into: Set<string>) => {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      if (ROOT_SELECTOR_RE.test(rule.selectorText)) {
        for (const property of Array.from(rule.style)) {
          if (property.startsWith("--")) {
            into.add(property);
          }
        }
      }
    } else if ("cssRules" in rule) {
      try {
        collect((rule as CSSGroupingRule).cssRules, into);
      } catch {
        // A cross-origin sheet cannot be read, and holds nothing of the design system's.
      }
    }
  }
};

export const readTokens = (
  prefixes?: readonly string[]
): Record<string, string> => {
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collect(sheet.cssRules, names);
    } catch {
      // As above: a sheet from another origin.
    }
  }
  const computed = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of names) {
    if (prefixes && !prefixes.some((p) => name.startsWith(p))) {
      continue;
    }
    const value = computed.getPropertyValue(name).trim();
    if (value !== "") {
      tokens[name] = value;
    }
  }
  return tokens;
};
