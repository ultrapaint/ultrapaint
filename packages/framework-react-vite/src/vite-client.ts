/**
 * Vite's client, as the editor's page can live with it (ADR 0034). The preview's modules run in
 * the editor's own page, which the client would reload whole on a full reload, and whose head it
 * would fill with the application's stylesheets. When the page says how it wants either done
 * (`__edReload`, `__edStyles`), the client asks it; a page that says nothing, a preview opened in
 * a tab, keeps the client as it is.
 */

/** Vite's client module, wherever the anchor's Vite is installed. */
export const CLIENT_RE = /[\\/]vite[\\/]dist[\\/]client[\\/]client\.mjs$/;

/** What the patched client calls with a stylesheet: there when the patch took. */
export const CLIENT_STYLES_HOOK = "globalThis.__edStyles.update(id, content)";

export const patchClient = (code: string): string =>
  code
    .replaceAll(
      "location.reload();",
      "(globalThis.__edReload ? globalThis.__edReload() : location.reload());"
    )
    .replace(
      "function updateStyle(id, content) {",
      `function updateStyle(id, content) {\n\tif (globalThis.__edStyles) {\n\t\t${CLIENT_STYLES_HOOK};\n\t\treturn;\n\t}`
    )
    .replace(
      "function removeStyle(id) {",
      "function removeStyle(id) {\n\tif (globalThis.__edStyles) {\n\t\tglobalThis.__edStyles.remove(id);\n\t\treturn;\n\t}"
    );
