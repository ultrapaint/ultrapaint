/**
 * The typefaces a design system names, loaded into the editor's page: frames draw in its shadow
 * roots, and a face loaded in the document draws there too. Only a stylesheet from Google Fonts
 * is loaded, as a font's `source` names it (the look page's faces do); any other face is the
 * project's stylesheet's to load.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";

const GOOGLE_FONTS = "https://fonts.googleapis.com/css2?";

const loaded = new Set<string>();

export const loadFonts = (ds: DesignSystem | null) => {
  for (const { source } of ds?.typography.fonts ?? []) {
    if (!source?.startsWith(GOOGLE_FONTS) || loaded.has(source)) {
      continue;
    }
    loaded.add(source);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = source;
    document.head.append(link);
  }
};
