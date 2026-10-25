/**
 * Version of the `postMessage` protocol between the editor and the preview. The preview says
 * which one it speaks in `ed:ready`; the editor refuses a preview built for another one. It
 * only matters once a repository can pin its own framework package. Bump on a breaking change
 * to `@ultrapaint/contracts/preview`.
 *
 * 2: `ed:setInteractive`. The editor now trusts the preview to ignore input outside interact
 * mode; a preview that predates the message would answer the keyboard on a canvas that is
 * supposed to be a picture.
 *
 * 3: `ed:hit` answers with the whole chain of nodes under the point instead of one, and
 * `ed:hitTest` no longer carries `deepest`. Which of them a click takes is the editor's to
 * decide: it is what holds the selection the drilling walks along.
 *
 * 4: pages and routes. Every message carries `page` where it carried `screen`, and the canvas's
 * router is driven by the editor: the preview asks with `ed:navigateTo`, the editor answers
 * with `ed:route` and hears `ed:routeChanged`.
 *
 * 5: design documents (ADR 0015). The editor sends what to draw with `ed:render`; the preview
 * no longer sends a tree, inspects styles or holds a router, and nodes are named by the
 * document's ids.
 *
 * 6: the design's stylesheet and component specs (ADR 0028, 0029). `ed:render` carries `styles`
 * (the tokens' values over the code's) and `specs`; instances are marked with `data-ed-c` and
 * `data-ed-v`, and drafts are drawn from their tree.
 */
export const PREVIEW_PROTOCOL = 6;
