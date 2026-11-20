/**
 * The tab strip's window entry (`tabs.html`, ADR 0107): the theme and preferences, then the
 * strip, on a page whose ground is see-through so that, covering the window for a menu, it shows
 * the project's page under it.
 */
import { createRoot } from "react-dom/client";
import { TabStripPage } from "./components/tab-strip.tsx";
import { followPreferences } from "./state/preferences.ts";
import { followTheme } from "./state/theme.ts";
import "./styles.css";

followTheme();
followPreferences();

createRoot(document.getElementById("root") as HTMLElement).render(
  <TabStripPage />
);
