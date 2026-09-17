/**
 * Version of the `postMessage` protocol between the editor and the preview. The preview says
 * which one it speaks in `ed:ready`; the editor refuses a preview built for another one. It
 * only matters once a repository can pin its own framework package. Bump on a breaking change
 * to `@ultrapaint/contracts/preview`.
 */
export const PREVIEW_PROTOCOL = 1;
