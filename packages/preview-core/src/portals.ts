/**
 * Popups the page opens (a menu, a dialog, a tooltip) are put by their libraries on the
 * document's body: in an iframe that was the page's own, in the editor's page it is the editor's,
 * outside the frame and its stylesheets. What the preview's own code appends to the body is
 * moved into the frame whose turn it is (`turn.ts`: the one drawing, drawn last, taking input or
 * called back), and taken out of there again when its library removes it from the body.
 *
 * Who appends is told by the stack (`provenance.ts`, `windowCall`).
 */

import { redirectInsertions } from "./insertions.ts";
import type { Provenance } from "./provenance.ts";
import { askedFrame } from "./turn.ts";

/**
 * Sends what the preview's modules append to the body into the frame asked about; `provenance`
 * says whose code appends. Installed once, by the kernel.
 */
export const routePortals = (provenance: Provenance) => {
  redirectInsertions(document.body, (node) => {
    if (!(node instanceof Element && provenance.windowCall())) {
      return false;
    }
    const into = askedFrame()?.body;
    if (!into) {
      return false;
    }
    into.appendChild(node);
    return true;
  });
};
