/**
 * The React + Vite framework: where a repository's React application is and how a new one is
 * written (ADR 0017, 0040). The canvas draws the editor's system components, so nothing here draws
 * or serves a page. How the tokens and classes are written is the style system's (ADR 0024). The
 * server reaches all of it through the `Framework` interface and never imports another module of
 * this package.
 */
import type { Framework } from "@ultrapaint/framework-api/node";
import { detect } from "./detect.ts";
import { scaffold } from "./scaffold.ts";

export const framework: Framework = {
  detect,
  id: "react-vite",
  scaffold,
};
