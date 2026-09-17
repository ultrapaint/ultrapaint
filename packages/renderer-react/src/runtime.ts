/**
 * Entry of the script injected into every screen iframe ahead of the screen itself: the
 * framework-neutral preview core, given React's introspector. It has to run before React
 * loads, because the DevTools hook must be in place when React initialises.
 */
import { startPreview } from "@ultrapaint/preview-core/index";
import { reactIntrospector } from "./introspect.ts";

startPreview(reactIntrospector);
