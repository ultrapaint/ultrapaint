/**
 * Entry of the script injected into every preview iframe ahead of the page itself: the
 * framework-neutral preview core. Drawing is the renderer's, loaded by the generated entry
 * module with the repository's own React.
 */
import { startPreview } from "@ultrapaint/preview-core/index";

startPreview();
