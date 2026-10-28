/**
 * Vite's client, as the editor's page can live with it (ADR 0034). The preview's modules run in
 * the editor's own page, which the client would reload whole on a full reload, and whose head it
 * would fill with the application's stylesheets. When the page says how it wants either done
 * (`__edReload`, `__edStyles`), the client asks it; a page that says nothing, a preview opened in
 * a tab, keeps the client as it is.
 */
import {
  RELOAD_GLOBAL,
  STYLES_GLOBAL,
  STYLES_MEMBERS,
} from "@ultrapaint/contracts/page-runtime";

/** Vite's client module, wherever the anchor's Vite is installed. */
export const CLIENT_RE = /[\\/]vite[\\/]dist[\\/]client[\\/]client\.mjs$/;

const STYLES = `globalThis.${STYLES_GLOBAL}`;
const RELOAD = `globalThis.${RELOAD_GLOBAL}`;

/** What the patched client calls with a stylesheet: there when the patch took. */
export const CLIENT_STYLES_HOOK = `${STYLES}.${STYLES_MEMBERS.update}(id, content)`;

export const patchClient = (code: string): string =>
  code
    .replaceAll(
      "location.reload();",
      `(${RELOAD} ? ${RELOAD}() : location.reload());`
    )
    .replace(
      "function updateStyle(id, content) {",
      `function updateStyle(id, content) {\n\tif (${STYLES}) {\n\t\t${CLIENT_STYLES_HOOK};\n\t\treturn;\n\t}`
    )
    .replace(
      "function removeStyle(id) {",
      `function removeStyle(id) {\n\tif (${STYLES}) {\n\t\t${STYLES}.${STYLES_MEMBERS.remove}(id);\n\t\treturn;\n\t}`
    );
