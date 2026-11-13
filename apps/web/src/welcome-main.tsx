/** The start screen's window entry (`welcome.html`): the theme and preferences, then the page. */
import { createRoot } from "react-dom/client";
import { followPreferences } from "./state/preferences.ts";
import { followTheme } from "./state/theme.ts";
import { WelcomePage } from "./welcome.tsx";
import "./styles.css";

// The editor's theme, or the system's: the page is the editor's first face.
followTheme();
followPreferences();

createRoot(document.getElementById("root") as HTMLElement).render(
  <WelcomePage />
);
