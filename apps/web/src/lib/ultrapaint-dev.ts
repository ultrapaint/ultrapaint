/**
 * Ultrapaint Dev (ADR 0113): the desktop app run from a checkout of Ultrapaint, beside the
 * release. What it runs, as the shell says it (`Platform.dev`), which never changes while it
 * runs: the editor names it in About, draws its look on the tab strip and leaves the command to
 * the release.
 */
import type { DevCheckout } from "@ultrapaint/contracts/shell-bridge";
import { platform } from "../platform.ts";

/** The checkout Ultrapaint Dev runs; null in the release and in a browser. */
export const devCheckout = (): DevCheckout | null =>
  platform().dev?.current() ?? null;

/** How Ultrapaint Dev names what it runs: `main · 3f2a1c9`. */
export const devCheckoutLabel = (checkout: DevCheckout) =>
  `${checkout.branch} · ${checkout.commit}`;
