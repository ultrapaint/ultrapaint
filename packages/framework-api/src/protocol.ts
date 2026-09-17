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
 */
export const PREVIEW_PROTOCOL = 3;
